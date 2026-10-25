"""Drawing comparison: find small differences between an uploaded picture and the drawing.

When an uploaded image shows a sheet of the drawing PDF (a screenshot, scan or print of
the general arrangement, the BOM, ...), it is lined up with that sheet and compared pixel
by pixel, so even a changed character, a moved label or a missing symbol shows up:

1. every PDF page is rendered and matched to the image with SIFT features + RANSAC; the page
   with the most consistent matches wins (no match -> the image is a real photo, step skipped)
2. the page is re-rendered at the image's resolution and warped onto it (homography,
   refined with ECC for sub-pixel accuracy)
3. ink in the image that is not in the drawing = "added", ink in the drawing that is not
   in the image = "removed" (a small tolerance absorbs anti-aliasing); tiny specks are dropped
4. every changed area is described with the drawing's own text (from the PDF) and the text
   read in the image (OCR)

The drawing's device tags are also projected into the image, which tells exactly which
devices the image shows (coverage) and where they are.

A photograph of a real cabinet cannot be compared to a CAD drawing this way; for photos the
match fails and nothing is reported by this step.
"""
import hashlib
import logging
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)

MATCH_SIDE = 2000          # long side of page / image used for feature matching (px)
MIN_INLIERS = 40           # consistent feature matches needed to accept a page
MIN_INLIER_RATIO = 0.15     # loose: repeated symbols give many look-alike matches; the ink check decides
MIN_CHANGE_PX = 6          # changed ink pixels for a difference to count (one changed digit is ~15)
MAX_CHANGES = 40
MAX_CHANGED_SHARE = 0.12   # more changed ink than this = too different to list single changes
NOT_SAME_SHARE = 0.5       # more than this = not a picture of the drawing at all (a real photo)


# --------------------------------------------------------------------------- #
# pages
# --------------------------------------------------------------------------- #
def _digest(pdf_path: Path) -> str:
    return hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()[:24]


def _render(pdf_path: Path, page: int, scale: float) -> np.ndarray:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(pdf_path))
    try:
        img = doc[page].render(scale=scale, grayscale=True).to_numpy()
    finally:
        doc.close()
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)


def _page_sizes(pdf_path: Path) -> list[tuple[float, float]]:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(pdf_path))
    try:
        return [tuple(doc[i].get_size()) for i in range(len(doc))]
    finally:
        doc.close()


_sift = None


def _features(gray: np.ndarray):
    global _sift
    if _sift is None:
        _sift = cv2.SIFT_create(nfeatures=6000)
    return _sift.detectAndCompute(gray, None)


@lru_cache(maxsize=8)
def _page_features(pdf_path: str, digest: str):
    """[(scale, keypoint xy array, descriptors)] for every page, rendered with MATCH_SIDE long side."""
    out = []
    for i, (w, h) in enumerate(_page_sizes(Path(pdf_path))):
        scale = MATCH_SIDE / max(w, h)
        kp, des = _features(_render(Path(pdf_path), i, scale))
        xy = np.float32([k.pt for k in kp]) if kp else np.empty((0, 2), np.float32)
        out.append((scale, xy, des))
    return out


