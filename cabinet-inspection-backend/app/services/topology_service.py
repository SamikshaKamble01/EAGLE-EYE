"""Documented electrical topology of a cabinet (which part feeds which), read from app/data/topology/.

A topology file lists only connections that are DRAWN on the schematic sheets, each with its
sheet number, plus an "unknown" list of what the drawings do not show. A cabinet without a
file has no topology: the impact analysis then says UNKNOWN instead of guessing.
See scripts/build_topology_13sp04331.py for how the 13SP04331 file is made.
"""
import json
import logging
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "topology"
_CABINET_TAG = re.compile(r"\b\d{2}[A-Z]{2}\d{5}\b")        # 13SP04331


def cabinet_tag(pdf_path: Path) -> str | None:
    """The cabinet tag named in the title blocks of the drawing (the tag on most pages)."""
    try:
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(str(pdf_path))
        try:
            pages = Counter()
            for i in range(len(doc)):
                pages.update(set(_CABINET_TAG.findall(doc[i].get_textpage().get_text_range())))
        finally:
            doc.close()
        return pages.most_common(1)[0][0] if pages else None
    except Exception:                      # pragma: no cover - a broken PDF is reported elsewhere
        return None


@lru_cache(maxsize=16)
def _load(tag: str, directory: str) -> dict | None:
    path = Path(directory) / f"{tag}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.exception("Topology file %s could not be read", path)
        return None


def load(tag: str | None, directory: Path | None = None) -> dict | None:
    """The topology of cabinet `tag`, or None when none was documented."""
    if not tag or not re.fullmatch(r"[0-9A-Z]{6,12}", tag):
        return None
    return _load(tag, str(directory or DATA_DIR))
