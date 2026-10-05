"""End-to-end API tests: real PDF, Excel, photo, OCR and report generation.

Run:  python -m pytest -v      (or: python -m unittest discover -v)
Needs Tesseract installed (the OCR step is real).
"""
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import make_samples  # noqa: E402

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402
from app.services import excel_service, pdf_service  # noqa: E402
from app.services.pdf_service import expand_tags  # noqa: E402


class _Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        make_samples.make_pdf(cls.tmp / "bom.pdf")
        make_samples.make_excel(cls.tmp / "wiring.xlsx")
        make_samples.make_photo(cls.tmp / "good.png", defects=False)
        make_samples.make_photo(cls.tmp / "bad.png", defects=True)

        class Cfg(Config):
            TESTING = True
            STORAGE_DIR = cls.tmp / "storage"
            DATABASE_PATH = cls.tmp / "storage" / "test.db"
            YOLO_MODEL_PATH = ""
            OCR_ENGINE = "tesseract"

        cls.app = create_app(Cfg)
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def upload(self, image="good.png", pdf="bom.pdf", excel="wiring.xlsx", **form):
        data = dict(form)
        for field, name in (("image", image), ("pdf", pdf), ("excel", excel)):
            if name:
                data[field] = (io.BytesIO((self.tmp / name).read_bytes()), name)
        return self.client.post("/api/inspections", data=data, content_type="multipart/form-data")


class ParserTests(_Base):
    def test_pdf_components(self):
        comps = pdf_service.parse_expected_components(self.tmp / "bom.pdf")
        self.assertEqual([c["tag"] for c in comps], ["Q1", "K1", "K2", "F1", "G1", "A1", "X1"])
        self.assertEqual(comps[0]["type"], "circuit_breaker")
        self.assertEqual(comps[1]["type"], "contactor")

    def test_excel_wiring_header_not_on_row_1(self):
        w = excel_service.parse_expected_wiring(self.tmp / "wiring.xlsx")
        self.assertEqual(w["labels"], ["101", "102", "103", "104", "105", "106"])
        self.assertEqual(w["wires"][0]["from"], "Q1:2")

    def test_tag_ranges(self):
        self.assertEqual(expand_tags("F1-F3"), ["F1", "F2", "F3"])
        self.assertEqual(expand_tags("X1, X2"), ["X1", "X2"])
        self.assertEqual(expand_tags("-K1"), ["K1"])


class ApiTests(_Base):
    def test_health(self):
        r = self.client.get("/api/health")
        self.assertIn(r.status_code, (200, 503))
        self.assertIn("services", r.get_json())

    def test_good_cabinet_passes(self):
        r = self.upload(cabinet_name="CC-01")
        self.assertEqual(r.status_code, 201, r.get_json())
        body = r.get_json()
        self.assertEqual(body["verdict"], "PASS", body["result"]["defects"])
        self.assertEqual(body["cabinet_name"], "CC-01")

        # report + annotated image are downloadable
        rep = self.client.get(f"/api/inspections/{body['id']}/report")
        self.assertEqual(rep.status_code, 200)
        self.assertTrue(rep.data.startswith(b"%PDF"))
        img = self.client.get(f"/api/inspections/{body['id']}/annotated-image")
        self.assertEqual(img.status_code, 200)
        self.assertTrue(img.data.startswith(b"\x89PNG"))
        rep.close(); img.close()

    def test_bad_cabinet_fails_with_expected_defects(self):
        r = self.upload(image="bad.png")
        self.assertEqual(r.status_code, 201)
        body = r.get_json()
        self.assertEqual(body["verdict"], "FAIL")
        found = {(d["code"], d["item"]) for d in body["result"]["defects"]}
        self.assertIn(("COMPONENT_MISSING", "K2"), found)
        self.assertIn(("LABEL_MISMATCH", "K1"), found)
        self.assertIn(("WIRE_LABEL_MISSING", "105"), found)
        self.assertIn(("UNEXPECTED_LABEL", "Q9"), found)

        defects = self.client.get(f"/api/inspections/{body['id']}/defects?severity=critical").get_json()
        self.assertTrue(all(d["severity"] == "critical" for d in defects["defects"]))

    def test_list_and_delete(self):
        created = self.upload().get_json()
        listing = self.client.get("/api/inspections?limit=5").get_json()
        self.assertTrue(any(i["id"] == created["id"] for i in listing["items"]))
        self.assertEqual(self.client.delete(f"/api/inspections/{created['id']}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/inspections/{created['id']}").status_code, 404)

    def test_missing_file_is_400(self):
        r = self.upload(excel=None)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["error"], "validation_error")

    def test_wrong_file_type_is_400(self):
        r = self.upload(pdf="wiring.xlsx")   # xlsx sent as the pdf
        self.assertEqual(r.status_code, 400)

    def test_unreadable_pdf_is_422_and_saved_as_failed(self):
        (self.tmp / "empty.pdf").write_bytes(b"%PDF-1.4\n%%EOF")
        r = self.upload(pdf="empty.pdf")
        self.assertEqual(r.status_code, 422)
        inspection_id = r.get_json()["details"]["inspection_id"]
        self.assertEqual(self.client.get(f"/api/inspections/{inspection_id}").get_json()["status"], "failed")

    def test_unknown_id_is_404(self):
        self.assertEqual(self.client.get("/api/inspections/does-not-exist").status_code, 404)


if __name__ == "__main__":
    unittest.main()
