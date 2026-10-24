"""OCR Service -> reads labels (device tags, wire ferrules) from the photo.

Engines
-------
tesseract : default. Needs the Tesseract program installed (see README).
easyocr   : `pip install easyocr` - better on angled / low-light photos, slower,
            downloads its model on first use.
auto      : easyocr if installed, otherwise tesseract.

Each result: {"text": normalized, "raw": as read, "confidence": 0-100, "bbox": [x1,y1,x2,y2]}
bbox coordinates are always in ORIGINAL image pixels.
"""
import logging
import os
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import cv2
import numpy as np

from app.errors import ServiceUnavailable
from app.utils.text import normalize_label, ocr_fold

log = logging.getLogger(__name__)


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    area = lambda r: (r[2] - r[0]) * (r[3] - r[1])
    return inter / float(area(a) + area(b) - inter)


_TAG_LIKE = re.compile(r"^-?[A-Z]{1,5}\d{1,4}[A-Z]?(\.\d{1,3})?$|^\d{2,5}$")


def _merge(results: list[dict]) -> list[dict]:
    """Same word read in several preprocessing passes -> keep the most confident.
    When two different texts were read at the same spot (e.g. upright and rotated),
    a tag-like reading (K1, PS13, 105) wins over noise, then the more confident one."""
    merged: list[dict] = []
    for r in sorted(results, key=lambda x: (not _TAG_LIKE.match(x["text"]), -x["confidence"])):
        cx, cy = (r["bbox"][0] + r["bbox"][2]) / 2, (r["bbox"][1] + r["bbox"][3]) / 2
        same_word = any(m["text"] == r["text"] and (_iou(m["bbox"], r["bbox"]) > 0.3 or
                        (m["bbox"][0] <= cx <= m["bbox"][2] and m["bbox"][1] <= cy <= m["bbox"][3]))
                        for m in merged)
        # two different readings of the very same spot: the confident one wins
        rival_reading = any(_iou(m["bbox"], r["bbox"]) > 0.8 for m in merged)
        if same_word or rival_reading:
            continue
        merged.append(r)
    return merged


