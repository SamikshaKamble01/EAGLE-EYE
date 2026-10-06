"""Notes: tag-like labels in the photo that no document mentions (does not fail the cabinet)."""
from app.checks.base import CheckContext, item, register


@register("extras", "Not in the documents", order=90)
def run(ctx: CheckContext) -> list[dict]:
    items = []
    for d in ctx.core.get("defects", []):
        if d["code"] != "UNEXPECTED_LABEL":
            continue
        text = next((t for t in ctx.ocr.get("texts", []) if t["text"] == d["item"]), None)
        items.append(item(d["item"], f"Label {d['item']} is listed in the documents", "Not listed", d["item"], False,
                          warn=True, severity="minor", code="UNEXPECTED_LABEL", message=d["message"],
                          bbox=ctx.device_box(text["bbox"]) if text else None,
                          fix=f"Remove {d['item']}, or add it to the drawing if it is meant to be there."))
    return items
