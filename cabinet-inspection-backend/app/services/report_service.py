"""Report Service -> marked-up photo (PNG), proof snippets, QC check sheet (Excel) and report (PDF)."""
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

# BGR colours for OpenCV
_BLUE, _GREEN, _ORANGE, _RED, _GREY = (200, 120, 30), (60, 170, 60), (0, 140, 255), (40, 40, 220), (120, 120, 120)


def _put_label(img, text, x, y, color, scale=0.5):
    font, thick = cv2.FONT_HERSHEY_SIMPLEX, max(1, int(round(scale * 2)))
    (tw, th), _ = cv2.getTextSize(text, font, scale, thick)
    y = max(y, th + 4)
    cv2.rectangle(img, (x, y - th - 4), (x + tw + 4, y), color, -1)
    cv2.putText(img, text, (x + 2, y - 3), font, scale, (255, 255, 255), thick, cv2.LINE_AA)


def _problems(result: dict) -> list[dict]:
    """Check-sheet rows that need proof: every FAIL and WARN that has a place on the photo."""
    return [i for i in result.get("checklist", []) if i["result"] != "PASS" and i.get("bbox")]


def annotate_image(image: np.ndarray, vision: dict, rule_result: dict, out_path: Path) -> Path:
    """Blue = detected component, green = label OK, red box with #number = FAIL on the
    check sheet (grey = note). The number is the row of the check sheet."""
    img = image.copy()
    scale = max(img.shape[:2]) / 1600.0
    thick = max(2, int(round(2 * scale)))

    for det in vision.get("detections", []):
        x1, y1, x2, y2 = det["bbox"]
        cv2.rectangle(img, (x1, y1), (x2, y2), _BLUE, thick)
        if vision.get("typed"):
            _put_label(img, f"{det['type']} {det['confidence']:.2f}", x1, y1 - 2, _BLUE)

    def draw(checks, key):
        for c in checks:
            if not c.get("bbox"):
                continue
            x1, y1, x2, y2 = c["bbox"]
            ok = c["status"] == "ok"
            color = _GREEN if ok else _ORANGE
            cv2.rectangle(img, (x1 - 3, y1 - 3), (x2 + 3, y2 + 3), color, thick)
            text = c[key] if ok else f"{c[key]}? read {c['read_as']}"
            _put_label(img, text, x1, y2 + 18, color)

    draw(rule_result.get("components", []), "tag")
    draw(rule_result.get("wire_labels", []), "label")

    for it in _problems(rule_result):
        x1, y1, x2, y2 = it["bbox"]
        color = _RED if it["result"] == "FAIL" else _GREY
        cv2.rectangle(img, (x1 - 6, y1 - 6), (x2 + 6, y2 + 6), color, thick + 1)
        _put_label(img, f"#{it['no']} {it['found']}" if it["bbox_estimated"] else f"#{it['no']}",
                   x1 - 6, y1 - 8, color, scale=0.6 * max(scale, 1))

    banner = f"{rule_result['verdict']}  score {rule_result['score']}%"
    color = _GREEN if rule_result["verdict"] == "PASS" else _RED
    cv2.rectangle(img, (0, 0), (img.shape[1], int(40 * max(scale, 1))), color, -1)
    cv2.putText(img, banner, (10, int(28 * max(scale, 1))), cv2.FONT_HERSHEY_SIMPLEX,
                0.9 * max(scale, 1), (255, 255, 255), 2, cv2.LINE_AA)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), img)
    return out_path


