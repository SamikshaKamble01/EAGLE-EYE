"""PDF Service -> expected components.

Reads the bill of materials / component list out of the drawing PDF.
1. Tables first (pdfplumber), finding the tag / description / qty columns by
   their header names.
2. If no usable table exists, falls back to text lines like "K1  Contactor 24VDC".

Tag ranges such as "F1-F3" or "X1, X2" are expanded to individual tags.
"""
import logging
import re
from pathlib import Path

import pdfplumber

from app.errors import ParseError
from app.utils.text import canonical_type, normalize_label

log = logging.getLogger(__name__)

TAG_HEADERS = ("tag", "ref", "reference", "designation", "device", "bmk", "symbol", "label", "id")
DESC_HEADERS = ("description", "component", "type", "name", "part", "item", "material")
QTY_HEADERS = ("qty", "quantity", "nos", "count")

_TAG_RE = re.compile(r"-?[A-Z]{1,3}\d{1,4}(?:\.\d{1,3})?")
_LINE_RE = re.compile(r"^\s*(-?[A-Z]{1,3}\d{1,4}(?:\.\d{1,3})?)\s*[:\-–|]?\s+(.{3,})$")
_RANGE_RE = re.compile(r"^(-?[A-Z]{1,3})(\d{1,4})\s*(?:-|–|\.\.|to)\s*(?:[A-Z]{1,3})?(\d{1,4})$", re.I)


def _match_col(header: list[str], names: tuple[str, ...]) -> int | None:
    for idx, cell in enumerate(header):
        cell_l = (cell or "").strip().lower()
        if any(cell_l == n or cell_l.startswith(n + " ") or cell_l.startswith(n + ".") or n in cell_l.split()
               for n in names):
            return idx
    return None


def expand_tags(raw: str) -> list[str]:
    """'F1-F3' -> [F1, F2, F3] ; 'X1, X2' -> [X1, X2] ; 'K1' -> [K1]"""
    raw = (raw or "").strip().upper()
    if not raw:
        return []
    tags: list[str] = []
    for part in re.split(r"[,;/\n]+", raw):
        part = part.strip()
        if not part:
            continue
        m = _RANGE_RE.match(part)
        if m:
            prefix, start, end = m.group(1), int(m.group(2)), int(m.group(3))
            if 0 < end - start < 200:
                tags.extend(normalize_label(f"{prefix}{n}") for n in range(start, end + 1))
                continue
        found = _TAG_RE.findall(part)
        tags.extend(normalize_label(t) for t in (found or [part]))
    return [t for t in tags if t]


def _parse_qty(value) -> int:
    m = re.search(r"\d+", str(value or ""))
    return max(int(m.group(0)), 1) if m else 1


def _from_tables(pdf) -> list[dict]:
    items: list[dict] = []
    for page_no, page in enumerate(pdf.pages, 1):
        for table in page.extract_tables() or []:
            rows = [[(c or "").strip() for c in row] for row in table if row and any(row)]
            if len(rows) < 2:
                continue
            # header may not be the very first row (title rows above it)
            for h_idx in range(min(3, len(rows) - 1)):
                header = rows[h_idx]
                tag_col = _match_col(header, TAG_HEADERS)
                desc_col = _match_col(header, DESC_HEADERS)
                qty_col = _match_col(header, QTY_HEADERS)
                if tag_col is None and desc_col is None:
                    continue
                for row in rows[h_idx + 1:]:
                    desc = row[desc_col] if desc_col is not None and desc_col < len(row) else ""
                    qty = _parse_qty(row[qty_col]) if qty_col is not None and qty_col < len(row) else 1
                    raw_tag = row[tag_col] if tag_col is not None and tag_col < len(row) else ""
                    tags = expand_tags(raw_tag)
                    if tags:
                        for tag in tags:
                            items.append(_item(tag, desc, 1, f"table p{page_no}"))
                    elif desc:
                        # untagged line, e.g. "DIN rail terminals | 20"
                        items.append(_item(None, desc, qty, f"table p{page_no}"))
                break
    return items


def _from_text(pdf) -> list[dict]:
    items: list[dict] = []
    for page_no, page in enumerate(pdf.pages, 1):
        for line in (page.extract_text() or "").splitlines():
            m = _LINE_RE.match(line)
            if m:
                items.append(_item(normalize_label(m.group(1)), m.group(2).strip(), 1, f"text p{page_no}"))
    return items


def _item(tag, description, qty, source) -> dict:
    return {
        "tag": tag,
        "type": canonical_type(description, tag),
        "description": description or "",
        "quantity": qty,
        "source": source,
    }


def _dedupe(items: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    untagged: list[dict] = []
    for it in items:
        if it["tag"] is None:
            untagged.append(it)
        elif it["tag"] not in seen:
            seen[it["tag"]] = it
    return list(seen.values()) + untagged


def parse_expected_components(pdf_path: Path) -> list[dict]:
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages:
                raise ParseError("The PDF has no pages.")
            items = _from_tables(pdf)
            if not any(i["tag"] for i in items):
                items += _from_text(pdf)
    except ParseError:
        raise
    except Exception as exc:  # corrupted / encrypted PDF
        raise ParseError(f"Could not read the PDF: {exc}") from exc

    items = _dedupe(items)
    if not items:
        raise ParseError(
            "No components found in the PDF. Expected a table with a 'Tag' and "
            "'Description' column, or lines like 'K1  Contactor 24VDC'. "
            "Scanned (image-only) PDFs need OCR first."
        )
    log.info("PDF: %d expected components", len(items))
    return items
