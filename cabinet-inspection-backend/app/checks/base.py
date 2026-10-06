"""Plug-in QC checks -> the QC check sheet.

Every file in app/checks/ that registers a function becomes one section of the
check sheet. To add a check, drop a new file here - nothing else changes:

    # app/checks/earthing_check.py
    from app.checks.base import item, register

    @register("earthing", "Earthing check", order=50)
    def run(ctx):
        ok = any(t["text"] == "PE" for t in ctx.ocr["texts"])
        return [item("PE", "Earth bar label present", "PE", "PE" if ok else "Not found", ok,
                     severity="major", code="EARTH_LABEL_MISSING",
                     message="Earth bar label 'PE' was not found.")]

Each check returns a list of check-sheet items (see `item`). An item is PASS,
FAIL, or WARN (a note that does not fail the cabinet).
"""
import logging
from dataclasses import dataclass

from app.services.rule_engine import SEVERITY_ORDER, locate

log = logging.getLogger(__name__)

_REGISTRY: list[dict] = []


def register(check_id: str, title: str, order: int = 100, kind: str = "must"):
    """Decorator: add a check to the check sheet. Lower `order` runs / lists first."""
    def decorator(fn):
        _REGISTRY.append({"id": check_id, "title": title, "order": order, "kind": kind, "run": fn})
        return fn
    return decorator


def registered() -> list[dict]:
    return sorted(_REGISTRY, key=lambda c: c["order"])


@dataclass
class CheckContext:
    """Everything a check may look at."""
    expected_components: list[dict]     # from the drawing PDF, in document order
    expected_wiring: dict               # {"wires": [...], "labels": [...]} from the Excel
    vision: dict                        # {"typed": bool, "detections": [...]}
    ocr: dict                           # {"texts": [...]}
    core: dict                          # rule engine result: components, wire_labels, defects
    image_size: tuple[int, int] | None = None   # (width, height)

    def defect(self, code: str, item_name) -> dict | None:
        """The rule-engine defect for this item, if any (for its message)."""
        return next((d for d in self.core.get("defects", [])
                     if d["code"] == code and d["item"] == item_name), None)

    def device_box(self, bbox):
        """Box of the whole device a label sits on (falls back to the label box)."""
        if not bbox:
            return None
        det = locate(self.vision.get("detections", []), bbox)
        return det["bbox"] if det else bbox


def item(name, description: str, expected, found, ok: bool, *, severity: str = "major",
         code: str | None = None, message: str = "", bbox=None, estimated: bool = False,
         warn: bool = False, key: str | None = None) -> dict:
    """One row of the check sheet."""
    return {
        "key": key or str(name),
        "item": name,
        "description": description,
        "expected": expected,
        "found": found,
        "result": "PASS" if ok else ("WARN" if warn else "FAIL"),
        "severity": None if ok else severity,
        "code": None if ok else code,
        "message": "" if ok else message,
        "bbox": [int(v) for v in bbox] if bbox else None,
        "bbox_estimated": bool(estimated and bbox),
    }


