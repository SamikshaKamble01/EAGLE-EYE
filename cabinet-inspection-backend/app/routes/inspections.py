"""REST API for inspections."""
import logging
import re
import shutil
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_file, url_for

from app import checks, db
from app.errors import AppError, NotFound, ValidationError
from app.services.inspection_pipeline import run_inspection
from app.utils.files import save_upload, validate_upload

log = logging.getLogger(__name__)
bp = Blueprint("inspections", __name__, url_prefix="/api")

_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_SNIPPET_RE = re.compile(r"^item_\d{3}\.png$")


def _links(inspection_id: str) -> dict:
    return {
        "self": url_for("inspections.get_one", inspection_id=inspection_id, _external=True),
        "report_pdf": url_for("inspections.get_report", inspection_id=inspection_id, _external=True),
        "annotated_image": url_for("inspections.get_annotated", inspection_id=inspection_id, _external=True),
        "original_image": url_for("inspections.get_original", inspection_id=inspection_id, _external=True),
        "checklist_xlsx": url_for("inspections.get_checklist", inspection_id=inspection_id, _external=True),
        "history": url_for("inspections.get_history", inspection_id=inspection_id, _external=True),
        "recheck": url_for("inspections.recheck", inspection_id=inspection_id, _external=True),
    }


def _load(inspection_id: str, include_details: bool = True):
    if not _ID_RE.match(inspection_id):
        raise NotFound("Inspection not found.")
    data, row = db.get_inspection(inspection_id, include_details)
    if data is None:
        raise NotFound("Inspection not found.")
    if include_details and data.get("result"):
        checks.ensure_sheet(data["result"])       # older inspections: build the check sheet on the fly
    return data, row


def _send_existing(path_str: str | None, mimetype: str, download_name: str, as_attachment=False):
    if not path_str or not Path(path_str).is_file():
        raise NotFound("File not available for this inspection.")
    return send_file(path_str, mimetype=mimetype, download_name=download_name, as_attachment=as_attachment)


# --------------------------------------------------------------------------- #
MAX_PHOTOS = 10


def _save_photos(job_dir: Path) -> list[Path]:
    """One or more `image` fields (several photos of the same cabinet)."""
    cfg = current_app.config
    photos = [f for f in request.files.getlist("image") if f and f.filename]
    if not photos:
        validate_upload(None, "image", cfg["ALLOWED_IMAGE_EXT"])        # raises "Missing file field 'image'"
    if len(photos) > MAX_PHOTOS:
        raise ValidationError(f"At most {MAX_PHOTOS} photos per inspection.")
    exts = [validate_upload(f, "image", cfg["ALLOWED_IMAGE_EXT"]) for f in photos]
    return [save_upload(f, job_dir / "uploads", f"image{n + 1}" if len(photos) > 1 else "image", ext)
            for n, (f, ext) in enumerate(zip(photos, exts))]


@bp.post("/inspections")
def create():
    """multipart/form-data: image (one or several photos), pdf, optional excel (+ optional cabinet_name)."""
    cfg = current_app.config
    files = request.files
    pdf_ext = validate_upload(files.get("pdf"), "pdf", cfg["ALLOWED_PDF_EXT"])
    has_excel = bool(files.get("excel") and files["excel"].filename)
    excel_ext = validate_upload(files.get("excel"), "excel", cfg["ALLOWED_EXCEL_EXT"]) if has_excel else None
    cabinet_name = (request.form.get("cabinet_name") or "").strip()[:120]
    if len(cabinet_name) > 0 and not re.match(r"^[\w\s\-./#()]+$", cabinet_name):
        raise ValidationError("cabinet_name contains invalid characters.")

    inspection_id = db.new_id()
    job_dir = cfg["STORAGE_DIR"] / "inspections" / inspection_id
    images = _save_photos(job_dir)
    paths = {"image": images[0], "images": images,
             "pdf": save_upload(files["pdf"], job_dir / "uploads", "pdf", pdf_ext),
             "excel": save_upload(files["excel"], job_dir / "uploads", "excel", excel_ext) if has_excel else None}
    db.create_inspection(inspection_id, cabinet_name, paths)
    return _run_and_respond(inspection_id, cabinet_name, paths, job_dir)


