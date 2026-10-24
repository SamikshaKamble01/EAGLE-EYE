"""QC check sheet, proof snippets, Excel export and the fix -> re-photo -> re-check loop."""
import io
import unittest

import numpy as np

from app import checks
from app.services.rule_engine import evaluate
from tests.test_api import _Base, make_samples

COMPONENTS = [{"tag": t, "type": "contactor", "description": "Contactor", "quantity": 1} for t in ("K1", "K2", "K3")]
NO_WIRES = {"labels": [], "wires": []}
UNTYPED = {"typed": False, "detections": []}


def sheet_for(*labels):
    """labels: (text, x) pairs - devices in one row at the given x position."""
    ocr = {"texts": [{"text": t, "raw": t, "confidence": 90, "bbox": [x, 0, x + 40, 20]} for t, x in labels]}
    core = evaluate(COMPONENTS, NO_WIRES, UNTYPED, ocr)
    sheet = checks.run_all(checks.CheckContext(COMPONENTS, NO_WIRES, UNTYPED, ocr, core, image_size=(1000, 500)))
    checks.apply_to_result(core, sheet)
    return core


class CheckSheetUnitTests(unittest.TestCase):
    def test_all_good_gives_only_pass_rows(self):
        r = sheet_for(("K1", 0), ("K2", 100), ("K3", 200))
        self.assertEqual({i["result"] for i in r["checklist"]}, {"PASS"})
        self.assertEqual({i["check"] for i in r["checklist"]}, {"ga", "label"})
        self.assertEqual(r["verdict"], "PASS")

    def test_swapped_devices_fail_the_order_check(self):
        r = sheet_for(("K1", 0), ("K3", 100), ("K2", 200))
        order = next(i for i in r["checklist"] if i["key"] == "ga:order")
        self.assertEqual(order["result"], "FAIL")
        self.assertEqual(order["found"], "K1 - K3 - K2")
        self.assertIn(("COMPONENT_ORDER", "Device order"), {(d["code"], d["item"]) for d in r["defects"]})
        self.assertEqual(r["verdict"], "FAIL")

    def test_missing_device_gets_a_box_between_its_neighbours(self):
        r = sheet_for(("K1", 0), ("K3", 200))
        k2 = next(i for i in r["checklist"] if i["key"] == "ga:K2")
        self.assertEqual((k2["result"], k2["found"]), ("FAIL", "Missing"))
        self.assertTrue(k2["bbox_estimated"])
        self.assertTrue(40 <= k2["bbox"][0] and k2["bbox"][2] <= 200)   # inside the gap

    def test_compare_marks_closed_open_and_new(self):
        before = sheet_for(("K1", 0), ("K3", 200))["checklist"]          # K2 missing
        after = sheet_for(("K1", 0), ("K2", 100))["checklist"]           # K2 fixed, K3 now missing
        diff = checks.compare(before, after)
        self.assertEqual([c["key"] for c in diff["closed"]], ["ga:K2"])
        self.assertEqual([c["key"] for c in diff["new"]], ["ga:K3"])
        self.assertEqual(diff["still_open"], [])


