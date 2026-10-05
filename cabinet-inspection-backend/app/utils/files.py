"""Upload validation and storage."""
from pathlib import Path

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from app.errors import ValidationError

# First bytes of each accepted format - stops renamed / corrupted files early.
_MAGIC = {
    ".pdf": [b"%PDF"],
    ".xlsx": [b"PK\x03\x04"],
    ".xls": [b"\xd0\xcf\x11\xe0"],
    ".png": [b"\x89PNG"],
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".bmp": [b"BM"],
    ".webp": [b"RIFF"],
}


def validate_upload(file: FileStorage | None, field: str, allowed: set[str]) -> str:
    if file is None or not file.filename:
        raise ValidationError(f"Missing file field '{field}'.")
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise ValidationError(
            f"'{field}' must be one of {sorted(allowed)}, got '{ext or 'no extension'}'."
        )
    head = file.stream.read(8)
    file.stream.seek(0)
    if not head:
        raise ValidationError(f"'{field}' is empty.")
    signatures = _MAGIC.get(ext)
    if signatures and not any(head.startswith(sig) for sig in signatures):
        raise ValidationError(f"'{field}' content does not look like a valid {ext} file.")
    return ext


def save_upload(file: FileStorage, folder: Path, base_name: str, ext: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    original = secure_filename(file.filename) or f"{base_name}{ext}"
    path = folder / f"{base_name}__{original}"
    file.save(path)
    return path
