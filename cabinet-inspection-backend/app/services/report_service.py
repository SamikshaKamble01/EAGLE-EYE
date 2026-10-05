"""Report Service -> annotated photo (PNG) + inspection report (PDF)."""
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

# BGR colours for OpenCV
_BLUE, _GREEN, _ORANGE, _RED = (200, 120, 30), (60, 170, 60), (0, 140, 255), (40, 40, 220)


def _put_label(img, text, x, y, color):
    font, scale, thick = cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1
    (tw, th), _ = cv2.getTextSize(text, font, scale, thick)
    y = max(y, th + 4)
    cv2.rectangle(img, (x, y - th - 4), (x + tw + 4, y), color, -1)
    cv2.putText(img, text, (x + 2, y - 3), font, scale, (255, 255, 255), thick, cv2.LINE_AA)


def annotate_image(image: np.ndarray, vision: dict, rule_result: dict, out_path: Path) -> Path:
    """Blue = detected component, green = label OK, orange = label mismatch."""
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

    banner = f"{rule_result['verdict']}  score {rule_result['score']}%"
    color = _GREEN if rule_result["verdict"] == "PASS" else _RED
    cv2.rectangle(img, (0, 0), (img.shape[1], int(40 * max(scale, 1))), color, -1)
    cv2.putText(img, banner, (10, int(28 * max(scale, 1))), cv2.FONT_HERSHEY_SIMPLEX,
                0.9 * max(scale, 1), (255, 255, 255), 2, cv2.LINE_AA)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), img)
    return out_path


_SEV_COLORS = {"critical": colors.HexColor("#c62828"), "major": colors.HexColor("#ef6c00"),
               "minor": colors.HexColor("#757575")}


def build_pdf_report(inspection_id: str, cabinet_name: str, result: dict,
                     annotated_path: Path | None, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["BodyText"], fontSize=8, leading=10)
    doc = SimpleDocTemplate(str(out_path), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm,
                            title=f"Inspection {inspection_id}")
    story = []

    verdict = result["verdict"]
    v_color = "#2e7d32" if verdict == "PASS" else "#c62828"
    story.append(Paragraph("Cabinet Inspection Report", styles["Title"]))
    story.append(Paragraph(
        f"<b>Cabinet:</b> {cabinet_name or '-'} &nbsp;&nbsp; <b>ID:</b> {inspection_id}<br/>"
        f"<b>Date:</b> {datetime.now():%Y-%m-%d %H:%M} &nbsp;&nbsp; "
        f"<b>Engines:</b> vision={result['engines']['vision']}, ocr={result['engines']['ocr']}",
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

    story.append(Paragraph("Defects", styles["Heading2"]))
    if result["defects"]:
        rows = [["#", "Severity", "Code", "Item", "Message"]]
        for i, d in enumerate(result["defects"], 1):
            rows.append([i, d["severity"].upper(), d["code"], Paragraph(str(d["item"] or "-"), small),
                         Paragraph(d["message"], small)])
        t = Table(rows, colWidths=[8 * mm, 18 * mm, 42 * mm, 22 * mm, None], repeatRows=1)
        style = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#37474f")),
                 ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                 ("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 8),
                 ("VALIGN", (0, 0), (-1, -1), "TOP")]
        for i, d in enumerate(result["defects"], 1):
            style.append(("TEXTCOLOR", (1, i), (1, i), _SEV_COLORS[d["severity"]]))
        t.setStyle(TableStyle(style))
        story.append(t)
    else:
        story.append(Paragraph("No defects found.", styles["BodyText"]))

    story.append(Spacer(1, 12))
    story.append(Paragraph("Component checks", styles["Heading2"]))
    rows = [["Tag", "Expected type", "Status", "Read as"]]
    rows += [[c["tag"], c["type"].replace("_", " "), c["status"].replace("_", " "), c["read_as"] or "-"]
             for c in result["components"]]
    t = Table(rows, colWidths=[25 * mm, 50 * mm, 35 * mm, 30 * mm], repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eceff1")),
                           ("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 8)]))
    story.append(t)

    if annotated_path and Path(annotated_path).exists():
        story.append(PageBreak())
        story.append(Paragraph("Annotated photo", styles["Heading2"]))
        img = cv2.imread(str(annotated_path))
        h, w = img.shape[:2]
        max_w, max_h = 180 * mm, 230 * mm
        ratio = min(max_w / w, max_h / h)
        story.append(Image(str(annotated_path), width=w * ratio, height=h * ratio))

    doc.build(story)
    return out_path