def save_snippets(image: np.ndarray, checklist: list[dict], out_dir: Path) -> int:
    """Zoomed crop of the photo for every FAIL / WARN row; sets item["snippet"] to the file name."""
    H, W = image.shape[:2]
    saved = 0
    for it in checklist:
        if it["result"] == "PASS" or not it.get("bbox"):
            continue
        x1, y1, x2, y2 = it["bbox"]
        pad = max(24, int(0.35 * max(x2 - x1, y2 - y1)))
        cx1, cy1, cx2, cy2 = max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad)
        crop = image[cy1:cy2, cx1:cx2].copy()
        if crop.size == 0:
            continue
        zoom = min(4.0, max(1.0, 260 / min(crop.shape[:2])))
        if max(crop.shape[:2]) * zoom > 900:
            zoom = 900 / max(crop.shape[:2])
        crop = cv2.resize(crop, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC)
        color = _RED if it["result"] == "FAIL" else _GREY
        p1 = (int((x1 - cx1) * zoom), int((y1 - cy1) * zoom))
        p2 = (int((x2 - cx1) * zoom), int((y2 - cy1) * zoom))
        cv2.rectangle(crop, p1, p2, color, 3)
        out_dir.mkdir(parents=True, exist_ok=True)
        name = f"item_{it['no']:03d}.png"
        cv2.imwrite(str(out_dir / name), crop)
        it["snippet"] = name
        saved += 1
    return saved


# --------------------------------------------------------------------------- #
# Excel: the filled QC check sheet
# --------------------------------------------------------------------------- #
_CHANGE_TEXT = {"closed": "CLOSED", "open": "STILL OPEN", "new": "NEW"}


def build_checklist_xlsx(inspection_id: str, cabinet_name: str, result: dict,
                         snippet_dir: Path, out_path: Path) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    fills = {"PASS": PatternFill("solid", fgColor="C8E6C9"), "FAIL": PatternFill("solid", fgColor="FFCDD2"),
             "WARN": PatternFill("solid", fgColor="FFF3C4")}
    head_fill = PatternFill("solid", fgColor="1F3A5F")
    thin = Side(style="thin", color="BBBBBB")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    recheck = result.get("recheck")

    wb = Workbook()
    ws = wb.active
    ws.title = "QC check sheet"
    ws["A1"] = "QC check sheet"
    ws["A1"].font = Font(size=16, bold=True)
    meta = [("Cabinet", cabinet_name or "-"), ("Inspection ID", inspection_id),
            ("Date", f"{datetime.now():%Y-%m-%d %H:%M}"),
            ("Result", f"{result['verdict']}  ({result['summary']['checks_passed']} of "
                       f"{result['summary']['checks_total']} checks passed, score {result['score']}%)"),
            ("Tools", f"vision={result['engines']['vision']}, ocr={result['engines']['ocr']}")]
    if recheck:
        meta.append(("Re-check", f"round {recheck['round']}: {len(recheck['closed'])} closed, "
                                 f"{len(recheck['still_open'])} still open, {len(recheck['new'])} new"))
    for r, (k, v) in enumerate(meta, start=2):
        ws.cell(r, 1, k).font = Font(bold=True)
        ws.cell(r, 2, v)

    headers = ["#", "Check", "Item", "What is checked", "Expected (drawing)", "Found (photo)",
               "Result", "Severity", "Remark", "How to fix", "Re-check"]
    top = len(meta) + 3
    for c, h in enumerate(headers, start=1):
        cell = ws.cell(top, c, h)
        cell.font, cell.fill, cell.border = Font(bold=True, color="FFFFFF"), head_fill, border
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for r, it in enumerate(result.get("checklist", []), start=top + 1):
        row = [it["no"], it["check_title"], it["item"], it["description"], it["expected"], it["found"],
               it["result"], (it["severity"] or "").upper(), it["message"], it.get("fix", ""),
               _CHANGE_TEXT.get(it.get("change"), "")]
        for c, v in enumerate(row, start=1):
            cell = ws.cell(r, c, v)
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=c in (4, 9, 10))
        ws.cell(r, 7).fill = fills[it["result"]]
        ws.cell(r, 7).font = Font(bold=True)
        ws.cell(r, 7).alignment = Alignment(horizontal="center", vertical="top")
    for c, width in enumerate([5, 16, 12, 38, 22, 22, 9, 10, 50, 55, 12], start=1):
        ws.column_dimensions[get_column_letter(c)].width = width
    ws.freeze_panes = ws.cell(top + 1, 1)

    # second sheet: photo proof for everything that is not PASS
    proof = wb.create_sheet("Proof")
    proof["A1"] = "Proof for every FAIL - the box marks the place on the cabinet photo"
    proof["A1"].font = Font(size=13, bold=True)
    for c, width in enumerate([6, 16, 14, 24, 24, 60], start=1):
        proof.column_dimensions[get_column_letter(c)].width = width
    row = 3
    for it in result.get("checklist", []):
        if it["result"] == "PASS":
            continue
        for c, v in enumerate([f"#{it['no']}", it["check_title"], it["item"], f"Expected: {it['expected']}",
                               f"Found: {it['found']}", it["message"]], start=1):
            proof.cell(row, c, v).font = Font(bold=c <= 3)
        row += 1
        if it.get("fix"):
            proof.cell(row, 2, "How to fix").font = Font(bold=True, color="1565C0")
            proof.cell(row, 3, it["fix"])
            row += 1
        path = snippet_dir / it["snippet"] if it.get("snippet") else None
        if path and path.is_file():
            try:
                from openpyxl.drawing.image import Image as XlImage
                picture = XlImage(str(path))
                ratio = min(1.0, 200 / picture.height)
                picture.width, picture.height = int(picture.width * ratio), int(picture.height * ratio)
                proof.add_image(picture, f"B{row}")
                row += int(picture.height / 20) + 2
            except Exception:                      # Pillow missing -> sheet without pictures
                row += 1
        else:
            proof.cell(row, 2, "(no place on the photo for this item)")
            row += 2

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)
    return out_path


