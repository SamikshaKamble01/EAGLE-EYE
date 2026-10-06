"""Ferrule check: every wire sleeve of the wire list is fitted and readable."""
from app.checks.base import CheckContext, estimate_gap, item, neighbours, place, register


def _route(ctx: CheckContext, label: str) -> str:
    wires = [w for w in ctx.expected_wiring.get("wires", []) if w.get("wire_no") == label]
    return ", ".join(f"{w.get('from', '')} -> {w.get('to', '')}" for w in wires[:2] if w.get("from") or w.get("to"))


@register("ferrule", "Ferrule check", order=30)
def run(ctx: CheckContext) -> list[dict]:
    checks = ctx.core.get("wire_labels", [])
    boxes = [(w["label"], ctx.device_box(w.get("bbox"))) for w in checks]   # whole sleeve, not just the digits
    items = []
    labels = [w["label"] for w in checks]
    present = {w["label"] for w in checks if w["status"] != "missing"}
    for index, w in enumerate(checks):
        label, status = w["label"], w["status"]
        route = _route(ctx, label)
        wire = f"the wire {route}" if route else "its wire"
        what = f"Ferrule {label}" + (f" ({route})" if route else "")
        if status == "ok":
            items.append(item(label, what, label, w.get("read_as") or label, True, bbox=w.get("bbox")))
        elif status == "mismatch":
            d = ctx.defect("WIRE_LABEL_MISMATCH", label) or {}
            items.append(item(label, what, label, w.get("read_as") or "?", False, code="WIRE_LABEL_MISMATCH",
                              message=d.get("message", f"Wire '{label}' expected."), bbox=w.get("bbox"),
                              fix=f"Replace the ferrule '{w.get('read_as') or '?'}' with '{label}' on {wire}."))
        else:
            d = ctx.defect("WIRE_LABEL_MISSING", label) or {}
            items.append(item(label, what, "Ferrule fitted", "No ferrule", False, code="WIRE_LABEL_MISSING",
                              message=d.get("message", f"Wire label '{label}' not found."),
                              bbox=estimate_gap(boxes, index, ctx.image_size), estimated=True,
                              fix=f"Fit ferrule '{label}' on {wire}"
                                  + (f" (expected {where})" if (where := place(*neighbours(labels, index, present))) else "")
                                  + ". If it is fitted, turn it so the number faces the camera."))
    return items
