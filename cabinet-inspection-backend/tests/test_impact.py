"""Fault-impact analysis on the documented topology of cabinet 13SP04331 (sheets 10, 11, 12 of
AO-400-13-S463-000056) and on small made-up topologies where a case needs one."""
import unittest
from pathlib import Path

from app.services import impact_service as I
from app.services import topology_service

TOPO = topology_service.load("13SP04331")


def comp(tag, status="ok", **kw):
    return {"tag": tag, "type": kw.pop("type", "unknown"), "description": kw.pop("description", tag), "status": status,
            "read_as": kw.pop("read_as", tag if status == "ok" else None), "bbox": None, "photo": 0, **kw}


def result(*components, unseen=(), wire_labels=(), wiring=()):
    return {"components": list(components), "wire_labels": list(wire_labels),
            "checklist": [{"item": t, "code": "NOT_PHOTOGRAPHED", "result": "WARN"} for t in unseen],
            "expected": {"components": [{"tag": c["tag"], "view": "left", "source": "layout p5"} for c in components],
                         "wiring": list(wiring)}}


def kinds(r):
    return {(d["kind"], d["tag"]) for d in r["defects"]}


def get(r, kind, tag):
    return next(d for d in r["defects"] if d["kind"] == kind and d["tag"] == tag)


GOOD = [comp(t) for t in ("DS1", "XP11", "CB11", "PS11", "D11", "CB41", "CB42", "X41", "X42",
                          "DS2", "XS21", "CB21", "PS21", "D21", "CB51", "CB52", "X51", "X52")]


class TopologyDataTests(unittest.TestCase):
    def test_topology_exists_and_is_consistent(self):
        self.assertIsNotNone(TOPO)
        ids = set(TOPO["nodes"])
        for e in TOPO["edges"]:
            self.assertIn(e["from"], ids, e)
            self.assertIn(e["to"], ids, e)
            self.assertTrue(e["sheet"])                      # every connection names its source sheet
        self.assertGreaterEqual(len(TOPO["unknown"]), 3)      # what the drawings do not show is listed

    def test_documented_dual_feed_of_the_modules(self):
        g = I.Graph(TOPO)
        feeds = {e["from"] for e in g.pred["13MFW04331"]}
        self.assertEqual(feeds, {"X42", "X52"})               # sheet 12: 1A/1B from X42, 3A/3B from X52

    def test_real_drawing_tags_are_known(self):
        pdf = next(iter(Path(__file__).resolve().parents[2].glob("Dataset2_Cabinet_and_BOM/13SP04331/*.pdf")), None)
        if pdf is None:
            self.skipTest("13SP04331 dataset not present")
        from app.services import pdf_service
        tags = {c["tag"] for c in pdf_service.parse_expected_components(pdf) if c["tag"]}
        self.assertEqual(topology_service.cabinet_tag(pdf), "13SP04331")
        outside = {t for t in tags if t not in TOPO["nodes"]}
        self.assertLessEqual(len(outside), 0.2 * len(tags), outside)   # the rest is reported as 'not documented'