# --------------------------------------------------------------------------- #
# PDF report
# --------------------------------------------------------------------------- #
_SEV_HEX = {"critical": "#c62828", "major": "#ef6c00", "minor": "#757575"}
_RESULT_COLORS = {"PASS": colors.HexColor("#2e7d32"), "FAIL": colors.HexColor("#c62828"),
                  "WARN": colors.HexColor("#b26a00")}


def _fit_image(path: Path, max_w: float, max_h: float) -> Image:
    img = cv2.imread(str(path))
    h, w = img.shape[:2]
    ratio = min(max_w / w, max_h / h)
    return Image(str(path), width=w * ratio, height=h * ratio)


def build_pdf_report(inspection_id: str, cabinet_name: str, result: dict,
                     annotated_path: Path | None, out_path: Path, snippet_dir: Path | None = None) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["BodyText"], fontSize=8, leading=10)
    doc = SimpleDocTemplate(str(out_path), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm,
                            title=f"Inspection {inspection_id}")
    story = []
    checklist = result.get("checklist", [])
    recheck = result.get("recheck")

    verdict = result["verdict"]
    v_color = "#2e7d32" if verdict == "PASS" else "#c62828"
    story.append(Paragraph("Cabinet QC Report", styles["Title"]))
    story.append(Paragraph(
        f"<b>Cabinet:</b> {cabinet_name or '-'} &nbsp;&nbsp; <b>ID:</b> {inspection_id}<br/>"
        f"<b>Date:</b> {datetime.now():%Y-%m-%d %H:%M} &nbsp;&nbsp; "
        f"<b>Tools:</b> vision={result['engines']['vision']}, ocr={result['engines']['ocr']}",
        styles["BodyText"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f'<font size="22" color="{v_color}"><b>{verdict}</b></font>'
        f'&nbsp;&nbsp;&nbsp;<font size="12">score {result["score"]}%</font>', styles["BodyText"]))
    story.append(Spacer(1, 10))

    s = result["summary"]
    summary = Table([
        ["Critical", "Major", "Minor", "Checks passed", "Components detected", "Labels read"],
        [s["critical"], s["major"], s["minor"], f"{s['checks_passed']}/{s['checks_total']}",
         s["detected_components"], s["ocr_labels_read"]],
    ], hAlign="LEFT")
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eceff1")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (0, 1), (-1, 1), "CENTER"),
    ]))
    story += [summary, Spacer(1, 12)]

    # ---- re-check: before vs after -----------------------------------------
    if recheck:
        b, a = recheck["before"], recheck["after"]
        story.append(Paragraph(f"Re-check (round {recheck['round']}): before vs after", styles["Heading2"]))
        t = Table([["", "Before the fix", "After the fix"],
                   ["Result", b["verdict"], a["verdict"]],
                   ["Score", f"{b['score']}%", f"{a['score']}%"],
                   ["Open issues", b["failed"], a["failed"]]], hAlign="LEFT",
                  colWidths=[35 * mm, 40 * mm, 40 * mm])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eceff1")),
                               ("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
        story += [t, Spacer(1, 6)]
        for title, key in (("Closed (fixed)", "closed"), ("Still open", "still_open"), ("New", "new")):
            rows = recheck[key]
            names = ", ".join(f"{r['check_title']}: {r['item']}" for r in rows) or "none"
            story.append(Paragraph(f"<b>{title} ({len(rows)}):</b> {names}", styles["BodyText"]))
        story.append(Spacer(1, 12))

    # ---- fix list: how it should be assembled ------------------------------
    to_fix = [i for i in checklist if i["result"] == "FAIL" and i.get("fix")]
    if to_fix:
        story.append(Paragraph("Fix list - what the technician has to do", styles["Heading2"]))
        for n, it in enumerate(to_fix, 1):
            story.append(Paragraph(f"<b>{n}.</b> {it['fix']} <font color='#757575'>(row #{it['no']}, "
                                   f"{it['check_title']})</font>", styles["BodyText"]))
        story.append(Spacer(1, 12))

    # ---- QC check sheet ----------------------------------------------------
    story.append(Paragraph("QC check sheet", styles["Heading2"]))
    if checklist:
        head = ["#", "Check", "Item", "Expected (drawing)", "Found (photo)", "Result"] + (["Re-check"] if recheck else [])
        rows = [head]
        for it in checklist:
            row = [it["no"], Paragraph(it["check_title"], small), Paragraph(str(it["item"]), small),
                   Paragraph(str(it["expected"]), small), Paragraph(str(it["found"]), small), it["result"]]
            rows.append(row + ([_CHANGE_TEXT.get(it.get("change"), "")] if recheck else []))
        widths = [8 * mm, 26 * mm, 24 * mm, 46 * mm, 46 * mm, 14 * mm] + ([18 * mm] if recheck else [])
        t = Table(rows, colWidths=widths, repeatRows=1)
        style = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#37474f")),
                 ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                 ("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 8),
                 ("VALIGN", (0, 0), (-1, -1), "TOP")]
        for i, it in enumerate(checklist, 1):
            style.append(("TEXTCOLOR", (5, i), (5, i), _RESULT_COLORS[it["result"]]))
            style.append(("FONTNAME", (5, i), (5, i), "Helvetica-Bold"))
        t.setStyle(TableStyle(style))
        story.append(t)
    else:
        story.append(Paragraph("No checks were run.", styles["BodyText"]))

    # ---- proof for every FAIL ----------------------------------------------
    problems = [i for i in checklist if i["result"] != "PASS"]
    if problems:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Proof: what was expected vs what was found", styles["Heading2"]))
        for it in problems:
            sev = it["severity"] or "minor"
            text = Paragraph(
                f'<b>#{it["no"]} {it["check_title"]} - {it["item"]}</b> '
                f'<font color="{_SEV_HEX[sev]}">[{it["result"]} / {sev.upper()}]</font><br/>'
                f'<b>Expected:</b> {it["expected"]}<br/><b>Found:</b> {it["found"]}<br/>{it["message"]}'
                + (f'<br/><font color="#1565c0"><b>How to fix:</b> {it["fix"]}</font>' if it.get("fix") else "")
                + ("<br/><i>Box = the place where it was expected.</i>" if it["bbox_estimated"] else ""), small)
            path = snippet_dir / it["snippet"] if snippet_dir and it.get("snippet") else None
            picture = _fit_image(path, 60 * mm, 42 * mm) if path and path.is_file() else Paragraph("no photo location", small)
            block = Table([[picture, text]], colWidths=[64 * mm, None])
            block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                       ("BOX", (0, 0), (-1, -1), 0.3, colors.grey),
                                       ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
            story += [KeepTogether(block), Spacer(1, 5)]

    if annotated_path and Path(annotated_path).exists():
        story.append(PageBreak())
        story.append(Paragraph("Marked-up photo (red #numbers = rows of the check sheet)", styles["Heading2"]))
        story.append(_fit_image(Path(annotated_path), 180 * mm, 230 * mm))

    doc.build(story)
    return out_path
