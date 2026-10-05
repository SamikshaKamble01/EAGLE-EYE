"""Vision Service -> AI detects components in the cabinet photo.

Backends
--------
yolo   : used when YOLO_MODEL_PATH points to a trained .pt file and the
         `ultralytics` package is installed. Returns typed detections
         (contactor, circuit_breaker, ...) - this is the real AI path.
opencv : fallback with no training needed. Finds rectangular component bodies
         with contour analysis. It locates components but cannot tell their
         type, so the rule engine then relies on the OCR tags for identity.

Each detection: {"type", "class_name", "confidence", "bbox": [x1,y1,x2,y2]}
"""
import logging
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from app.utils.text import canonical_type

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# YOLO
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=2)
def _load_yolo(model_path: str):
    from ultralytics import YOLO  # optional dependency
    return YOLO(model_path)


def _yolo_available(model_path: str) -> bool:
    if not model_path or not Path(model_path).is_file():
        return False
    try:
        import ultralytics  # noqa: F401
        return True
    except ImportError:
        return False


def _detect_yolo(image: np.ndarray, model_path: str, conf: float) -> list[dict]:
    model = _load_yolo(model_path)
    result = model.predict(image, conf=conf, verbose=False)[0]
    detections = []
    for box in result.boxes:
        cls_name = result.names[int(box.cls[0])]
        ctype = canonical_type(cls_name)
        detections.append({
            "type": ctype if ctype != "unknown" else cls_name.lower(),
            "class_name": cls_name,
            "confidence": round(float(box.conf[0]), 3),
            "bbox": [int(v) for v in box.xyxy[0].tolist()],
        })
    return detections


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
def backend_status(model_path: str) -> dict:
    if _yolo_available(model_path):
        return {"available": True, "backend": "yolo", "model": model_path}
    reason = "YOLO_MODEL_PATH not set" if not model_path else (
        "model file not found" if not Path(model_path).is_file() else "ultralytics not installed")
    return {"available": True, "backend": "opencv", "note": f"Fallback detector in use ({reason})."}


def detect_components(image: np.ndarray, model_path: str = "", conf: float = 0.4) -> dict:
    if _yolo_available(model_path):
        detections = [d for d in _detect_yolo(image, model_path, conf) if d["confidence"] >= conf]
        backend, typed = "yolo", True
    else:
        detections = _detect_opencv(image)
        backend, typed = "opencv", False
    log.info("Vision (%s): %d detections", backend, len(detections))
    return {"backend": backend, "typed": typed, "detections": detections}
