from flask import Blueprint, current_app, jsonify

from app.services import ocr_service, vision_service

bp = Blueprint("health", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    cfg = current_app.config
    ocr = ocr_service.engine_status(cfg["OCR_ENGINE"], cfg["TESSERACT_CMD"])
    vision = vision_service.backend_status(cfg["YOLO_MODEL_PATH"])
    ok = ocr["available"] and vision["available"]
    return jsonify({"status": "ok" if ok else "degraded", "services": {
        "pdf": {"available": True},
        "excel": {"available": True},
        "vision": vision,
        "ocr": ocr,
        "database": {"available": True, "path": str(cfg["DATABASE_PATH"])},
    }}), 200 if ok else 503