@lru_cache(maxsize=32)
def _page_words(pdf_path: str, digest: str, page: int) -> list[dict]:
    """Words of one page with boxes in PDF points (top-left origin), from pdfium's character
    boxes - milliseconds, where pdfplumber needs seconds per dense CAD sheet."""
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(pdf_path)
    try:
        pg = doc[page]
        if pg.get_rotation():                       # rotated sheet: let pdfplumber do the maths
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                return [{"text": w["text"], "box": (w["x0"], w["top"], w["x1"], w["bottom"])}
                        for w in pdf.pages[page].extract_words()]
        height = pg.get_height()
        tp = pg.get_textpage()
        words, chars, box = [], [], None

        def flush():
            if chars and box:
                words.append({"text": "".join(chars), "box": tuple(box)})

        for i in range(tp.count_chars()):
            ch = tp.get_text_range(i, 1)
            left, bottom, right, top = tp.get_charbox(i)
            if not ch.strip() or right <= left:
                flush()
                chars, box = [], None
                continue
            b = [left, height - top, right, height - bottom]
            if box and (b[0] - box[2] > 0.6 * (b[3] - b[1]) or abs(b[1] - box[1]) > 0.5 * (b[3] - b[1])):
                flush()                              # a gap or a new line: new word
                chars, box = [], None
            if box is None:
                chars, box = [ch], b
            else:
                chars.append(ch)
                box = [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
        flush()
        return words
    finally:
        doc.close()


def _title(pdf_path: Path, page: int) -> str:
    """Short sheet title, e.g. 'INTERNAL GENERAL ARRANGEMENT - REAR VIEW'."""
    try:
        import re
        import pypdfium2 as pdfium
        from app.services.pdf_service import _SHEET_WORDS, _page_title
        doc = pdfium.PdfDocument(str(pdf_path))
        try:
            title = " ".join(_page_title(doc[page].get_textpage().get_text_range()).split())
        finally:
            doc.close()
        for word in _SHEET_WORDS:          # cut off revision-block text in front of the title
            i = title.find(word)
            if i >= 0:
                start = title.rfind("INTERNAL", 0, i) if "INTERNAL" in title[:i] else i
                return re.sub(r"\s+-\s+\d{2}[A-Z]{2}\d{3,}.*$", "", title[start:])[:80]
        return ""
    except Exception:                      # pragma: no cover
        return ""


# --------------------------------------------------------------------------- #
# matching
# --------------------------------------------------------------------------- #
def _sane(H: np.ndarray, shape) -> bool:
    """Reject homographies that fold, flip or blow up the image."""
    if H is None or not np.isfinite(H).all():
        return False
    h, w = shape[:2]
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    quad = cv2.perspectiveTransform(corners, H).reshape(-1, 2)
    if not cv2.isContourConvex(quad.astype(np.float32)):
        return False
    area = cv2.contourArea(quad)
    return area > 0.02 * w * h and abs(H[2, 0]) < 1e-3 and abs(H[2, 1]) < 1e-3


def find_page(image_gray: np.ndarray, pdf_path: Path):
    """(page index, H mapping image(match scale) -> page(match scale), image scale, page scale, inliers) or None."""
    s_img = min(1.0, MATCH_SIDE / max(image_gray.shape[:2]))
    small = cv2.resize(image_gray, None, fx=s_img, fy=s_img, interpolation=cv2.INTER_AREA) if s_img < 1 else image_gray
    kp, des = _features(small)
    if des is None or len(kp) < MIN_INLIERS:
        return None
    xy = np.float32([k.pt for k in kp])
    matcher = cv2.FlannBasedMatcher({"algorithm": 1, "trees": 4}, {"checks": 64})
    best = None
    for page, (p_scale, p_xy, p_des) in enumerate(_page_features(str(pdf_path), _digest(pdf_path))):
        if p_des is None or len(p_xy) < MIN_INLIERS:
            continue
        cv2.setRNGSeed(7)                       # FLANN trees and RANSAC sampling: same answer every run
        pairs = matcher.knnMatch(des, p_des, k=2)
        good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
        if len(good) < MIN_INLIERS:
            continue
        src = xy[[m.queryIdx for m in good]].reshape(-1, 1, 2)
        dst = p_xy[[m.trainIdx for m in good]].reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 3.0, maxIters=5000, confidence=0.999)
        if H is None or mask is None:
            continue
        inliers = int(mask.sum())
        if inliers >= MIN_INLIERS:          # refit on the inliers only: a more exact alignment
            keep = mask.ravel() > 0
            H2, _ = cv2.findHomography(src[keep], dst[keep], 0)
            if H2 is not None and np.isfinite(H2).all():
                H = H2
        if inliers >= MIN_INLIERS and inliers / len(good) >= MIN_INLIER_RATIO and (best is None or inliers > best[4]):
            best = (page, H, s_img, p_scale, inliers)
    return best


def _ink(gray: np.ndarray) -> np.ndarray:
    """Dark pixels (lines and text) as a boolean mask."""
    return gray < 200


