"""Application configuration. Every value can be overridden with an environment
variable (or a .env file in the project root)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # --- Flask -------------------------------------------------------------
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_UPLOAD_MB", "25")) * 1024 * 1024
    JSON_SORT_KEYS = False

    # --- CORS (comma separated list, "*" = allow all) -----------------------
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

    # --- Storage -----------------------------------------------------------
    STORAGE_DIR = Path(os.getenv("STORAGE_DIR", BASE_DIR / "storage"))
    DATABASE_PATH = Path(os.getenv("DATABASE_PATH", STORAGE_DIR / "inspections.db"))

    ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    ALLOWED_PDF_EXT = {".pdf"}
    ALLOWED_EXCEL_EXT = {".xlsx", ".xls", ".csv"}

    # --- Vision ------------------------------------------------------------
    # Path to a YOLO .pt model trained on your cabinet components. If empty or
    # the file / `ultralytics` package is missing, the OpenCV fallback is used.
    YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "")
    VISION_CONF_THRESHOLD = float(os.getenv("VISION_CONF_THRESHOLD", "0.40"))

    # --- OCR ---------------------------------------------------------------
    OCR_ENGINE = os.getenv("OCR_ENGINE", "auto")          # auto | tesseract | easyocr
    TESSERACT_CMD = os.getenv("TESSERACT_CMD", "")         # e.g. C:\Program Files\Tesseract-OCR\tesseract.exe
    OCR_MIN_CONFIDENCE = float(os.getenv("OCR_MIN_CONFIDENCE", "40"))  # 0-100

    # --- Rule engine -------------------------------------------------------
    # Regex for things that look like device tags (K1, -Q12, X1, F3.1 ...)
    TAG_PATTERN = os.getenv("TAG_PATTERN", r"^-?[A-Z]{1,3}\d{1,4}(\.\d{1,3})?$")
    CHECK_WIRE_LABELS = _bool("CHECK_WIRE_LABELS", True)
    REPORT_UNEXPECTED_LABELS = _bool("REPORT_UNEXPECTED_LABELS", True)


class TestConfig(Config):
    TESTING = True
