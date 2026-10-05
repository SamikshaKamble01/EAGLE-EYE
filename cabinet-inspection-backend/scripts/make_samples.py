"""Generate sample input files to try the API without a real cabinet.

    python scripts/make_samples.py

Creates in samples/:
    bom.pdf            expected components (table: Tag | Description | Qty)
    wiring.xlsx        wiring list (Wire No | From | To | Colour | Size)
    cabinet_good.png   photo where everything matches         -> PASS
    cabinet_bad.png    K2 missing, K1 labelled K7, wire 105 missing, extra Q9 -> FAIL
"""
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parent.parent / "samples"

COMPONENTS = [
    ("Q1", "Main circuit breaker MCB 3P 16A", 1),
    ("K1", "Contactor 24VDC 9A", 1),
    ("K2", "Contactor 24VDC 9A", 1),
    ("F1", "Fuse 2A", 1),
    ("G1", "Power supply 24VDC 5A", 1),
    ("A1", "PLC CPU module", 1),
    ("X1", "Terminal block", 1),
]
WIRES = [
    ("101", "Q1:2", "K1:1", "Black", "1.5"),
    ("102", "Q1:4", "K2:1", "Black", "1.5"),
    ("103", "F1:2", "G1:L", "Brown", "1.0"),
    ("104", "G1:+", "A1:24V", "Red", "0.75"),
    ("105", "A1:Q0", "K1:A1", "Blue", "0.75"),
    ("106", "A1:Q1", "K2:A1", "Blue", "0.75"),
]


def make_pdf(path: Path):
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(path), pagesize=A4)
    rows = [["Tag", "Description", "Qty"]] + [[t, d, q] for t, d, q in COMPONENTS]
    table = Table(rows)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey)]))
    doc.build([Paragraph("Control Cabinet CC-01 - Bill of Materials", styles["Title"]),
               Spacer(1, 12), table])


def make_excel(path: Path):
    df = pd.DataFrame(WIRES, columns=["Wire No", "From", "To", "Colour", "Size (mm2)"])
    with pd.ExcelWriter(path) as xl:
        # two title rows on purpose: the parser must find the header itself
        pd.DataFrame([["Wiring list CC-01"], [""]]).to_excel(xl, index=False, header=False, sheet_name="Wiring")
        df.to_excel(xl, index=False, sheet_name="Wiring", startrow=2)


def _font(size: int):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


_TEXTS: list[tuple[int, int, str, int]] = []   # drawn with Pillow after the shapes


def _device(img, x, y, w, h, tag):
    cv2.rectangle(img, (x, y), (x + w, y + h), (70, 70, 70), -1)            # body
    cv2.rectangle(img, (x, y), (x + w, y + h), (20, 20, 20), 3)
    lx, ly = x + 15, y + 20
    cv2.rectangle(img, (lx, ly), (lx + w - 30, ly + 60), (255, 255, 255), -1)  # label sticker
    _TEXTS.append((lx + 14, ly + 8, tag, 42))


def _ferrule(img, x, y, text):
    cv2.rectangle(img, (x, y), (x + 120, y + 50), (255, 255, 255), -1)
    _TEXTS.append((x + 14, y + 7, text, 34))


def _draw_texts(img):
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)
    for x, y, text, size in _TEXTS:
        draw.text((x, y), text, fill=(0, 0, 0), font=_font(size))
    _TEXTS.clear()
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def make_photo(path: Path, defects: bool):
    img = np.full((1100, 1600, 3), (185, 190, 195), np.uint8)           # back plate
    cv2.rectangle(img, (40, 330), (1560, 360), (140, 140, 140), -1)      # DIN rail
    devices = [("Q1", 60), ("K1", 280), ("K2", 500), ("F1", 720), ("G1", 900), ("A1", 1130), ("X1", 1360)]
    for tag, x in devices:
        if defects and tag == "K2":
            continue                                   # missing contactor
        label = "K7" if defects and tag == "K1" else tag
        _device(img, x, 220, 180, 260, label)
    if defects:
        _device(img, 1360, 600, 180, 260, "Q9")        # extra, undocumented
    for i, wire in enumerate(["101", "102", "103", "104", "105", "106"]):
        if defects and wire == "105":
            continue
        _ferrule(img, 80 + i * 200, 900, wire)
    img = _draw_texts(img)
    # a bit of camera realism: blur + sensor noise
    img = cv2.GaussianBlur(img, (3, 3), 0)
    noise = np.random.default_rng(7).normal(0, 6, img.shape)
    img = np.clip(img.astype(float) + noise, 0, 255).astype(np.uint8)
    cv2.imwrite(str(path), img)


def main():
    OUT.mkdir(exist_ok=True)
    make_pdf(OUT / "bom.pdf")
    make_excel(OUT / "wiring.xlsx")
    make_photo(OUT / "cabinet_good.png", defects=False)
    make_photo(OUT / "cabinet_bad.png", defects=True)
    print(f"Samples written to {OUT}")


if __name__ == "__main__":
    main()