# --------------------------------------------------------------------------- #
# "where should it have been?" - proof box for things that are missing
# --------------------------------------------------------------------------- #
def estimate_gap(ordered: list[tuple[str, list | None]], index: int, image_size=None):
    """Box of the empty place where ordered[index] was expected: the gap between
    its nearest located neighbours (same row), else the spot next to one of them."""
    prev = next((b for _, b in reversed(ordered[:index]) if b), None)
    nxt = next((b for _, b in ordered[index + 1:] if b), None)
    if not prev and not nxt:
        return None

    def beside(box, direction):
        w = box[2] - box[0]
        gap = max(4, w // 8)
        x1 = box[2] + gap if direction > 0 else box[0] - gap - w
        return [x1, box[1], x1 + w, box[3]]

    if prev and nxt:
        same_row = abs((prev[1] + prev[3]) - (nxt[1] + nxt[3])) / 2 < max(prev[3] - prev[1], nxt[3] - nxt[1])
        if same_row and nxt[0] > prev[2]:
            y1, y2 = min(prev[1], nxt[1]), max(prev[3], nxt[3])
            if nxt[0] - prev[2] >= 0.3 * min(prev[2] - prev[0], nxt[2] - nxt[0]):
                box = [prev[2], y1, nxt[0], y2]                      # a real gap
            else:
                box = [prev[0], y1, nxt[2], y2]                      # no gap: show both neighbours
        else:
            box = beside(prev, +1)
    else:
        box = beside(prev, +1) if prev else beside(nxt, -1)

    if image_size:
        w, h = image_size
        box = [max(0, box[0]), max(0, box[1]), min(w - 1, box[2]), min(h - 1, box[3])]
    return box if box[2] - box[0] > 4 and box[3] - box[1] > 4 else None


# --------------------------------------------------------------------------- #
# running the checks
# --------------------------------------------------------------------------- #
def run_all(ctx: CheckContext) -> list[dict]:
    """Run every registered check and return the numbered check sheet."""
    sheet: list[dict] = []
    for check in registered():
        for it in check["run"](ctx) or []:
            it["check"] = check["id"]
            it["check_title"] = check["title"]
            it["key"] = f"{check['id']}:{it['key']}"
            it["change"] = None
            it["snippet"] = None
            sheet.append(it)
    for no, it in enumerate(sheet, 1):
        it["no"] = no
    return sheet


def apply_to_result(result: dict, sheet: list[dict]) -> None:
    """Put the check sheet into the result and derive verdict / score / counts from it."""
    known = {(d["code"], d["item"]) for d in result["defects"]}
    for it in sheet:
        if it["result"] != "PASS" and it["code"] and (it["code"], it["item"]) not in known:
            result["defects"].append({"code": it["code"], "severity": it["severity"], "item": it["item"],
                                      "expected": it["expected"], "actual": it["found"], "message": it["message"]})
            known.add((it["code"], it["item"]))
    result["defects"].sort(key=lambda d: (SEVERITY_ORDER[d["severity"]], d["code"], str(d["item"])))

    counts = {s: sum(d["severity"] == s for d in result["defects"]) for s in SEVERITY_ORDER}
    passed = sum(i["result"] == "PASS" for i in sheet)
    failed = sum(i["result"] == "FAIL" for i in sheet)
    result["summary"].update(counts, checks_total=passed + failed, checks_passed=passed)
    result["score"] = round(100.0 * passed / (passed + failed), 1) if passed + failed else 0.0
    result["verdict"] = "FAIL" if counts["critical"] or counts["major"] else "PASS"
    result["checklist"] = sheet
    result["checks"] = [
        {"id": c["id"], "title": c["title"], "kind": c["kind"],
         "passed": sum(i["check"] == c["id"] and i["result"] == "PASS" for i in sheet),
         "failed": sum(i["check"] == c["id"] and i["result"] == "FAIL" for i in sheet),
         "warnings": sum(i["check"] == c["id"] and i["result"] == "WARN" for i in sheet)}
        for c in registered()
    ]


def context_from_result(result: dict) -> CheckContext:
    """Rebuild the context from a stored result (inspections saved before the check sheet existed)."""
    labels = [w["label"] for w in result.get("wire_labels", [])]
    return CheckContext(
        expected_components=result.get("expected", {}).get("components", []),
        expected_wiring={"wires": result.get("expected", {}).get("wiring", []), "labels": labels},
        vision={"typed": result.get("engines", {}).get("vision") == "yolo",
                "detections": result.get("actual", {}).get("detections", [])},
        ocr={"texts": result.get("actual", {}).get("ocr_texts", [])},
        core=result,
    )


def sheet_of(result: dict) -> list[dict]:
    return result.get("checklist") or run_all(context_from_result(result))


# --------------------------------------------------------------------------- #
# re-check: before vs after
# --------------------------------------------------------------------------- #
def compare(previous: list[dict], current: list[dict]) -> dict:
    """Mark every current item closed / open / new against the previous check sheet."""
    before = {i["key"]: i for i in previous}
    brief = lambda i: {"key": i["key"], "no": i.get("no"), "check_title": i["check_title"], "item": i["item"],
                       "description": i["description"], "expected": i["expected"], "found": i["found"]}
    closed, still_open, new = [], [], []
    for it in current:
        was_fail = before.get(it["key"], {}).get("result") == "FAIL"
        now_fail = it["result"] == "FAIL"
        if was_fail and not now_fail:
            it["change"] = "closed"
            closed.append(brief(it))
        elif was_fail and now_fail:
            it["change"] = "open"
            still_open.append(brief(it))
        elif now_fail:
            it["change"] = "new"
            new.append(brief(it))
    # failures whose row no longer exists at all (e.g. a surplus device was removed)
    current_keys = {i["key"] for i in current}
    for key, it in before.items():
        if it["result"] == "FAIL" and key not in current_keys:
            closed.append({**brief(it), "found": "No longer present"})
    return {"closed": closed, "still_open": still_open, "new": new}