def _refine(ref: np.ndarray, img: np.ndarray, H: np.ndarray) -> np.ndarray:
    """Sub-pixel correction with ECC on a downscaled copy; H maps ref -> img."""
    try:
        s = min(1.0, 1600 / max(img.shape[:2]))
        S = np.diag([s, s, 1.0])
        warped = cv2.warpPerspective(ref, S @ H, (int(img.shape[1] * s), int(img.shape[0] * s)), borderValue=255)
        target = cv2.resize(img, (warped.shape[1], warped.shape[0]), interpolation=cv2.INTER_AREA)
        a = cv2.GaussianBlur(255 - warped, (5, 5), 0).astype(np.float32)
        b = cv2.GaussianBlur(255 - target, (5, 5), 0).astype(np.float32)
        warp = np.eye(3, dtype=np.float32)
        _, warp = cv2.findTransformECC(b, a, warp, cv2.MOTION_HOMOGRAPHY,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), None, 5)
        # warp maps target coords -> warped coords; correct H in full resolution
        fix = np.linalg.inv(S) @ np.linalg.inv(warp.astype(np.float64)) @ S
        return fix @ H
    except cv2.error:
        return H


def _quick_share(gray, pdf_path, page, H_match, s_img, p_scale) -> float:
    """Changed-ink share at matching resolution: a cheap test that rejects real photos
    (whose feature matches with a CAD sheet are coincidences) before the full comparison."""
    small = cv2.resize(gray, None, fx=s_img, fy=s_img, interpolation=cv2.INTER_AREA) if s_img < 1 else gray
    ref = _render(pdf_path, page, p_scale)
    warped = cv2.warpPerspective(ref, np.linalg.inv(H_match), (small.shape[1], small.shape[0]), borderValue=255)
    valid = cv2.warpPerspective(np.full(ref.shape, 255, np.uint8), np.linalg.inv(H_match),
                                (small.shape[1], small.shape[0]), flags=cv2.INTER_NEAREST) > 0
    a, r = _ink(small) & valid, _ink(warped) & valid
    k = np.ones((5, 5), np.uint8)
    diff = (a & ~(cv2.dilate(r.astype(np.uint8), k) > 0)).sum() + (r & ~(cv2.dilate(a.astype(np.uint8), k) > 0)).sum()
    return float(diff) / max(1, int(r.sum()))


def _ocr(gray_crop: np.ndarray, tesseract_cmd: str | None) -> str:
    if gray_crop.size == 0 or min(gray_crop.shape) < 4:
        return ""
    try:
        import pytesseract
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        k = max(1.0, 64 / gray_crop.shape[0])
        big = cv2.resize(gray_crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC) if k > 1 else gray_crop
        big = cv2.copyMakeBorder(big, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=255)
        lines = gray_crop.shape[0] > 2.2 * min(gray_crop.shape[1], 40) / 4   # rough: several lines of text?
        text = pytesseract.image_to_string(big, config=f"--psm {6 if lines else 7}")
        return " ".join(text.split())[:60]
    except Exception:                     # pragma: no cover - OCR is a nice-to-have here
        return ""