class ImpactTests(unittest.TestCase):
    # 1
    def test_1_everything_present_and_labelled_passes(self):
        r = I.analyze(result(*GOOD), TOPO)
        self.assertEqual(r["disposition"], "PASS")
        self.assertEqual((r["summary"]["electrical_defects"], r["summary"]["labeling_defects"]), (0, 0))
        self.assertEqual(r["statuses"]["cabinet_functional"], "NO_FUNCTIONAL_LOSS_IDENTIFIED")

    # 2
    def test_2_missing_part_in_power_path_traces_documented_dependants(self):
        r = I.analyze(result(*[c for c in GOOD if c["tag"] != "CB11"], comp("CB11", "missing")), TOPO)
        d = get(r, "component_missing", "CB11")
        self.assertEqual(d["circuit"], "AC feed A (UPSA)")
        self.assertEqual(d["subsystem"], "AC input and protection")
        self.assertEqual(set(d["consequences"]["lost"]), {"PS11", "D11", "CB41", "CB42", "X41", "X42"})
        self.assertIn("13MFW04331", d["consequences"]["degraded"])
        self.assertNotIn("PS21", d["consequences"]["lost"] + d["consequences"]["degraded"])   # feed B is independent
        self.assertEqual(d["impact_confidence"], "probable")                  # drawing-based, not tested
        self.assertIn("sheet", d["reference"])
        self.assertEqual(r["disposition"], "FAIL")

    # 8
    def test_8_one_redundant_channel_fails_without_cabinet_failure(self):
        r = I.analyze(result(*[c for c in GOOD if c["tag"] != "PS11"], comp("PS11", "missing")), TOPO)
        d = get(r, "component_missing", "PS11")
        self.assertEqual(d["severity"], "major")                              # redundancy lost, no load lost
        self.assertTrue(d["redundancy"]["mitigated"])
        self.assertIn("X52", d["redundancy"]["note"])                         # the remaining documented feed
        self.assertEqual(r["statuses"]["cabinet_functional"], "REDUNDANCY_LOST")
        feed_b = next(c for c in r["statuses"]["circuit"] if c["name"] == "24 VDC feed B")
        self.assertNotEqual(feed_b["status"], "SUPPLY_LOST")
        # both channels gone: now loads really lose their supply
        both = I.analyze(result(*[c for c in GOOD if c["tag"] not in ("PS11", "PS21")],
                                comp("PS11", "missing"), comp("PS21", "missing")), TOPO)
        self.assertEqual(both["statuses"]["cabinet_functional"], "FUNCTION_LOST_PROBABLE")

    # 3
    def test_3_missing_noncritical_label_is_an_identification_defect_only(self):
        r = I.analyze(result(*GOOD), TOPO, observations={"PS11": {"component": "present", "label": "missing"}})
        d = get(r, "label_missing", "PS11")
        self.assertEqual(d["consequences"], {"lost": [], "degraded": [], "uncertain": []})
        self.assertIn("Identification/documentation defect", d["classification"])
        self.assertEqual(d["final_status"], "DOCUMENTATION_DEFECT")
        self.assertEqual(r["disposition"], "PASS_WITH_DOCUMENTATION_DEFECTS")
        self.assertEqual(r["summary"]["electrical_defects"], 0)
        self.assertEqual(r["statuses"]["cabinet_functional"], "NO_FUNCTIONAL_LOSS_IDENTIFIED")
        self.assertIn("does not mean any circuit is open", d["rationale"])

    # 4
    def test_4_missing_wire_label_flags_risk_without_assuming_a_break(self):
        wire = {"label": "104", "status": "missing", "photo": 0}
        r = I.analyze(result(*GOOD, wire_labels=[wire], wiring=[{"wire_no": "104", "from": "K1:A1", "to": "X1:4"}]), TOPO)
        d = get(r, "wire_label_missing", "104")
        self.assertIn("Maintenance/traceability risk", d["classification"])
        self.assertIn("not assumed", d["rationale"])
        self.assertEqual(d["consequences"]["lost"], [])
        self.assertEqual(d["final_status"], "DOCUMENTATION_DEFECT")
        self.assertEqual(r["disposition"], "PASS_WITH_DOCUMENTATION_DEFECTS")

    # 5
    def test_5_wrong_tag_number_is_detected(self):
        r = I.analyze(result(*[c for c in GOOD if c["tag"] != "CB11"], comp("CB11", "label_mismatch", read_as="CB12")), TOPO)
        rec = next(c for c in r["components"] if c["tag"] == "CB11")
        self.assertEqual((rec["component_status"], rec["label_status"]), ("INCORRECTLY_IDENTIFIED", "INCORRECT"))
        d = get(r, "label_incorrect", "CB11")
        self.assertIn("'CB12'", d["evidence"]["detail"])
        self.assertEqual(d["final_status"], "HOLD")                           # protective device -> engineering review
        self.assertEqual(r["disposition"], "HOLD_FOR_ENGINEERING_REVIEW")
        # a wrong tag on a non-protective part is a documentation defect
        r2 = I.analyze(result(*[c for c in GOOD if c["tag"] != "PS11"], comp("PS11", "label_mismatch", read_as="PS12")), TOPO)
        self.assertEqual(get(r2, "label_incorrect", "PS11")["final_status"], "DOCUMENTATION_DEFECT")

    # 6
    def test_6_component_missing_but_label_left_on_the_rail(self):
        r = I.analyze(result(*GOOD), TOPO, observations={"CB21": {"component": "missing", "label": "present"}})
        rec = next(c for c in r["components"] if c["tag"] == "CB21")
        self.assertEqual((rec["component_status"], rec["label_status"]), ("MISSING", "PRESENT_WITHOUT_COMPONENT"))
        self.assertEqual(rec["evidence"]["confidence"], "high")
        self.assertEqual({k for k, t in kinds(r) if t == "CB21"}, {"component_missing", "label_present_component_missing"})

    # 7
    def test_7_place_not_in_the_photos_is_unknown_not_missing(self):
        r = I.analyze(result(*[c for c in GOOD if c["tag"] != "PS21"], comp("PS21", "missing"), unseen=["PS21"]), TOPO)
        rec = next(c for c in r["components"] if c["tag"] == "PS21")
        self.assertEqual(rec["component_status"], "UNVERIFIABLE")
        self.assertFalse([d for d in r["defects"] if d["tag"] == "PS21"])
        self.assertEqual(r["disposition"], "HOLD_FOR_ENGINEERING_REVIEW")
        self.assertEqual(r["summary"]["unresolved"], 1)
        self.assertEqual(r["statuses"]["component"]["MISSING"] if "MISSING" in r["statuses"]["component"] else 0, 0)

    # 9
    def test_9_missing_part_of_a_safety_flagged_circuit_escalates(self):
        r = I.analyze(result(comp("SDTB1", "missing"), comp("PS11")), TOPO)
        d = get(r, "component_missing", "SDTB1")
        self.assertTrue(d["safety_related"])
        self.assertEqual(d["severity"], "critical")
        self.assertTrue(d["approval_required"])
        self.assertEqual(r["statuses"]["safety_review"], "REQUIRED")
        self.assertTrue(r["engineering_approval_required"])
        self.assertEqual(r["disposition"], "FAIL")
        # the policy can name further safety-related parts; the engine follows it
        r2 = I.analyze(result(comp("CB22", "missing")), TOPO, policy={"safety_nodes": ["CB22"]})
        self.assertEqual(r2["statuses"]["safety_review"], "REQUIRED")

    # 10
    def test_10_no_documented_connection_means_no_invented_propagation(self):
        topo = {"cabinet": "TEST1", "document": "test", "nodes": {
            "SRC": {"kind": "source", "function": "supply", "circuit": "C1", "subsystem": "S1", "sheet": "1"},
            "A": {"kind": "breaker", "function": "a", "circuit": "C1", "subsystem": "S1", "sheet": "1"},
            "L1": {"kind": "load", "function": "l", "circuit": "C1", "subsystem": "S1", "sheet": "1"},
            "B": {"kind": "breaker", "function": "b", "circuit": "C2", "subsystem": "S2", "sheet": "2"},
            "L2": {"kind": "load", "function": "l", "circuit": "C2", "subsystem": "S2", "sheet": "2"}},
            "edges": [{"from": "SRC", "to": "A", "type": "power", "sheet": "1"},
                      {"from": "A", "to": "L1", "type": "power", "sheet": "1"},
                      {"from": "B", "to": "L2", "type": "power", "sheet": "2"}], "unknown": []}
        r = I.analyze(result(comp("A", "missing"), comp("B"), comp("L1"), comp("L2")), topo)
        d = get(r, "component_missing", "A")
        self.assertEqual(d["consequences"]["lost"], ["L1"])
        states = {n["id"]: n["state"] for n in r["graph"]["nodes"]}
        self.assertNotIn(states.get("L2"), ("lost", "uncertain", "degraded"))   # C2 / S2 untouched
        sub = {s["name"]: s["status"] for s in r["statuses"]["subsystem"]}
        self.assertEqual(sub["S2"], "NO_DEFECT_FOUND")
        self.assertEqual(sub["S1"], "FAULT")

    # 11 - the drawing / 3D side: the engine's output carries what the 3D view colours
    def test_11_graph_and_states_for_the_3d_view(self):
        r = I.analyze(result(*[c for c in GOOD if c["tag"] != "PS11"], comp("PS11", "missing")), TOPO)
        states = {n["id"]: n["state"] for n in r["graph"]["nodes"]}
        self.assertEqual(states["PS11"], "fault")
        self.assertEqual(states["D11"], "lost")
        self.assertEqual(states["group:13MFW modules"], "degraded")
        self.assertTrue(next(n for n in r["graph"]["nodes"] if n["id"] == "group:13MFW modules")["members"])
        self.assertTrue({e["from"] for e in r["graph"]["edges"]} <= set(states))

    # 12
    def test_12_incomplete_documentation_gives_unknown_not_invented_links(self):
        r = I.analyze(result(comp("K2", "missing")), None)                      # no topology at all
        d = get(r, "component_missing", "K2")
        self.assertEqual(d["impact_confidence"], "unknown")
        self.assertEqual(d["consequences"], {"lost": [], "degraded": [], "uncertain": []})
        self.assertEqual(r["statuses"]["cabinet_functional"], "NOT_ASSESSED")
        self.assertTrue(any("topology" in m["about"].lower() for m in r["missing_information"]))
        # a part that is not on the documented sheets: its consequence is unknown too
        r2 = I.analyze(result(comp("XG11", "missing")), TOPO)
        self.assertEqual(get(r2, "component_missing", "XG11")["impact_confidence"], "unknown")
        self.assertTrue(r2["missing_information"])
        # a part with documented-but-incomplete onward connections (smoke detector supply)
        r3 = I.analyze(result(comp("SDTB2", "missing")), TOPO)
        self.assertEqual(get(r3, "component_missing", "SDTB2")["consequences"]["uncertain"], ["13RDEW-40A949H"])

    def test_policy_is_flagged_as_not_approved(self):
        r = I.analyze(result(*GOOD), TOPO)
        self.assertFalse(r["policy"]["approved"])
        self.assertTrue(any("policy" in m["about"].lower() for m in r["missing_information"]))
        self.assertTrue(any("safe" in a for a in r["assumptions"]))


