"""Vision Service -> detects components in the cabinet photo.

Backends
--------
yolo   : used when YOLO_MODEL_PATH points to a .pt file, `ultralytics` is installed AND
         the model has classes that are cabinet components (circuit breaker, contactor,
         relay, terminal block, fuse, switch, indicator lamp, label ...). Big photos are
         cut into overlapping tiles, every tile is run through the model, boxes are
         mapped back to the original photo and duplicates are merged.
opencv : fallback with no training needed. Finds rectangular component bodies with
         contour analysis. It locates components but cannot tell their type, so the
         rule engine then relies on the OCR tags for identity.

A model trained on everyday objects (e.g. the official COCO weights) loads fine but has
no cabinet classes - it is reported as such and the OpenCV fallback is used. Detections
are never invented.

Each detection: {"type", "class_name", "confidence", "bbox": [x1,y1,x2,y2]}  (photo pixels)
"""
import logging
import re
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)

# the component classes the detector pipeline is prepared for (custom weights can add more)
COMPONENT_CLASSES = ("circuit_breaker", "contactor", "relay", "terminal_block", "fuse",
                     "switch", "indicator_lamp", "label")


# --------------------------------------------------------------------------- #
# class names -> component types
# --------------------------------------------------------------------------- #
def parse_class_map(text: str | None) -> dict[str, str]:
    """YOLO_CLASS_MAP='mcb=circuit_breaker,km=contactor' -> {'mcb': 'circuit_breaker', ...}"""
    out = {}
    for part in (text or "").split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            if k.strip() and v.strip():
                out[k.strip().lower()] = v.strip().lower()
    return out


# Fixed vocabulary of cabinet-component terms. A model class counts only when one of these
# terms appears in its name as a WHOLE word / phrase - so 'parking meter' or 'traffic light'
# from everyday-object weights can never be taken for a cabinet device.
_VOCABULARY: list[tuple[str, str]] = sorted([
    ("circuit breaker", "circuit_breaker"), ("breaker", "circuit_breaker"), ("mcb", "circuit_breaker"),
    ("mccb", "circuit_breaker"), ("rccb", "circuit_breaker"), ("rcbo", "circuit_breaker"), ("isolator", "circuit_breaker"),
    ("contactor", "contactor"), ("relay", "relay"), ("overload relay", "relay"), ("timer relay", "relay"),
    ("terminal block", "terminal_block"), ("terminal", "terminal_block"), ("terminals", "terminal_block"),
    ("fuse", "fuse"), ("fuse holder", "fuse"),
    ("switch", "switch"), ("selector switch", "switch"), ("push button", "switch"), ("pushbutton", "switch"),
    ("indicator lamp", "indicator_lamp"), ("indicator", "indicator_lamp"), ("pilot lamp", "indicator_lamp"),
    ("pilot light", "indicator_lamp"), ("signal lamp", "indicator_lamp"),
    ("label", "label"), ("tag", "label"), ("marker", "label"), ("nameplate", "label"), ("ferrule", "label"),
    ("power supply", "power_supply"), ("psu", "power_supply"), ("plc", "plc"), ("vfd", "vfd"),
    ("energy meter", "energy_meter"), ("surge protector", "surge_protector"), ("spd", "surge_protector"),
    ("transformer", "transformer"),
], key=lambda v: -len(v[0]))          # longest phrase first ("overload relay" before "relay")


def component_type(class_name: str, class_map: dict[str, str] | None = None) -> str | None:
    """Model class name -> component type, or None when it is not a cabinet component
    (e.g. 'person', 'car' or 'parking meter' from COCO weights)."""
    name = (class_name or "").strip().lower()
    if class_map and name in class_map:
        return class_map[name]
    words = " " + re.sub(r"[^a-z0-9]+", " ", name).strip() + " "
    for phrase, ctype in _VOCABULARY:
        if f" {phrase} " in words:
            return ctype
    return None


# --------------------------------------------------------------------------- #
# tiling and duplicate merging (pure functions, unit tested)
# --------------------------------------------------------------------------- #
def tile_grid(width: int, height: int, tile: int, overlap: float) -> list[tuple[int, int, int, int]]:
    """Overlapping tiles (x1, y1, x2, y2) that cover the whole image; the last tile of a row /
    column is aligned to the image edge so no strip is left out."""
    tile = max(64, int(tile))
    step = max(1, int(tile * (1 - min(max(overlap, 0.0), 0.9))))

    def starts(size):
        if size <= tile:
            return [0]
        s = list(range(0, size - tile + 1, step))
        if s[-1] != size - tile:
            s.append(size - tile)
        return s

    return [(x, y, min(width, x + tile), min(height, y + tile)) for y in starts(height) for x in starts(width)]


