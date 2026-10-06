"""Rule Engine -> compares Expected (PDF + Excel) vs Actual (Vision + OCR).

Defect codes
------------
COMPONENT_MISSING        critical  expected tag not found and no matching device seen
COMPONENT_TYPE_MISMATCH  critical  tag found on a device of the wrong type (YOLO only)
COMPONENT_COUNT_SHORT    critical  fewer devices of a type than the BOM needs (YOLO only)
EXTRA_COMPONENT          major     more devices of a type than the BOM lists (YOLO only)
LABEL_MISSING            major     device is there but its tag label is not visible
LABEL_MISMATCH           major     a near-identical label was read (K1 expected, K7 read)
WIRE_LABEL_MISSING       major     wire number from the wiring list not found
WIRE_LABEL_MISMATCH      major     near-identical wire number read instead
UNEXPECTED_LABEL         minor     a tag-like label not present in any document

Verdict: FAIL if any critical or major defect, otherwise PASS (minors are warnings).
"""
import re
from collections import Counter
from dataclasses import dataclass

from app.utils.text import levenshtein, ocr_fold, tag_prefix

SEVERITY_ORDER = {"critical": 0, "major": 1, "minor": 2}


@dataclass
class RuleConfig:
    tag_pattern: str = r"^-?[A-Z]{1,3}\d{1,4}(\.\d{1,3})?$"
    check_wire_labels: bool = True
    report_unexpected_labels: bool = True


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _center(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def _defect(code, severity, item, expected, actual, message):
    return {"code": code, "severity": severity, "item": item,
            "expected": expected, "actual": actual, "message": message}


class LabelMatcher:
    """Finds expected labels among OCR texts, tolerant to OCR confusions."""

    def __init__(self, ocr_texts: list[dict], all_expected: set[str]):
        self.texts = ocr_texts
        self.all_expected = all_expected
        self.all_expected_folded = {ocr_fold(e) for e in all_expected}
        self.used_ids: set[int] = set()   # OCR items consumed by a match / mismatch

    def match(self, label: str) -> tuple[str, dict | None]:
        folded = ocr_fold(label)
        exact = [t for t in self.texts if t["text"] == label]
        fuzzy = [t for t in self.texts if ocr_fold(t["text"]) == folded]
        hits = exact or fuzzy
        if hits:
            best = max(hits, key=lambda t: t["confidence"])
            for h in hits:
                self.used_ids.add(id(h))
            return "found", best

        # near miss: same letter prefix, one character different, and the text
        # read is NOT itself another expected label (K2 must not "explain" K1)
        prefix = tag_prefix(label)
        candidates = [
            t for t in self.texts
            if tag_prefix(t["text"]) == prefix
            and id(t) not in self.used_ids              # one misread explains one label
            and t["text"] not in self.all_expected
            and ocr_fold(t["text"]) not in self.all_expected_folded
            and levenshtein(ocr_fold(t["text"]), folded) == 1
            and abs(len(t["text"]) - len(label)) <= 1
        ]
        if candidates:
            best = max(candidates, key=lambda t: t["confidence"])
            self.used_ids.add(id(best))
            return "mismatch", best
        return "missing", None


def _locate(detections: list[dict], bbox) -> dict | None:
    """The detection a label belongs to: the one containing the label centre,
    otherwise the nearest one within 1.5 label-heights of its edge."""
    if not detections or not bbox:
        return None
    cx, cy = _center(bbox)
    inside = [d for d in detections
              if d["bbox"][0] <= cx <= d["bbox"][2] and d["bbox"][1] <= cy <= d["bbox"][3]]
    if inside:
        return min(inside, key=lambda d: (d["bbox"][2] - d["bbox"][0]) * (d["bbox"][3] - d["bbox"][1]))
    reach = 1.5 * max(bbox[3] - bbox[1], 10)

    def gap(d):
        b = d["bbox"]
        dx = max(b[0] - cx, 0, cx - b[2])
        dy = max(b[1] - cy, 0, cy - b[3])
        return (dx * dx + dy * dy) ** 0.5

    nearest = min(detections, key=gap)
    return nearest if gap(nearest) <= reach else None


locate = _locate   # public name, used by the QC checks in app/checks/


# --------------------------------------------------------------------------- #
# main entry point
# --------------------------------------------------------------------------- #
def evaluate(expected_components: list[dict], expected_wiring: dict,
             vision: dict, ocr: dict, cfg: RuleConfig | None = None) -> dict:
    cfg = cfg or RuleConfig()
    detections = vision.get("detections", [])
    typed = bool(vision.get("typed"))
    ocr_texts = ocr.get("texts", [])

    tagged = [c for c in expected_components if c.get("tag")]
    wire_labels = expected_wiring.get("labels", []) if cfg.check_wire_labels else []
    all_expected = {c["tag"] for c in tagged} | set(expected_wiring.get("labels", []))
    matcher = LabelMatcher(ocr_texts, all_expected)

    defects: list[dict] = []
    component_checks: list[dict] = []
    claimed_detections: set[int] = set()
    missing_by_type: Counter = Counter()
    # a device with the wrong type is already one defect - don't count it again
    mismatch_expected: Counter = Counter()
    mismatch_detected: Counter = Counter()

    # ---- 1. every tagged component from the PDF ---------------------------
    for comp in tagged:
        tag, ctype = comp["tag"], comp["type"]
        status, hit = matcher.match(tag)
        check = {"tag": tag, "type": ctype, "description": comp.get("description", ""),
                 "status": "ok", "read_as": hit["text"] if hit else None,
                 "bbox": hit["bbox"] if hit else None, "detected_type": None}

        if status in ("found", "mismatch"):
            det = _locate(detections, hit["bbox"])
            if det is not None:
                claimed_detections.add(id(det))
                check["detected_type"] = det["type"] if typed else None
                if typed and ctype != "unknown" and det["type"] != ctype:
                    check["status"] = "type_mismatch"
                    mismatch_expected[ctype] += 1
                    mismatch_detected[det["type"]] += 1
                    defects.append(_defect(
                        "COMPONENT_TYPE_MISMATCH", "critical", tag, ctype, det["type"],
                        f"{tag} should be a {ctype.replace('_', ' ')} but a "
                        f"{det['type'].replace('_', ' ')} was detected there."))
            if status == "mismatch":
                check["status"] = "label_mismatch"
                defects.append(_defect(
                    "LABEL_MISMATCH", "major", tag, tag, hit["text"],
                    f"Expected label '{tag}' but read '{hit['text']}' - wrong label or misprint."))
        else:
            check["status"] = "missing"
            missing_by_type[ctype] += 1
            component_checks.append(check)
            continue
        component_checks.append(check)

    # Components whose label was missing: if YOLO sees an unclaimed device of
    # that type, the device is there and only the label is missing.
    unclaimed = [d for d in detections if id(d) not in claimed_detections]
    spare_by_type = Counter(d["type"] for d in unclaimed) if typed else Counter()
    for check in component_checks:
        if check["status"] != "missing":
            continue
        tag, ctype = check["tag"], check["type"]
        if typed and spare_by_type[ctype] > 0:
            spare_by_type[ctype] -= 1
            missing_by_type[ctype] -= 1
            check["status"] = "label_missing"
            defects.append(_defect(
                "LABEL_MISSING", "major", tag, tag, None,
                f"A {ctype.replace('_', ' ')} is present but label '{tag}' could not be read on it."))
        else:
            hint = "" if typed else " (component missing, or its label is not visible in the photo)"
            defects.append(_defect(
                "COMPONENT_MISSING", "critical", tag, f"{tag} ({ctype.replace('_', ' ')})", None,
                f"{tag} - {check['description'] or ctype.replace('_', ' ')} - was not found{hint}."))

    # ---- 2. type counts (only meaningful with a typed detector) -----------
    if typed:
        expected_count: Counter = Counter()
        for c in expected_components:
            if c["type"] != "unknown":
                expected_count[c["type"]] += c.get("quantity", 1)
        detected_count = Counter(d["type"] for d in detections)
        for ctype in sorted(set(expected_count) | set(detected_count)):
            exp, got = expected_count[ctype], detected_count[ctype]
            already = missing_by_type[ctype] + mismatch_expected[ctype]   # reported per tag above
            if got < exp and exp - got > already:
                defects.append(_defect(
                    "COMPONENT_COUNT_SHORT", "critical", ctype, str(exp), str(got),
                    f"BOM needs {exp} x {ctype.replace('_', ' ')}, only {got} detected."))
            elif got - mismatch_detected[ctype] > exp:
                extra = got - mismatch_detected[ctype] - exp
                defects.append(_defect(
                    "EXTRA_COMPONENT", "major", ctype, str(exp), str(got),
                    f"{extra} more {ctype.replace('_', ' ')}(s) detected than the BOM lists."))

    # ---- 3. wire labels from the Excel wiring list ------------------------
    wire_checks: list[dict] = []
    for label in wire_labels:
        status, hit = matcher.match(label)
        wire_checks.append({"label": label, "status": {"found": "ok"}.get(status, status),
                            "read_as": hit["text"] if hit else None,
                            "bbox": hit["bbox"] if hit else None})
        if status == "mismatch":
            defects.append(_defect("WIRE_LABEL_MISMATCH", "major", label, label, hit["text"],
                                   f"Wire '{label}' expected, read '{hit['text']}'."))
        elif status == "missing":
            wires = [w for w in expected_wiring.get("wires", []) if w["wire_no"] == label]
            route = ", ".join(f"{w['from']}->{w['to']}" for w in wires[:3] if w["from"] or w["to"])
            defects.append(_defect("WIRE_LABEL_MISSING", "major", label, label, None,
                                   f"Wire label '{label}' not found" + (f" (route {route})." if route else ".")))

    # ---- 4. labels in the photo that no document mentions -----------------
    if cfg.report_unexpected_labels:
        pattern = re.compile(cfg.tag_pattern)
        seen: set[str] = set()
        all_folded = {ocr_fold(e) for e in all_expected}
        for t in ocr_texts:
            txt = t["text"]
            if (id(t) in matcher.used_ids or txt in seen or not pattern.match(txt)
                    or ocr_fold(txt) in all_folded):
                continue
            seen.add(txt)
            defects.append(_defect("UNEXPECTED_LABEL", "minor", txt, None, txt,
                                   f"Label '{txt}' is in the photo but not in the PDF or wiring list."))

    # ---- verdict -----------------------------------------------------------
    defects.sort(key=lambda d: (SEVERITY_ORDER[d["severity"]], d["code"], str(d["item"])))
    counts = Counter(d["severity"] for d in defects)
    total_checks = len(component_checks) + len(wire_checks)
    passed = sum(c["status"] == "ok" for c in component_checks) + sum(c["status"] == "ok" for c in wire_checks)
    score = round(100.0 * passed / total_checks, 1) if total_checks else 0.0
    verdict = "FAIL" if counts["critical"] or counts["major"] else "PASS"

    return {
        "verdict": verdict,
        "score": score,
        "summary": {
            "critical": counts["critical"], "major": counts["major"], "minor": counts["minor"],
            "checks_total": total_checks, "checks_passed": passed,
            "expected_components": len(expected_components),
            "expected_wire_labels": len(wire_labels),
            "detected_components": len(detections),
            "ocr_labels_read": len(ocr_texts),
        },
        "components": component_checks,
        "wire_labels": wire_checks,
        "defects": defects,
    }
