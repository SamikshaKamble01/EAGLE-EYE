"""PDF Service -> expected components.

Reads the bill of materials / component list out of the drawing PDF.
1. Tables first (pdfplumber), finding the tag / description / qty columns by
   their header names.
2. If no usable table exists, falls back to text lines like "K1  Contactor 24VDC".
3. Full drawing sets (layout + nameplate pages, like real panel-builder drawings)
   often have a bill of material WITHOUT tags. Then the device tags are taken from
   the NAMEPLATE tables and the GENERAL ARRANGEMENT views, and described with the
   drawing's own ABBREVIATION sheet (CB -> circuit breaker, PS -> power supply ...).

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
    # names are tried in order of preference, so "ITEM SHORT DESCRIPTION" beats a plain "ITEM" column
    for n in names:
        for idx, cell in enumerate(header):
            cell_l = (cell or "").strip().lower()
            if cell_l == n or cell_l.startswith(n + " ") or cell_l.startswith(n + ".") or n in cell_l.split():
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


# --------------------------------------------------------------------------- #
# full drawing sets: nameplate tables + general arrangement views
# --------------------------------------------------------------------------- #
_DRAWING_TAG_RE = re.compile(r"^([A-Z]{1,5})(\d{1,3})([A-Z]?)$")


def _page_texts(pdf) -> list[str]:
    """Plain text of every page. pdfium (installed with pdfplumber) reads a dense CAD sheet in
    milliseconds, where pdfplumber's text extraction takes seconds per sheet."""
    try:
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(pdf.stream)
        try:
            return [doc[i].get_textpage().get_text_range() for i in range(len(doc))]
        finally:
            doc.close()
    except Exception:                      # pragma: no cover - fall back to the slow way
        return [p.extract_text() or "" for p in pdf.pages]


def _page_title(text: str) -> str:
    text = text.upper()
    m = re.search(r"([A-Z][A-Z0-9 &/,\-\(\)]{4,}?)\s+-\s+\d{2}[A-Z]{2}\d{3,}", text)   # "... - 13GE03331"
    return m.group(1) if m else text[:200]


def _abbreviations(page) -> dict[str, str]:
    """{"CB": "CIRCUIT BREAKER", ...} from an abbreviation sheet table."""
    out: dict[str, str] = {}
    for table in page.extract_tables() or []:
        for row in table:
            cells = [(c or "").strip() for c in row]
            for i in range(0, len(cells) - 1, 2):
                abbr, definition = cells[i], cells[i + 1]
                if re.fullmatch(r"[A-Z]{1,5}", abbr) and definition:
                    out[abbr] = definition
    return out


def _is_device_tag(text: str, prefixes: set[str]) -> bool:
    m = _DRAWING_TAG_RE.match(text)
    if not m:
        return False
    prefix, _, suffix = m.groups()
    if suffix and len(prefix) < 3:        # 'D5A', 'B1Y' are grid / hatch references, 'TERM1F' is a tag
        return False
    return prefix in prefixes or (prefix[0] == "X" and "X" in prefixes)   # XG11, XP1 ... are terminals


def _describe(tag: str, abbreviations: dict[str, str]) -> str:
    prefix = _DRAWING_TAG_RE.match(tag).group(1)
    for p in (prefix, prefix[:2], prefix[:1]):
        if p in abbreviations:
            return abbreviations[p].capitalize()
    return ""


def _tag_order(tag: str):
    m = _DRAWING_TAG_RE.match(tag)
    return (m.group(1), int(m.group(2)), m.group(3))


class _Pages:
    """Lets _from_tables run on a subset of pages."""
    def __init__(self, pages):
        self.pages = pages