def _run_and_respond(inspection_id, cabinet_name, paths, job_dir, previous=None, round_no=1):
    try:
        out = run_inspection(inspection_id, cabinet_name, paths, current_app.config, job_dir / "output",
                             previous=previous, round_no=round_no)
    except AppError as exc:
        db.fail_inspection(inspection_id, exc.message)
        exc.details = {"inspection_id": inspection_id}
        raise
    except Exception as exc:
        log.exception("Inspection %s crashed", inspection_id)
        db.fail_inspection(inspection_id, f"Internal error: {exc}")
        raise

    db.complete_inspection(inspection_id, out["result"], out["annotated_path"], out["report_path"],
                           out.get("image_paths"), out.get("annotated_paths"))
    data, _ = _load(inspection_id)
    data["links"] = _links(inspection_id)
    return jsonify(data), 201


@bp.post("/inspections/<inspection_id>/recheck")
def recheck(inspection_id):
    """After a fix: multipart/form-data with one or more new `image` photos. The drawing
    and wire list of the earlier inspection are reused; the answer says which issues are
    now closed, which are still open and which are new."""
    cfg = current_app.config
    parent, row = _load(inspection_id)
    if parent["status"] != "completed" or "result" not in parent:
        raise ValidationError("Only a completed inspection can be re-checked.")
    if not row["pdf_path"] or not Path(row["pdf_path"]).is_file() or \
            (row["excel_path"] and not Path(row["excel_path"]).is_file()):
        raise NotFound("The drawing / wire list of this inspection is no longer stored.")

    new_id = db.new_id()
    job_dir = cfg["STORAGE_DIR"] / "inspections" / new_id
    uploads = job_dir / "uploads"
    images = _save_photos(job_dir)
    paths = {"image": images[0], "images": images, "excel": None}
    for key in ("pdf", "excel"):                       # own copies, so deleting one never breaks the other
        if row[f"{key}_path"]:
            paths[key] = Path(shutil.copy2(row[f"{key}_path"], uploads / Path(row[f"{key}_path"]).name))
    round_no = (row["round"] or 1) + 1
    cabinet_name = parent["cabinet_name"] or ""
    db.create_inspection(new_id, cabinet_name, paths, parent_id=inspection_id,
                         root_id=row["root_id"] or inspection_id, round_no=round_no)
    return _run_and_respond(new_id, cabinet_name, paths, job_dir, previous=parent["result"], round_no=round_no)


@bp.get("/inspections/<inspection_id>/history")
def get_history(inspection_id):
    """The first inspection of this cabinet and every re-check, oldest first."""
    _load(inspection_id, include_details=False)
    return jsonify({"inspection_id": inspection_id, "items": db.list_chain(inspection_id)})


@bp.get("/inspections/<inspection_id>/checklist.xlsx")
def get_checklist(inspection_id):
    """The filled QC check sheet as an Excel file."""
    _, row = _load(inspection_id, include_details=False)
    path = Path(row["report_path"]).with_name(f"{inspection_id}_checklist.xlsx") if row["report_path"] else None
    return _send_existing(str(path) if path else None,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                          f"qc_check_sheet_{inspection_id[:8]}.xlsx", as_attachment=True)


@bp.get("/inspections/<inspection_id>/snippets/<name>")
def get_snippet(inspection_id, name):
    """Zoomed photo crop that proves one FAIL of the check sheet."""
    _, row = _load(inspection_id, include_details=False)
    if not _SNIPPET_RE.match(name) or not row["report_path"]:
        raise NotFound("Snippet not found.")
    return _send_existing(str(Path(row["report_path"]).parent / "snippets" / name), "image/png", name)


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


def _photo_arg() -> int:
    try:
        return max(0, int(request.args.get("photo", 0)))
    except ValueError:
        raise ValidationError("photo must be a number.")


@bp.get("/inspections/<inspection_id>/annotated-image")
def get_annotated(inspection_id):
    """?photo=N (0-based) picks one of several photos."""
    _, row = _load(inspection_id, include_details=False)
    marked, n = db.photo_paths(row, "annotated"), _photo_arg()
    return _send_existing(marked[n] if n < len(marked) else None, "image/png", f"annotated_{inspection_id[:8]}_{n + 1}.png")


@bp.get("/inspections/<inspection_id>/image")
def get_original(inspection_id):
    """?photo=N (0-based) picks one of several photos."""
    _, row = _load(inspection_id, include_details=False)
    photos, n = db.photo_paths(row, "image"), _photo_arg()
    path = photos[n] if n < len(photos) else None
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
