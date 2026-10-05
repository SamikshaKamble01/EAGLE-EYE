"""Excel Service -> expected wiring / labels.

Reads every sheet of a wiring list (.xlsx / .xls / .csv), finds the header row
automatically (it does not have to be row 1) and maps columns by name:

    wire number : Wire No / Wire / Ferrule / Label / Cable / Marking
    from        : From / Source / Start
    to          : To / Destination / Dest / End
    colour      : Colour / Color
    size        : Size / Cross Section / mm2 / AWG
"""
import logging
import re
from pathlib import Path

import pandas as pd

from app.errors import ParseError
from app.utils.text import normalize_label

log = logging.getLogger(__name__)

# Order matters: the more specific columns are claimed first so that
# "Wire Colour" becomes colour and not wire number.
COLUMN_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("color", ("colour", "color")),
    ("size", ("size", "cross section", "cross-section", "mm2", "mm²", "awg", "gauge", "csa")),
    ("from", ("from", "source", "start", "from terminal")),
    ("to", ("to", "destination", "dest", "end", "to terminal")),
    ("wire_no", ("wire no", "wire number", "wire", "ferrule", "label", "cable", "marking", "wire id", "no")),
]


def _words(cell) -> str:
    return " " + re.sub(r"[^a-z0-9²]+", " ", str(cell).lower()).strip() + " "


def _map_header(row: list) -> dict[str, int]:
    mapping: dict[str, int] = {}
    used: set[int] = set()
    for key, aliases in COLUMN_ALIASES:
        for idx, cell in enumerate(row):
            if idx in used or cell is None or (isinstance(cell, float) and pd.isna(cell)):
                continue
            w = _words(cell)
            if any(f" {a} " in w for a in aliases):
                mapping[key] = idx
                used.add(idx)
                break
    return mapping


def _clean(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _read_sheets(path: Path) -> dict[str, pd.DataFrame]:
    try:
        if path.suffix.lower() == ".csv":
            return {"csv": pd.read_csv(path, header=None, dtype=str, keep_default_na=False)}
        return pd.read_excel(path, sheet_name=None, header=None, dtype=object)
    except Exception as exc:
        raise ParseError(f"Could not read the Excel file: {exc}") from exc


def parse_expected_wiring(excel_path: Path) -> dict:
    wires: list[dict] = []
    for sheet_name, df in _read_sheets(excel_path).items():
        if df.empty:
            continue
        rows = df.values.tolist()
        header_idx, mapping = None, {}
        for i, row in enumerate(rows[:15]):
            m = _map_header(row)
            # need the wire number + at least one of from/to to call it a wiring list
            if "wire_no" in m and ({"from", "to"} & m.keys()) and len(m) > len(mapping):
                header_idx, mapping = i, m
        if header_idx is None:
            log.info("Excel sheet '%s' skipped: no wiring header found", sheet_name)
            continue

        for r_no, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
            get = lambda k: _clean(row[mapping[k]]) if k in mapping and mapping[k] < len(row) else ""
            wire_no = normalize_label(get("wire_no"))
            if not wire_no:
                continue
            wires.append({
                "wire_no": wire_no,
                "from": normalize_label(get("from")),
                "to": normalize_label(get("to")),
                "color": get("color"),
                "size": get("size"),
                "sheet": sheet_name,
                "row": r_no,
            })

    if not wires:
        raise ParseError(
            "No wiring rows found in the Excel file. Expected a header row with "
            "'Wire No', 'From' and 'To' columns."
        )

    # The same wire number on several rows is normal (one potential, several
    # terminals), so labels are de-duplicated rather than flagged.
    labels = sorted({w["wire_no"] for w in wires})
    log.info("Excel: %d wires, %d unique labels", len(wires), len(labels))
    return {"wires": wires, "labels": labels}