def _preprocess(image: np.ndarray) -> tuple[list[np.ndarray], float]:
    """Return image variants for OCR plus the scale factor applied."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = gray.shape[:2]
    longest = max(h, w)
    scale = 1.0
    if longest < 1800:                       # small text needs upscaling
        scale = 1800 / longest
    elif longest > 3500:                     # huge phone photos: keep it fast
        scale = 3500 / longest
    if scale != 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    denoised = cv2.bilateralFilter(clahe, 7, 50, 50)
    _, binary = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    inverted = cv2.bitwise_not(binary)       # white text on dark labels
    return [clahe, binary, inverted], scale


def _prep_crop(gray_crop: np.ndarray) -> np.ndarray:
    h = gray_crop.shape[0]
    crop = cv2.resize(gray_crop, None, fx=64 / h, fy=64 / h, interpolation=cv2.INTER_CUBIC)
    crop = cv2.medianBlur(crop, 3)           # sensor noise -> speckles after threshold
    _, crop = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if crop.mean() < 127:                    # make it dark text on white
        crop = cv2.bitwise_not(crop)
    # Remove (a) dark blobs touching the edge - sticker frame, device body,
    # shadows, which Tesseract reads as brackets / pipes - and (b) specks.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(crop), connectivity=8)
    ch, cw = crop.shape
    min_area = 0.004 * ch * cw
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if x == 0 or y == 0 or x + w >= cw or y + h >= ch or area < min_area or h < 0.2 * ch:
            crop[labels == i] = 255
    # tight crop around the remaining ink, scaled to ~48 px text height
    ys, xs = np.where(crop < 128)
    if ys.size < 20:
        return None
    crop = crop[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    s = 48 / crop.shape[0]
    crop = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    return cv2.copyMakeBorder(crop, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)


def find_label_regions(image: np.ndarray, max_regions: int = 150):
    """Locate small label-like areas: bright stickers / ferrules, and compact
    text blobs found with a morphological gradient. Returns (bbox, prepared crop)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    H, W = gray.shape[:2]
    area_img = H * W
    boxes: list[list[int]] = []

    # A) bright rectangular patches (white label stickers, ferrule sleeves)
    _, bright = cv2.threshold(cv2.GaussianBlur(gray, (5, 5), 0), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    for c in cv2.findContours(bright, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, w, h = cv2.boundingRect(c)
        if 0.0003 * area_img < w * h < 0.03 * area_img and 0.8 < w / h < 10 \
                and cv2.contourArea(c) / (w * h) > 0.7:
            boxes.append([x, y, x + w, y + h])

    # B) text blobs (works for printed text without a sticker)
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k = max(9, W // 120)
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, 3)))
    for c in cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, w, h = cv2.boundingRect(c)
        if 12 <= h <= H / 8 and 1.0 < w / h < 10 and w * h < 0.03 * area_img:
            boxes.append([x, y, x + w, y + h])

    def inside(inner, outer) -> bool:
        ix = max(0, min(inner[2], outer[2]) - max(inner[0], outer[0]))
        iy = max(0, min(inner[3], outer[3]) - max(inner[1], outer[1]))
        return ix * iy > 0.7 * (inner[2] - inner[0]) * (inner[3] - inner[1])

    # biggest first: a whole sticker wins over the letter holes found inside it
    regions, kept = [], []
    for b in sorted(boxes, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1])):
        if any(_iou(b, k2) > 0.5 or inside(b, k2) for k2 in kept):
            continue
        kept.append(b)
        x1, y1, x2, y2 = b
        pad = max(3, (y2 - y1) // 8)
        crop = gray[max(0, y1 - pad):min(H, y2 + pad), max(0, x1 - pad):min(W, x2 + pad)]
        prepared = _prep_crop(crop) if crop.size and crop.shape[0] >= 8 else None
        if prepared is not None:
            regions.append((b, prepared))
        if len(regions) >= max_regions:
            break
    return regions


# --------------------------------------------------------------------------- #
# Engines
# --------------------------------------------------------------------------- #
class TesseractEngine:
    name = "tesseract"
    parallel = True    # every call is its own tesseract process

    def __init__(self, cmd: str = ""):
        import pytesseract
        if cmd:
            pytesseract.pytesseract.tesseract_cmd = cmd
        self.pt = pytesseract
        try:
            self.pt.get_tesseract_version()
        except Exception as exc:
            raise ServiceUnavailable(
                "Tesseract is not installed or not on PATH. Install it or set TESSERACT_CMD in .env."
            ) from exc

    def read(self, image: np.ndarray, light: bool = False, regions: bool = True) -> list[dict]:
        """light = one preprocessing variant instead of three, and the label crops are read
        in batches (used for big photos and their tiles). regions=False skips pass 2."""
        variants, scale = _preprocess(image)
        if light:
            variants = variants[:1]
        out: list[dict] = []
        # Pass 1 - whole image, sparse text mode (labels scattered over a photo)
        for variant in variants:
            data = self.pt.image_to_data(variant, config="--oem 3 --psm 11",
                                         output_type=self.pt.Output.DICT)
            for i, raw in enumerate(data["text"]):
                conf = float(data["conf"][i])
                if not raw.strip() or conf < 0:
                    continue
                x, y, w, h = (data[k][i] / scale for k in ("left", "top", "width", "height"))
                out.append({"raw": raw.strip(), "confidence": conf,
                            "bbox": [int(x), int(y), int(x + w), int(y + h)]})
        # Pass 2 - each label-like region on its own (stickers, ferrules, tags).
        # Tesseract reads isolated short text far better than text inside a busy photo.
        if regions:
            out += self._read_regions_batched(image) if light else self._read_regions(image)
        return out

    def _read_regions_batched(self, image: np.ndarray, per_call: int = 40) -> list[dict]:
        """Same as _read_regions, but the prepared crops are stacked into one tall image
        and read with ONE tesseract call per batch. Starting a tesseract process costs far
        more than reading a 50 px crop, so on big photos (hundreds of crops) this is
        many times faster."""
        # psm 6 (block) and psm 11 (sparse) each win on different labels, like psm 7 / 8 per crop
        configs = [f"--oem 3 --psm {psm} -c load_system_dawg=0 -c load_freq_dawg=0" for psm in (6, 11)]
        regions = find_label_regions(image)
        out = []
        gap = 40
        for start in range(0, len(regions), per_call):
            chunk = regions[start:start + per_call]
            width = max(c.shape[1] for _, c in chunk)
            rows, bands, y = [], [], 0
            for box, crop in chunk:
                padded = cv2.copyMakeBorder(crop, 0, gap, 0, width - crop.shape[1], cv2.BORDER_CONSTANT, value=255)
                rows.append(padded)
                bands.append((y, y + crop.shape[0], box))
                y += padded.shape[0]
            sheet = np.vstack(rows)
            for base in configs:
                out += self._words_in_bands(sheet, base, bands, gap)
        return out

    def _words_in_bands(self, sheet, config, bands, gap) -> list[dict]:
        """Read a stacked sheet of crops; every word goes back to the crop (band) it sits in."""
        out = []
        data = self.pt.image_to_data(sheet, config=config, output_type=self.pt.Output.DICT)
        for i, t in enumerate(data["text"]):
            c = float(data["conf"][i])
            if not t.strip() or c < 0:
                continue
            cy = data["top"][i] + data["height"][i] / 2
            band = next((b for b in bands if b[0] - gap / 2 <= cy <= b[1] + gap / 2), None)
            if band:
                out.append({"raw": t.strip(), "confidence": c, "bbox": list(band[2]), "region": True})
        return out

    def _read_regions(self, image: np.ndarray) -> list[dict]:
        # No dictionary (tags are not words). No character whitelist on purpose:
        # with LSTM it collapses the confidence of short tags to 0, while an
        # unconstrained read ('Ql') is folded back to 'Q1' by the rule engine.
        # psm 7 = single line, psm 8 = single word - each wins on different labels.
        base = "--oem 3 -c load_system_dawg=0 -c load_freq_dawg=0"
        out = []
        for (x1, y1, x2, y2), crop in find_label_regions(image):
            for psm in (7, 8):
                data = self.pt.image_to_data(crop, config=f"--psm {psm} {base}",
                                             output_type=self.pt.Output.DICT)
                for t, c in zip(data["text"], data["conf"]):
                    if t.strip() and float(c) >= 0:
                        out.append({"raw": t.strip(), "confidence": float(c),
                                    "bbox": [x1, y1, x2, y2], "region": True})
        return out


class EasyOcrEngine:
    name = "easyocr"

    def __init__(self):
        self.reader = _easyocr_reader()

    parallel = False   # one shared model; not safe to call from several threads

    def read(self, image: np.ndarray, light: bool = False, regions: bool = True) -> list[dict]:
        out = []
        for box, raw, conf in self.reader.readtext(image):
            xs, ys = [p[0] for p in box], [p[1] for p in box]
            # easyocr returns phrases; split so each word is its own label
            for word in str(raw).split():
                out.append({"raw": word, "confidence": float(conf) * 100,
                            "bbox": [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]})
        return out


@lru_cache(maxsize=1)
def _easyocr_reader():
    import easyocr  # noqa: WPS433 (optional dependency)
    return easyocr.Reader(["en"], gpu=False, verbose=False)


def _easyocr_installed() -> bool:
    try:
        import easyocr  # noqa: F401
        return True
    except ImportError:
        return False


def get_engine(engine: str, tesseract_cmd: str = ""):
    engine = (engine or "auto").lower()
    if engine == "easyocr" or (engine == "auto" and _easyocr_installed()):
        if not _easyocr_installed():
            raise ServiceUnavailable("OCR_ENGINE=easyocr but easyocr is not installed (pip install easyocr).")
        return EasyOcrEngine()
    return TesseractEngine(tesseract_cmd)


def engine_status(engine: str, tesseract_cmd: str = "") -> dict:
    """Used by /api/health - never raises."""
    try:
        e = get_engine(engine, tesseract_cmd) if engine != "easyocr" else None
        name = e.name if e else "easyocr"
        return {"available": True, "engine": name}
    except ServiceUnavailable as exc:
        return {"available": False, "engine": engine, "message": exc.message}
    except Exception as exc:  # pragma: no cover
        return {"available": False, "engine": engine,
                "message": str(exc) or "tesseract not found",
                "tesseract_on_path": bool(shutil.which("tesseract"))}


_LETTERS_THEN_DIGITS = re.compile(r"^[A-Z]{1,3}\d{1,4}$")


def _repair_tag(text: str) -> str:
    """'QL' -> 'Q1', 'KI' -> 'K1': an all-letter read that becomes a normal
    device tag once OCR look-alikes are folded is almost always that tag.
    The raw reading is kept alongside in the result."""
    if text.isalpha() and 2 <= len(text) <= 4:
        folded = ocr_fold(text)
        if _LETTERS_THEN_DIGITS.match(folded):
            return folded
    return text


# Labels on DIN-rail devices and ferrules are often printed sideways, so the photo
# is also read turned 90 degrees each way and the boxes are mapped back.
_ROTATIONS = {90: cv2.ROTATE_90_COUNTERCLOCKWISE, 270: cv2.ROTATE_90_CLOCKWISE}


def _unrotate(bbox, angle: int, w: int, h: int) -> list[int]:
    """Box in the rotated image -> box in the original (w x h) image."""
    x1, y1, x2, y2 = bbox
    if angle == 90:      # original (x, y) -> rotated (y, w-1-x)
        pts = [(w - 1 - y1, x1), (w - 1 - y2, x2)]
    elif angle == 270:   # original (x, y) -> rotated (h-1-y, x)
        pts = [(y1, h - 1 - x1), (y2, h - 1 - x2)]
    else:
        return [int(v) for v in bbox]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]


