"""Unit tests for the rule engine - no images, OCR or files needed."""
import unittest

from app.services.rule_engine import evaluate

COMPONENTS = [
    {"tag": "Q1", "type": "circuit_breaker", "description": "MCB", "quantity": 1},
    {"tag": "K1", "type": "contactor", "description": "Contactor", "quantity": 1},
    {"tag": "K2", "type": "contactor", "description": "Contactor", "quantity": 1},
]
WIRING = {"labels": ["101", "102"], "wires": [
    {"wire_no": "101", "from": "Q1:2", "to": "K1:1"},
    {"wire_no": "102", "from": "Q1:4", "to": "K2:1"}]}


def ocr(*items):
    return {"texts": [{"text": t, "raw": t, "confidence": 90, "bbox": b} for t, b in items]}


def codes(result):
    return sorted((d["code"], d["item"]) for d in result["defects"])


UNTYPED = {"typed": False, "detections": []}


class RuleEngineTests(unittest.TestCase):
    def test_everything_present_passes(self):
        r = evaluate(COMPONENTS, WIRING, UNTYPED, ocr(
            ("Q1", [0, 0, 10, 10]), ("K1", [20, 0, 30, 10]), ("K2", [40, 0, 50, 10]),
            ("101", [0, 50, 10, 60]), ("102", [20, 50, 30, 60])))
        self.assertEqual(r["verdict"], "PASS")
        self.assertEqual(r["score"], 100.0)
        self.assertEqual(r["defects"], [])

    def test_ocr_confusions_still_match(self):
        # 'KI' / 'Q|' are typical OCR misreads of K1 / Q1
        r = evaluate(COMPONENTS, {"labels": [], "wires": []}, UNTYPED, ocr(
            ("Q|", [0, 0, 1, 1]), ("KI", [2, 0, 3, 1]), ("K2", [4, 0, 5, 1])))
        self.assertEqual(r["verdict"], "PASS")

    def test_missing_mismatch_and_unexpected(self):
        r = evaluate(COMPONENTS, WIRING, UNTYPED, ocr(
            ("Q1", [0, 0, 1, 1]), ("K7", [2, 0, 3, 1]),        # K1 mislabelled, K2 missing
            ("101", [0, 5, 1, 6]), ("X9", [9, 9, 10, 10])))     # 102 missing, X9 undocumented
        self.assertEqual(r["verdict"], "FAIL")
        self.assertEqual(codes(r), [
            ("COMPONENT_MISSING", "K2"),
            ("LABEL_MISMATCH", "K1"),
            ("UNEXPECTED_LABEL", "X9"),
            ("WIRE_LABEL_MISSING", "102"),
        ])

    def test_one_misread_explains_only_one_label(self):
        r = evaluate(COMPONENTS, {"labels": [], "wires": []}, UNTYPED, ocr(("Q1", [0, 0, 1, 1]), ("K7", [2, 0, 3, 1])))
        self.assertEqual(sum(d["code"] == "LABEL_MISMATCH" for d in r["defects"]), 1)
        self.assertEqual(sum(d["code"] == "COMPONENT_MISSING" for d in r["defects"]), 1)

    def test_minor_only_is_pass(self):
        r = evaluate(COMPONENTS, {"labels": [], "wires": []}, UNTYPED, ocr(
            ("Q1", [0, 0, 1, 1]), ("K1", [2, 0, 3, 1]), ("K2", [4, 0, 5, 1]), ("X5", [6, 0, 7, 1])))
        self.assertEqual(r["verdict"], "PASS")
        self.assertEqual(r["summary"]["minor"], 1)

    # ---- typed (YOLO) detections ----------------------------------------
    def test_type_mismatch_label_missing_and_extra(self):
        vision = {"typed": True, "detections": [
            {"type": "circuit_breaker", "confidence": .9, "bbox": [0, 0, 100, 100]},
            {"type": "relay", "confidence": .9, "bbox": [200, 0, 300, 100]},       # K1 is a relay?!
            {"type": "contactor", "confidence": .9, "bbox": [400, 0, 500, 100]},   # K2, unlabelled
            {"type": "fuse", "confidence": .9, "bbox": [600, 0, 700, 100]},        # not in BOM
        ]}
        r = evaluate(COMPONENTS, {"labels": [], "wires": []}, vision, ocr(
            ("Q1", [40, 40, 60, 60]), ("K1", [240, 40, 260, 60])))
        # K1 wrong type is reported once (not again as relay surplus / contactor short)
        self.assertEqual(codes(r), [
            ("COMPONENT_TYPE_MISMATCH", "K1"),
            ("EXTRA_COMPONENT", "fuse"),
            ("LABEL_MISSING", "K2"),
        ])
        self.assertEqual(r["verdict"], "FAIL")

    def test_typed_label_missing_when_device_present(self):
        vision = {"typed": True, "detections": [
            {"type": "circuit_breaker", "confidence": .9, "bbox": [0, 0, 100, 100]},
            {"type": "contactor", "confidence": .9, "bbox": [200, 0, 300, 100]},
            {"type": "contactor", "confidence": .9, "bbox": [400, 0, 500, 100]},
        ]}
        r = evaluate(COMPONENTS, {"labels": [], "wires": []}, vision, ocr(
            ("Q1", [40, 40, 60, 60]), ("K1", [240, 40, 260, 60])))
        self.assertEqual(codes(r), [("LABEL_MISSING", "K2")])


if __name__ == "__main__":
    unittest.main()
