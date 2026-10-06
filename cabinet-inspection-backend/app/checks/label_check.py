"""Label check: every device label is readable and matches the drawing."""
from app.checks.base import CheckContext, item, register


@register("label", "Label check", order=20)
def run(ctx: CheckContext) -> list[dict]:
    items = []
    for c in ctx.core.get("components", []):
        tag, status = c["tag"], c["status"]
        if status == "missing":
            continue                      # no device -> nothing to read; reported by the GA check
        what = f"Label on {tag} reads {tag}"
        if status == "label_mismatch":
            d = ctx.defect("LABEL_MISMATCH", tag) or {}
            items.append(item(tag, what, tag, c.get("read_as") or "?", False, code="LABEL_MISMATCH",
                              message=d.get("message", f"Expected label '{tag}'."), bbox=c.get("bbox")))
        elif status == "label_missing":
            d = ctx.defect("LABEL_MISSING", tag) or {}
            items.append(item(tag, what, tag, "No label", False, code="LABEL_MISSING",
                              message=d.get("message", f"Label '{tag}' could not be read.")))
        else:
            items.append(item(tag, what, tag, c.get("read_as") or tag, True, bbox=c.get("bbox")))
    return items