if __name__ == "__main__":
    unittest.main()


from tests.test_api import _Base          # noqa: E402


class ImpactApiTests(_Base):
    def test_result_carries_the_impact_analysis(self):
        body = self.upload(image="bad.png").get_json()
        impact = body["result"]["impact"]
        self.assertFalse(impact["topology"]["found"])               # the sample drawing has no documented topology
        self.assertEqual(impact["disposition"], "FAIL")
        k2 = next(d for d in impact["defects"] if d["tag"] == "K2")
        self.assertEqual((k2["kind"], k2["impact_confidence"]), ("component_missing", "unknown"))
        self.assertTrue(any("topology" in m["about"].lower() for m in impact["missing_information"]))

    def test_inspector_observation_changes_the_analysis(self):
        body = self.upload(image="bad.png").get_json()
        url = f"/api/inspections/{body['id']}/observations"
        r = self.client.put(url, json={"K2": {"component": "present", "label": "missing"}})
        self.assertEqual(r.status_code, 200)
        impact = r.get_json()["impact"]
        self.assertFalse([d for d in impact["defects"] if d["kind"] == "component_missing" and d["tag"] == "K2"])
        self.assertIn(("label_missing", "K2"), {(d["kind"], d["tag"]) for d in impact["defects"]})
        saved = self.client.get(f"/api/inspections/{body['id']}").get_json()["result"]
        self.assertEqual(saved["observations"]["K2"]["label"], "missing")       # persisted
        self.assertEqual(self.client.put(url, json={"K2": {"component": "gone"}}).status_code, 400)
        self.assertEqual(self.client.put(url, json={"ZZ9": {"component": "missing"}}).status_code, 400)
        self.assertEqual(self.client.put(url, data="x", content_type="text/plain").status_code, 400)