# --------------------------------------------------------------------------- #
# main entry
# --------------------------------------------------------------------------- #
def compare(image_bgr: np.ndarray, pdf_path: Path, tag_check=None, tesseract_cmd: str | None = None) -> dict | None:
    """Compare one uploaded image with the drawing. None when the image is not a view of the drawing.

    tag_check(text) -> bool says which drawing words are device tags (for coverage)."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY) if image_bgr.ndim == 3 else image_bgr
    found = find_page(gray, pdf_path)
    if not found:
        return None
    page, H_match, s_img, p_scale, inliers = found
    h, w = gray.shape
    if _quick_share(gray, pdf_path, page, H_match, s_img, p_scale) > NOT_SAME_SHARE:
        log.info("Drawing comparison: page %d had feature matches, but the image is not that sheet", page + 1)
        return None

    # page -> image transform at full image resolution; render the page so that one page
    # pixel is about one image pixel (sharp reference, no blurry upscaling)
    S_img, S_pg = np.diag([s_img, s_img, 1.0]), np.diag([p_scale, p_scale, 1.0])
    pts_to_img = np.linalg.inv(S_img) @ np.linalg.inv(H_match) @ S_pg          # PDF points -> image px
    zoom = float(np.sqrt(abs(np.linalg.det(pts_to_img[:2, :2]))))             # image px per PDF point
    r_scale = min(max(zoom, 1.0), 8.0)
    ref = _render(pdf_path, page, r_scale)
    H = pts_to_img @ np.diag([1 / r_scale, 1 / r_scale, 1.0])                 # ref px -> image px
    H = _refine(ref, gray, H)
    pts_to_img = H @ np.diag([r_scale, r_scale, 1.0])

    warped = cv2.warpPerspective(ref, H, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)
    valid = cv2.warpPerspective(np.full(ref.shape, 255, np.uint8), H, (w, h), flags=cv2.INTER_NEAREST) > 0
    valid = cv2.erode(valid.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0

    ink_img, ink_ref = _ink(gray) & valid, _ink(warped) & valid
    tol = max(2, int(round(min(w, h) / 700)))         # alignment / anti-aliasing tolerance (px)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * tol + 1, 2 * tol + 1))
    added = ink_img & ~(cv2.dilate(ink_ref.astype(np.uint8), k) > 0)
    removed = ink_ref & ~(cv2.dilate(ink_img.astype(np.uint8), k) > 0)
    # no morphological opening: it would erase 1-px strokes, i.e. exactly the small text changes
    added, removed = added.astype(np.uint8), removed.astype(np.uint8)

    total_ink = max(1, int(ink_ref.sum()))
    changed_share = (int(added.sum()) + int(removed.sum())) / total_ink
    words = _page_words(str(pdf_path), _digest(pdf_path), page)
    result = {"page": page + 1, "title": _title(pdf_path, page), "inliers": inliers, "zoom": round(zoom, 2),
              "changed_share": round(changed_share, 4), "changes": [], "in_view": {}, "reliable": True}

    # device tags of the sheet that lie inside the image -> coverage + exact boxes
    def to_img(box):
        x0, y0, x1, y1 = box
        q = cv2.perspectiveTransform(np.float32([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]).reshape(-1, 1, 2),
                                     pts_to_img).reshape(-1, 2)
        return [int(q[:, 0].min()), int(q[:, 1].min()), int(q[:, 0].max()), int(q[:, 1].max())]

    for wd in words:
        text = wd["text"].strip().upper()
        if tag_check and not tag_check(text):
            continue
        b = to_img(wd["box"])
        size = (b[2] - b[0]) * (b[3] - b[1])
        old = result["in_view"].get(text)
        # the same tag can also be written tiny inside a symbol: keep the biggest (the label)
        if b[0] >= 0 and b[1] >= 0 and b[2] < w and b[3] < h and (not old or size > (old[2] - old[0]) * (old[3] - old[1])):
            result["in_view"][text] = b

    if changed_share > NOT_SAME_SHARE:
        log.info("Drawing comparison: page %d had feature matches but the image is not that sheet "
                 "(%.0f%% of the ink differs) - treated as a photo", page + 1, 100 * changed_share)
        return None
    if changed_share > MAX_CHANGED_SHARE:
        result["reliable"] = False        # same sheet, but too different to list small changes
        log.info("Drawing comparison: page %d matched but %.0f%% of the ink differs - not listed",
                 page + 1, 100 * changed_share)
        return result

    # group nearby changed pixels into areas (a changed word = one area)
    both = ((added > 0) | (removed > 0)).astype(np.uint8)
    grow = cv2.dilate(both, cv2.getStructuringElement(cv2.MORPH_RECT, (6 * tol + 1, 4 * tol + 1)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(grow, connectivity=8)
    # sub-pixel misalignment leaves a few stray pixels around small text; a really changed character has
    # about 4 * zoom^2 or more changed pixels (a digit is ~18 px at zoom 1.3 and ~85 px at zoom 2.8)
    min_px = max(MIN_CHANGE_PX, int(round(4 * zoom * zoom)))
    areas = []
    for i in range(1, n):
        x, y, bw, bh, _ = stats[i]
        region = labels[y:y + bh, x:x + bw] == i
        a_mask = (added[y:y + bh, x:x + bw] > 0) & region
        r_mask = (removed[y:y + bh, x:x + bw] > 0) & region
        a, r = int(a_mask.sum()), int(r_mask.sum())
        if a + r < min_px:
            continue
        ys, xs = np.nonzero(a_mask | r_mask)          # tight box around the changed pixels
        areas.append((a + r, [int(x + xs.min()), int(y + ys.min()), int(x + xs.max() + 1), int(y + ys.max() + 1)], a, r))
    areas.sort(key=lambda t: -t[0])

    inv = np.linalg.inv(pts_to_img)
    for no, (size, box, a, r) in enumerate(areas[:MAX_CHANGES]):
        # "changed" needs real ink on both sides; a few stray pixels of misalignment must not turn
        # an erased symbol into a "change"
        kind = "changed" if min(a, r) >= min_px and min(a, r) > 0.4 * max(a, r) else ("added" if a > r else "removed")
        # the drawing's words at this place (exact, from the PDF) ...
        q = cv2.perspectiveTransform(np.float32([[box[0], box[1]], [box[2], box[3]]]).reshape(-1, 1, 2), inv).reshape(-1, 2)
        px0, py0, px1, py1 = q[0][0], q[0][1], q[1][0], q[1][1]
        hit = [wd for wd in words
               if wd["box"][0] < px1 and wd["box"][2] > px0 and wd["box"][1] < py1 and wd["box"][3] > py0]
        drawing_text = " ".join(wd["text"] for wd in hit)
        word_left = 1.0                          # share of the drawing word's ink that is still in the picture
        if len(hit) == 1:
            wb0 = to_img(hit[0]["box"])
            ink0 = int(ink_ref[max(0, wb0[1]):wb0[3] + 1, max(0, wb0[0]):wb0[2] + 1].sum())
            word_left = int(ink_img[max(0, wb0[1]):wb0[3] + 1, max(0, wb0[0]):wb0[2] + 1].sum()) / ink0 if ink0 else 1.0
        if kind == "removed" and len(hit) == 1:
            wb = to_img(hit[0]["box"])
            word_ink = int(ink_ref[max(0, wb[1]):wb[3] + 1, max(0, wb[0]):wb[2] + 1].sum())
            left_ink = int(ink_img[max(0, wb[1]):wb[3] + 1, max(0, wb[0]):wb[2] + 1].sum())
            # the word is still there (most of its ink remains) but part of it differs: a digit, a letter
            if word_ink and r < 0.5 * word_ink and left_ink >= 0.6 * word_ink:
                kind = "changed"
        pad = 2 * tol
        x0, y0, x1, y1 = max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad)
        # ... and what the image shows there: OCR over the whole drawing word(s) it touches
        image_text = ""
        if no < 15 and word_left >= 0.3:            # an erased word has nothing left to read
            if len(hit) == 1:                       # one word changed: read exactly that word
                b = to_img(hit[0]["box"])
                image_text = _ocr(gray[max(0, b[1] - 1):min(h, b[3] + 2), max(0, b[0] - 3):min(w, b[2] + 4)],
                                  tesseract_cmd)
                # keep the reading only when it looks like the same kind of text
                if not (image_text.isalnum() and abs(len(image_text) - len(hit[0]["text"])) <= 3):
                    image_text = ""
            elif not hit:
                image_text = _ocr(gray[y0:y1, x0:x1], tesseract_cmd)
            if image_text and drawing_text and image_text.replace(" ", "") == drawing_text.replace(" ", ""):
                image_text = drawing_text          # OCR agrees with the drawing: the change is not in the text
            elif image_text and drawing_text and kind == "removed":
                kind = "changed"                   # text is still there, but reads differently
        result["changes"].append({"bbox": [x0, y0, x1, y1], "kind": kind, "pixels": size,
                                  "drawing_text": drawing_text[:60], "image_text": image_text})
    log.info("Drawing comparison: page %d, %d inliers, %d differences", page + 1, inliers, len(result["changes"]))
    return result


# --------------------------------------------------------------------------- #
# use the comparison in the rule result
# --------------------------------------------------------------------------- #
def _overlaps(a, b) -> bool:
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def apply_to_result(result: dict, references: list[dict | None]) -> None:
    """Devices whose tag sits, unchanged, inside a matched image are present (the image
    matches the drawing pixel for pixel there), even when OCR could not read the small text.
    A tag inside a changed area stays as the rule engine found it."""
    by_photo = [(n, r) for n, r in enumerate(references) if r]
    if not by_photo:
        return
    confirmed = set()
    for c in result.get("components", []):
        if c["status"] != "missing" or not c.get("tag"):
            continue
        for n, ref in by_photo:
            box = ref["in_view"].get(c["tag"])
            if not box or not ref["reliable"]:
                continue
            if any(_overlaps(box, ch["bbox"]) for ch in ref["changes"]):
                continue
            c.update(status="ok", bbox=box, photo=n, read_as=c["tag"], confidence=None, matched_by="drawing")
            confirmed.add(c["tag"])
            break
    if confirmed:
        result["defects"] = [d for d in result["defects"]
                             if not (d["code"] in ("COMPONENT_MISSING", "LABEL_MISSING") and d["item"] in confirmed)]