def _iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter == 0:
        return 0.0
    area = lambda r: max(1, (r[2] - r[0]) * (r[3] - r[1]))
    return inter / float(area(a) + area(b) - inter)


def _containment(a, b) -> float:
    """Share of the smaller box that lies inside the other one."""
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return (ix * iy) / smaller if smaller > 0 else 0.0


def merge_detections(detections: list[dict], iou_thr: float = 0.5, contain_thr: float = 0.7) -> list[dict]:
    """Class-aware non-maximum suppression across tiles. Overlapping boxes of the same class
    are one object: a heavily overlapping duplicate is dropped; a device cut by a tile edge
    (one box mostly inside the other) is merged into one box covering both parts."""
    kept: list[dict] = []
    for d in sorted(detections, key=lambda d: -d["confidence"]):
        for k in kept:
            if k["type"] != d["type"]:
                continue
            # one box (mostly) inside the other: the same object, one view clipped by a tile edge
            if _containment(k["bbox"], d["bbox"]) > contain_thr:
                k["bbox"] = [min(k["bbox"][0], d["bbox"][0]), min(k["bbox"][1], d["bbox"][1]),
                             max(k["bbox"][2], d["bbox"][2]), max(k["bbox"][3], d["bbox"][3])]
                break
            if _iou(k["bbox"], d["bbox"]) > iou_thr:          # plain duplicate
                break
        else:
            kept.append(dict(d))
    return kept


def detect_tiled(image: np.ndarray, predict, tile: int = 1280, overlap: float = 0.2,
                 class_map: dict[str, str] | None = None, iou_thr: float = 0.5, batch: int = 4) -> tuple[list[dict], int]:
    """Run `predict` on overlapping tiles and map the boxes back to the photo.
    predict(list_of_crops) -> one list per crop of (class_name, confidence, [x1, y1, x2, y2]) in
    crop pixels. Returns (merged detections, number of tiles)."""
    h, w = image.shape[:2]
    tiles = tile_grid(w, h, tile, overlap) if max(h, w) > tile * 1.15 else [(0, 0, w, h)]
    raw = []
    for i in range(0, len(tiles), batch):
        group = tiles[i:i + batch]
        crops = [image[y1:y2, x1:x2] for x1, y1, x2, y2 in group]      # views, no copies
        for (x1, y1, x2, y2), found in zip(group, predict(crops)):
            for class_name, conf, box in found:
                ctype = component_type(class_name, class_map)
                if ctype is None:                                     # not a cabinet component
                    continue
                bx1, by1, bx2, by2 = box
                raw.append({"type": ctype, "class_name": class_name, "confidence": round(float(conf), 3),
                            "bbox": [int(max(0, bx1 + x1)), int(max(0, by1 + y1)),
                                     int(min(w, bx2 + x1)), int(min(h, by2 + y1))]})
    return merge_detections(raw, iou_thr), len(tiles)