def _from_drawing(pdf) -> list[dict] | None:
    """Tags from NAMEPLATE tables and GENERAL ARRANGEMENT views; None if the PDF has neither."""
    texts = _page_texts(pdf)
    titles = [_page_title(t) for t in texts]
    nameplate_pages = [i for i, t in enumerate(titles) if "NAMEPLATE" in t]
    ga_pages = [i for i, t in enumerate(titles) if "GENERAL ARRANGEMENT" in t]
    if not nameplate_pages and not ga_pages:
        return None

    abbreviations: dict[str, str] = {}
    for i, t in enumerate(titles):
        if "ABBREVIATION" in t:
            abbreviations.update(_abbreviations(pdf.pages[i]))

    # 1. nameplates = the labels that must be on the cabinet
    nameplate_tags: dict[str, int] = {}
    for i in nameplate_pages:
        for table in pdf.pages[i].extract_tables() or []:
            rows = [[(c or "").strip() for c in r] for r in table if r]
            if not rows:
                continue
            desc_cols = [j for j, c in enumerate(rows[0]) if c.upper() == "DESCRIPTION"]
            for row in rows[1:]:
                for j in desc_cols:
                    text = normalize_label(row[j]) if j < len(row) else ""
                    if _DRAWING_TAG_RE.match(text):
                        nameplate_tags.setdefault(text, i + 1)
    prefixes = set(abbreviations) | {_DRAWING_TAG_RE.match(t).group(1) for t in nameplate_tags}
    nameplate_tags = {t: p for t, p in nameplate_tags.items() if _is_device_tag(t, prefixes)}

    # 2. tags written on the layout views (devices that have no separate nameplate entry)
    ga_tags: dict[str, int] = {}
    for i in ga_pages:
        # pdfplumber, not pdfium: pdfium also returns hidden CAD text (block names such as
        # 'CB41 25A' inside a breaker symbol, fuse positions F1/F2 inside every terminal strip)
        for w in pdf.pages[i].extract_words():
            text = normalize_label(w["text"])
            if _is_device_tag(text, prefixes):
                ga_tags.setdefault(text, i + 1)

    items = []
    for tag in sorted(set(nameplate_tags) | set(ga_tags), key=_tag_order):
        source = f"nameplate p{nameplate_tags[tag]}" if tag in nameplate_tags else f"layout p{ga_tags[tag]}"
        description = _describe(tag, abbreviations)
        item = _item(tag, description, 1, source)
        if description and canonical_type(description) == "unknown":
            # the drawing says what it is (shield bar, thermostat ...): don't guess from the first letter
            item["type"] = re.sub(r"[^a-z]+", "_", re.sub(r"\(.*?\)", "", description.lower())).strip("_")
        items.append(item)

    # untagged material list (quantities) from the bill of material pages
    bom = _Pages([pdf.pages[i] for i, t in enumerate(titles) if "BILL OF MATERIAL" in t])
    items += [it for it in _from_tables(bom) if it["tag"] is None]
    log.info("PDF drawing set: %d tags (%d from nameplates, %d only on layout views)",
             sum(1 for it in items if it["tag"]), len(nameplate_tags), len(set(ga_tags) - set(nameplate_tags)))
    return items


def _cache_file(pdf_path: Path, cache_dir: Path) -> Path:
    import hashlib
    digest = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()[:32]
    return Path(cache_dir) / f"pdf_{digest}_v1.json"


class _Background:
    """A drawing being parsed by a separate python process (see parse_in_background)."""

    def __init__(self, pdf_path: Path, cache_dir: Path | None):
        import subprocess
        import sys
        import time
        self.pdf_path, self.cache_dir, self.proc = pdf_path, cache_dir, None
        self.started, self.parse_ms = time.time(), 0   # parse_ms stays 0 when the drawing was cached
        if cache_dir is not None and not _cache_file(pdf_path, cache_dir).is_file():
            try:
                self.proc = subprocess.Popen(
                    [sys.executable, "-m", "app.services.pdf_service", str(pdf_path), str(cache_dir)],
                    cwd=str(Path(__file__).resolve().parents[2]),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                self.proc = None

    def result(self) -> list[dict]:
        if self.proc is not None:
            try:
                self.proc.wait(timeout=600)
            except Exception:              # pragma: no cover
                self.proc.kill()
            cache = _cache_file(self.pdf_path, self.cache_dir)
            if cache.is_file():            # the child finished when it wrote the cache
                self.parse_ms = max(0, round((cache.stat().st_mtime - self.started) * 1000))
        # the cache is filled now (or the child failed: parse here, which also raises ParseError)
        return parse_expected_components_cached(self.pdf_path, self.cache_dir)


def parse_in_background(pdf_path: Path, cache_dir: Path | None) -> _Background:
    """Start reading the drawing in a separate process (so it overlaps the photo OCR
    instead of competing with it for Python's GIL). Call .result() to get the items."""
    return _Background(pdf_path, cache_dir)


def parse_expected_components_cached(pdf_path: Path, cache_dir: Path | None = None) -> list[dict]:
    """parse_expected_components, remembered by file content: re-checks and repeat
    inspections of the same drawing set (17 dense CAD sheets take ~20 s) are instant."""
    if cache_dir is None:
        return parse_expected_components(pdf_path)
    import json
    cache = _cache_file(pdf_path, cache_dir)
    if cache.is_file():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    items = parse_expected_components(pdf_path)
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(items), encoding="utf-8")
    except OSError:
        pass
    return items


def parse_expected_components(pdf_path: Path) -> list[dict]:
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages:
                raise ParseError("The PDF has no pages.")
            items = _from_drawing(pdf)
            if items is not None and not any(i["tag"] for i in items):
                items = None
            if items is None:
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


if __name__ == "__main__":       # python -m app.services.pdf_service <pdf> <cache dir>
    import sys
    try:
        parse_expected_components_cached(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception:            # the web process parses again and reports the error properly
        sys.exit(1)
