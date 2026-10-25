"""Drawing comparison: a picture of a drawing sheet is lined up with the PDF and small
changes are found; real photos are not mistaken for the drawing."""
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from app.services import reference_service as R
from tests.test_api import make_samples

TAGS = [f"{p}{n}" for p in ("CB", "PS", "XT") for n in range(11, 19)]


def make_drawing(path: Path) -> None:
    """A GA-like sheet: cabinet outline, device boxes with tags, a title."""
    from reportlab.lib.pagesizes import A3, landscape
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(str(path), pagesize=landscape(A3))
    W, H = landscape(A3)
    c.setFont("Helvetica", 16)
    c.drawString(300, H - 60, "INTERNAL GENERAL ARRANGEMENT - FRONT AND SIDE VIEW - 13GE03331")
    c.rect(150, 80, W - 300, H - 200)
    c.setFont("Helvetica", 9)
    for row, prefix in enumerate(("CB", "PS", "XT")):
        y = H - 200 - row * 220
        for i in range(8):
            x = 200 + i * 120
            c.rect(x, y - 120, 80, 120)
            c.circle(x + 40, y - 40, 14 + (i % 3) * 4)
            for k in range(4):
                c.line(x + 8, y - 70 - 9 * k, x + 72 - 7 * ((i + k) % 4), y - 70 - 9 * k)
            c.drawString(x + 18, y - 115, f"{prefix}{11 + i}")
            c.drawString(x + 4, y + 6, f"13MFW0{4331 + 8 * row + i}")
    c.save()


def render(path: Path, scale: float = 2.0) -> np.ndarray:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(path))
    img = doc[0].render(scale=scale).to_numpy()[:, :, :3]
    doc.close()
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


class DrawingCompareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.pdf = cls.tmp / "ga.pdf"
        make_drawing(cls.pdf)
        page = render(cls.pdf)
        cls.shot = page[200:1500, 250:2100].copy()           # a cropped "screenshot" of the sheet

    def compare(self, image):
        return R.compare(image, self.pdf, set(TAGS).__contains__)

    def test_unchanged_screenshot_has_no_differences(self):
        r = self.compare(self.shot)
        self.assertIsNotNone(r)
        self.assertEqual((r["page"], r["changes"]), (1, []))
        self.assertTrue(r["reliable"])
        self.assertGreater(len(r["in_view"]), 10)             # the tags in the picture are known

    def test_one_changed_digit_is_found(self):
        r0 = self.compare(self.shot)
        x0, y0, x1, y1 = r0["in_view"]["PS13"]
        edited = self.shot.copy()
        # rub out the last digit of PS13 and write another one
        cut = x0 + int((x1 - x0) * 0.72)
        cv2.rectangle(edited, (cut, y0 - 1), (x1 + 1, y1 + 1), (255, 255, 255), -1)
        cv2.putText(edited, "8", (cut, y1), cv2.FONT_HERSHEY_SIMPLEX, (y1 - y0) / 24, (0, 0, 0), 1, cv2.LINE_AA)
        r = self.compare(edited)
        self.assertEqual(len(r["changes"]), 1, r["changes"])
        ch = r["changes"][0]
        self.assertEqual(ch["drawing_text"], "PS13")
        self.assertEqual(ch["kind"], "changed")
        self.assertTrue(R._overlaps(ch["bbox"], [x0, y0, x1, y1]))

    def test_removed_device_symbol_is_found(self):
        r0 = self.compare(self.shot)
        x0, y0, x1, y1 = r0["in_view"]["CB12"]
        edited = self.shot.copy()
        cv2.rectangle(edited, (x0 - 4, y0 - 4), (x1 + 4, y1 + 4), (255, 255, 255), -1)
        r = self.compare(edited)
        self.assertEqual([c["drawing_text"] for c in r["changes"]], ["CB12"])
        self.assertEqual(r["changes"][0]["kind"], "removed")

    def test_photo_is_not_taken_for_the_drawing(self):
        photo = self.tmp / "photo.png"
        make_samples.make_photo(photo, defects=False)
        self.assertIsNone(self.compare(cv2.imread(str(photo))))
        noise = np.random.default_rng(1).integers(0, 255, (900, 1200, 3), dtype=np.uint8)
        self.assertIsNone(self.compare(noise))

    def test_unchanged_tags_count_as_present(self):
        r = self.compare(self.shot)
        result = {"components": [{"tag": "CB11", "status": "missing"}, {"tag": "ZZ9", "status": "missing"}],
                  "defects": [{"code": "COMPONENT_MISSING", "item": "CB11"}, {"code": "COMPONENT_MISSING", "item": "ZZ9"}]}
        R.apply_to_result(result, [r])
        self.assertEqual([c["status"] for c in result["components"]], ["ok", "missing"])
        self.assertEqual([d["item"] for d in result["defects"]], ["ZZ9"])


if __name__ == "__main__":
    unittest.main()