def summarize(detections: list[dict], height: int, bands: int = 4) -> dict:
    """Counts per class for the whole photo and per horizontal band R1..R4 (top to bottom)."""
    def count(items):
        out: dict[str, int] = {}
        for d in items:
            out[d["type"]] = out.get(d["type"], 0) + 1
        return out

    band_h = max(1, height / bands)
    regions = []
    for b in range(bands):
        inside = [d for d in detections if int(((d["bbox"][1] + d["bbox"][3]) / 2) // band_h) == b]
        regions.append({"id": f"R{b + 1}", "y1": int(b * band_h), "y2": int((b + 1) * band_h),
                        "total": len(inside), "by_class": count(inside)})
    return {"total": len(detections), "by_class": count(detections), "regions": regions}


# --------------------------------------------------------------------------- #
# YOLO model (loaded once per weights file, reused by every request)
# --------------------------------------------------------------------------- #
def _ultralytics_installed() -> bool:
    try:
        import ultralytics  # noqa: F401
        return True
    except ImportError:
        return False


@lru_cache(maxsize=2)
def _load_yolo(model_path: str):
    from ultralytics import YOLO  # optional dependency
    model = YOLO(model_path)
    log.info("YOLO weights loaded once from %s (%d classes)", model_path, len(model.names))
    return model


def yolo_status(model_path: str, class_map: dict[str, str] | None = None) -> dict:
    """Why YOLO is / is not used. Never raises."""
    if not model_path:
        return {"active": False, "state": "not_configured", "note": "YOLO_MODEL_PATH is not set."}
    if not Path(model_path).is_file():
        return {"active": False, "state": "weights_missing", "note": f"Weights file not found: {model_path}"}
    if not _ultralytics_installed():
        return {"active": False, "state": "ultralytics_missing", "note": "pip install ultralytics to use YOLO."}
    try:
        model = _load_yolo(model_path)
    except Exception as exc:                                   # corrupt / incompatible weights
        return {"active": False, "state": "load_failed", "note": f"Could not load the weights: {exc}"}
    names = [str(n) for n in model.names.values()]
    usable = {n: component_type(n, class_map) for n in names}
    usable = {n: t for n, t in usable.items() if t}
    base = {"model": Path(model_path).name, "classes": names, "component_classes": usable}
    if not usable:
        sample = ", ".join(names[:5])
        return {**base, "active": False, "state": "no_component_classes",
                "note": f"The weights load ({len(names)} classes, e.g. {sample}) but none of them is a cabinet "
                        f"component, so they cannot detect breakers, contactors etc. A custom-trained model is needed."}
    return {**base, "active": True, "state": "active", "note": f"YOLO active with {len(usable)} component classes."}


def _yolo_predict(model, conf: float, imgsz: int, iou: float, device: str):
    def predict(crops):
        results = model.predict(crops, conf=conf, imgsz=imgsz, iou=iou, verbose=False, device=device or None)
        out = []
        for r in results:
            found = []
            for box in r.boxes:
                found.append((r.names[int(box.cls[0])], float(box.conf[0]), [float(v) for v in box.xyxy[0].tolist()]))
            out.append(found)
        return out
    return predict


# --------------------------------------------------------------------------- #
# OpenCV fallback
# --------------------------------------------------------------------------- #
def _nms(boxes: list[list[int]], iou_thr: float = 0.4) -> list[list[int]]:
    if not boxes:
        return []
    arr = np.array(boxes, dtype=float)
    areas = (arr[:, 2] - arr[:, 0]) * (arr[:, 3] - arr[:, 1])
    order = areas.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(boxes[i])
        xx1 = np.maximum(arr[i, 0], arr[order[1:], 0])
        yy1 = np.maximum(arr[i, 1], arr[order[1:], 1])
        xx2 = np.minimum(arr[i, 2], arr[order[1:], 2])
        yy2 = np.minimum(arr[i, 3], arr[order[1:], 3])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        # drop boxes mostly inside the bigger one (text, screws, LEDs on a device)
        contained = inter / areas[order[1:]]
        order = order[1:][contained < iou_thr]
    return keep


def _detect_opencv(image: np.ndarray) -> list[dict]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = gray.shape[:2]
    img_area = h * w
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    # RETR_LIST (not EXTERNAL): devices touching a rail are nested inside the
    # rail's outline; the size filter + NMS below then pick the device boxes
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    boxes = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh
        # a single device is rarely >10 % of a cabinet photo; bigger boxes are
        # usually several devices joined by a DIN rail / duct edge
        if not (0.002 * img_area < area < 0.10 * img_area):
            continue
        aspect = bw / float(bh)
        if not (0.15 < aspect < 6.0):
            continue
        # how "box-like" the contour is: real devices are solid rectangles
        if cv2.contourArea(c) / float(area) < 0.45:
            continue
        boxes.append([x, y, x + bw, y + bh])

    return [{"type": "unknown", "class_name": "component", "confidence": 0.5, "bbox": b}
            for b in _nms(boxes)]


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def backend_status(model_path: str, class_map_text: str = "") -> dict:
    """Used by /api/health and at startup."""
    status = yolo_status(model_path, parse_class_map(class_map_text))
    if status["active"]:
        return {"available": True, "backend": "yolo", "yolo": status}
    return {"available": True, "backend": "opencv", "yolo": status,
            "note": f"OpenCV fallback detector in use. {status['note']}"}


def detect_components(image: np.ndarray, model_path: str = "", conf: float = 0.4, *, imgsz: int = 1024,
                      tile: int = 1280, overlap: float = 0.2, iou: float = 0.5, device: str = "",
                      class_map_text: str = "") -> dict:
    class_map = parse_class_map(class_map_text)
    status = yolo_status(model_path, class_map)
    h = image.shape[0]
    if status["active"]:
        predict = _yolo_predict(_load_yolo(model_path), conf, imgsz, iou, device)
        found, n_tiles = detect_tiled(image, predict, tile, overlap, class_map, iou)
        found = [d for d in found if d["confidence"] >= conf]
        devices = [d for d in found if d["type"] != "label"]
        labels = [d for d in found if d["type"] == "label"]
        log.info("Vision (yolo, %d tiles): %d devices, %d labels", n_tiles, len(devices), len(labels))
        return {"backend": "yolo", "typed": True, "detections": devices, "labels": labels,
                "tiles": n_tiles, "yolo": status, "summary": summarize(found, h)}
    detections = _detect_opencv(image)
    log.info("Vision (opencv): %d detections", len(detections))
    return {"backend": "opencv", "typed": False, "detections": detections, "labels": [], "tiles": 1,
            "yolo": status, "summary": summarize(detections, h)}