class CheckSheetApiTests(_Base):
    def recheck(self, inspection_id, image):
        data = {"image": (io.BytesIO((self.tmp / image).read_bytes()), image)}
        return self.client.post(f"/api/inspections/{inspection_id}/recheck", data=data,
                                content_type="multipart/form-data")

    def test_every_fail_has_proof(self):
        body = self.upload(image="bad.png").get_json()
        sheet = body["result"]["checklist"]
        fails = {i["key"]: i for i in sheet if i["result"] == "FAIL"}
        self.assertEqual(set(fails), {"ga:K2", "label:K1", "ferrule:105"})
        for it in fails.values():
            self.assertIsNotNone(it["bbox"], it["key"])
            self.assertIsNotNone(it["snippet"], it["key"])
            snippet = self.client.get(f"/api/inspections/{body['id']}/snippets/{it['snippet']}")
            self.assertEqual(snippet.status_code, 200)
            self.assertTrue(snippet.data.startswith(b"\x89PNG"))
            snippet.close()
        self.assertEqual(self.client.get(f"/api/inspections/{body['id']}/snippets/../x.png").status_code, 404)

    def test_every_fail_says_how_to_fix_it(self):
        sheet = self.upload(image="bad.png").get_json()["result"]["checklist"]
        fix = {i["key"]: i["fix"] for i in sheet}
        self.assertIn("Install the contactor K2", fix["ga:K2"])
        self.assertIn("between K1 and F1", fix["ga:K2"])
        self.assertEqual(fix["label:K1"], "Replace the label 'K7' on this contactor with 'K1'.")
        self.assertIn("Fit ferrule '105' on the wire A1:Q0 -> K1:A1", fix["ferrule:105"])
        self.assertTrue(all(i["fix"] == "" for i in sheet if i["result"] == "PASS"))

    def test_checklist_excel_download(self):
        body = self.upload().get_json()
        r = self.client.get(f"/api/inspections/{body['id']}/checklist.xlsx")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data.startswith(b"PK"))
        r.close()

    def test_recheck_closes_fixed_issues(self):
        first = self.upload(image="bad.png", cabinet_name="CC-01").get_json()
        second = self.recheck(first["id"], "good.png")
        self.assertEqual(second.status_code, 201)
        body = second.get_json()
        self.assertEqual((body["verdict"], body["parent_id"], body["round"]), ("PASS", first["id"], 2))
        re = body["result"]["recheck"]
        self.assertEqual({c["key"] for c in re["closed"]}, {"ga:K2", "label:K1", "ferrule:105"})
        self.assertEqual((re["still_open"], re["new"]), ([], []))
        self.assertEqual((re["before"]["verdict"], re["after"]["verdict"]), ("FAIL", "PASS"))

        history = self.client.get(f"/api/inspections/{body['id']}/history").get_json()["items"]
        self.assertEqual([h["id"] for h in history], [first["id"], body["id"]])

    def test_recheck_without_a_fix_keeps_issues_open(self):
        first = self.upload(image="bad.png").get_json()
        re = self.recheck(first["id"], "bad.png").get_json()["result"]["recheck"]
        self.assertEqual({c["key"] for c in re["still_open"]}, {"ga:K2", "label:K1", "ferrule:105"})
        self.assertEqual(re["closed"], [])

    def test_recheck_needs_a_photo(self):
        first = self.upload().get_json()
        r = self.client.post(f"/api/inspections/{first['id']}/recheck", data={}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()


class WireColourTests(_Base):
    """Wire colour check on generated photos (wire 104 drawn blue, the wire list says red)."""

    def test_colour_names_and_reading(self):
        from app.checks import wire_colour_check as W
        self.assertEqual(W.expected_colour("BK"), "black")
        self.assertEqual(W.expected_colour("Green-Yellow"), "green_yellow")
        self.assertEqual(W.expected_colour("Brown"), "brown")
        patch = lambda bgr: np.full((10, 10, 3), bgr, np.uint8).reshape(-1, 3)
        self.assertEqual(W.read_colour(W.classify(patch((200, 70, 30)))), "blue")
        self.assertEqual(W.read_colour(W.classify(patch((40, 40, 200)))), "red")
        self.assertEqual(W.read_colour(W.classify(patch((25, 25, 25)))), "black")
        mixed = np.concatenate([patch((200, 70, 30)), patch((40, 40, 200)), patch((25, 25, 25))])
        self.assertIsNone(W.read_colour(W.classify(mixed)))          # unclear -> no verdict

    def test_wrong_wire_colour_fails_and_others_pass(self):
        make_samples.make_photo(self.tmp / "wires.png", defects=False, wire_colours=make_samples.WIRE_DEMO)
        body = self.upload(image="wires.png").get_json()
        rows = {i["item"]: i for i in body["result"]["checklist"] if i["check"] == "wire_colour"}
        self.assertEqual(rows["104"]["result"], "FAIL")
        self.assertEqual((rows["104"]["expected"], rows["104"]["found"]), ("red", "blue"))
        self.assertTrue(all(rows[w]["result"] == "PASS" for w in ("101", "102", "103", "105", "106") if w in rows))
        self.assertEqual(body["verdict"], "FAIL")

    def test_no_wires_in_photo_means_no_colour_rows(self):
        body = self.upload().get_json()          # the normal good sample has no drawn wires
        self.assertFalse(any(i["check"] == "wire_colour" for i in body["result"]["checklist"]))
        self.assertEqual(body["verdict"], "PASS")
