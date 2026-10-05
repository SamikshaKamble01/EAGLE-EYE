"""REST API for inspections."""
import logging
import re
import shutil
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_file, url_for

from app import db
from app.errors import AppError, NotFound, ValidationError
from app.services.inspection_pipeline import run_inspection
from app.utils.files import save_upload, validate_upload

log = logging.getLogger(__name__)
bp = Blueprint("inspections", __name__, url_prefix="/api")

_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def _links(inspection_id: str) -> dict:
    return {
        "self": url_for("inspections.get_one", inspection_id=inspection_id, _external=True),
        "report_pdf": url_for("inspections.get_report", inspection_id=inspection_id, _external=True),
        "annotated_image": url_for("inspections.get_annotated", inspection_id=inspection_id, _external=True),
        "original_image": url_for("inspections.get_original", inspection_id=inspection_id, _external=True),
    }


def _load(inspection_id: str, include_details: bool = True):
    if not _ID_RE.match(inspection_id):
        raise NotFound("Inspection not found.")
    data, row = db.get_inspection(inspection_id, include_details)
    if data is None:
        raise NotFound("Inspection not found.")
    return data, row


def _send_existing(path_str: str | None, mimetype: str, download_name: str, as_attachment=False):
    if not path_str or not Path(path_str).is_file():
        raise NotFound("File not available for this inspection.")
    return send_file(path_str, mimetype=mimetype, download_name=download_name, as_attachment=as_attachment)


# --------------------------------------------------------------------------- #
@bp.post("/inspections")
def create():
    """multipart/form-data: image, pdf, excel (+ optional cabinet_name)."""
    cfg = current_app.config
    files = request.files
    exts = {
        "image": validate_upload(files.get("image"), "image", cfg["ALLOWED_IMAGE_EXT"]),
        "pdf": validate_upload(files.get("pdf"), "pdf", cfg["ALLOWED_PDF_EXT"]),
        "excel": validate_upload(files.get("excel"), "excel", cfg["ALLOWED_EXCEL_EXT"]),
    }
    cabinet_name = (request.form.get("cabinet_name") or "").strip()[:120]
    if len(cabinet_name) > 0 and not re.match(r"^[\w\s\-./#()]+$", cabinet_name):
        raise ValidationError("cabinet_name contains invalid characters.")

    inspection_id = db.new_id()
    job_dir = cfg["STORAGE_DIR"] / "inspections" / inspection_id
    paths = {k: save_upload(files[k], job_dir / "uploads", k, ext) for k, ext in exts.items()}
    db.create_inspection(inspection_id, cabinet_name, paths)

    try:
        out = run_inspection(inspection_id, cabinet_name, paths, cfg, job_dir / "output")
    except AppError as exc:
        db.fail_inspection(inspection_id, exc.message)
        exc.details = {"inspection_id": inspection_id}
        raise
    except Exception as exc:
        log.exception("Inspection %s crashed", inspection_id)
        db.fail_inspection(inspection_id, f"Internal error: {exc}")
        raise

    db.complete_inspection(inspection_id, out["result"], out["annotated_path"], out["report_path"])
    data, _ = _load(inspection_id)
    data["links"] = _links(inspection_id)
    return jsonify(data), 201


@bp.get("/inspections")
def list_all():
    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 100)
        offset = max(int(request.args.get("offset", 0)), 0)
    except ValueError:
        raise ValidationError("limit and offset must be integers.")
    verdict = request.args.get("verdict")
    if verdict and verdict.upper() not in {"PASS", "FAIL"}:
        raise ValidationError("verdict must be PASS or FAIL.")
    items, total = db.list_inspections(limit, offset, verdict)
    for it in items:
        it["links"] = _links(it["id"])
    return jsonify({"items": items, "total": total, "limit": limit, "offset": offset})


@bp.get("/inspections/<inspection_id>")
def get_one(inspection_id):
    data, _ = _load(inspection_id)
    data["links"] = _links(inspection_id)
    return jsonify(data)


@bp.get("/inspections/<inspection_id>/defects")
def get_defects(inspection_id):
    _load(inspection_id, include_details=False)
    severity = request.args.get("severity")
    defects = db.list_defects(inspection_id)
    if severity:
        defects = [d for d in defects if d["severity"] == severity.lower()]
    return jsonify({"inspection_id": inspection_id, "defects": defects, "count": len(defects)})


@bp.get("/inspections/<inspection_id>/report")
def get_report(inspection_id):
    _, row = _load(inspection_id, include_details=False)
    download = request.args.get("download", "0") in {"1", "true"}
    return _send_existing(row["report_path"], "application/pdf",
                          f"inspection_{inspection_id[:8]}.pdf", as_attachment=download)


@bp.get("/inspections/<inspection_id>/annotated-image")
def get_annotated(inspection_id):
    _, row = _load(inspection_id, include_details=False)
    return _send_existing(row["annotated_path"], "image/png", f"annotated_{inspection_id[:8]}.png")


@bp.get("/inspections/<inspection_id>/image")
def get_original(inspection_id):
    _, row = _load(inspection_id, include_details=False)
    path = row["image_path"]
    mime = "image/png" if path and path.lower().endswith(".png") else "image/jpeg"
    return _send_existing(path, mime, Path(path).name if path else "image")


@bp.delete("/inspections/<inspection_id>")
def delete(inspection_id):
    _load(inspection_id, include_details=False)
    db.delete_inspection(inspection_id)
    shutil.rmtree(current_app.config["STORAGE_DIR"] / "inspections" / inspection_id, ignore_errors=True)
    return "", 204


@bp.get("/stats")
def stats():
    """Dashboard numbers: totals, pass rate, most common defects, recent runs."""
    data = db.get_stats()
    recent, _ = db.list_inspections(limit=5)
    data["recent"] = recent
    return jsonify(data)


# Alias matching the architecture diagram: POST /inspection
@bp.post("/inspection")
def create_alias():
    return create()