def _parse_rotations(rotations) -> list[int]:
    if isinstance(rotations, str):
        rotations = [r for r in rotations.replace(" ", "").split(",") if r]
    out = [int(r) for r in rotations or [0]]
    return [r for r in out if r in (0, 90, 270)] or [0]


# Big phone photos are also read in overlapping tiles at full resolution: small
# labels survive, and the label finder thresholds each tile on its own contrast.
TILE_SIZE, TILE_OVERLAP, TILE_MIN = 1400, 250, 2000


def _tiles(h: int, w: int):
    step = TILE_SIZE - TILE_OVERLAP
    ys = list(range(0, max(1, h - TILE_OVERLAP), step))
    xs = list(range(0, max(1, w - TILE_OVERLAP), step))
    for y in ys:
        for x in xs:
            yield x, y, min(w, x + TILE_SIZE), min(h, y + TILE_SIZE)


def read_labels(image: np.ndarray, engine: str = "auto", tesseract_cmd: str = "",
                min_confidence: float = 40, rotations="0", tiles: bool = False) -> dict:
    ocr = get_engine(engine, tesseract_cmd)
    h, w = image.shape[:2]

    # jobs: (angle, x offset, y offset, image, light, read label regions)
    big = tiles and max(h, w) > TILE_MIN
    jobs = []
    for angle in _parse_rotations(rotations):
        turned = image if angle == 0 else cv2.rotate(image, _ROTATIONS[angle])
        if big:
            # the tiles do the detailed work; the whole photo is only skimmed once, upright,
            # for big labels that a tile would cut in half
            if angle == 0:
                jobs.append((angle, 0, 0, turned, True, False))
            th, tw = turned.shape[:2]
            jobs += [(angle, x1, y1, turned[y1:y2, x1:x2], True, True) for x1, y1, x2, y2 in _tiles(th, tw)]
        else:
            jobs.append((angle, 0, 0, turned, False, True))

    def run(job):
        angle, ox, oy, img, light, regions = job
        found = ocr.read(img, light=light, regions=regions)
        for r in found:
            x1, y1, x2, y2 = r["bbox"]
            r["bbox"] = _unrotate([x1 + ox, y1 + oy, x2 + ox, y2 + oy], angle, w, h)
        return found

    workers = max(1, min(4, (os.cpu_count() or 2) // 2)) if getattr(ocr, "parallel", False) else 1
    with ThreadPoolExecutor(max_workers=workers) as pool:
        raw = [r for found in pool.map(run, jobs) for r in found]
    results = []
    for r in raw:
        text = _repair_tag(normalize_label(r["raw"]))
        # an isolated label crop is a much easier read than free text in the
        # photo, so region reads are trusted at half the confidence threshold
        threshold = min_confidence / 2 if r.pop("region", False) else min_confidence
        if len(text) < 2 or r["confidence"] < threshold:
            continue
        results.append({"text": text, **r})
    results = _merge(results)
    log.info("OCR (%s): %d labels", ocr.name, len(results))
    return {"engine": ocr.name, "texts": results}
