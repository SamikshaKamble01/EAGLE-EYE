"""Drawing comparison check: an uploaded image that shows a sheet of the drawing must
match it exactly. Every difference (added, removed or changed lines / text) is one row
with a box around it. See app/services/reference_service.py for how it is found."""
from app.checks.base import CheckContext, item, register


def _quote(text: str) -> str:
    return f"'{text}'" if text else "nothing"


@register("drawing", "Drawing comparison", order=15)
def run(ctx: CheckContext) -> list[dict]:
    items = []
    for n, ref in enumerate(ctx.core.get("reference") or []):
        if not ref:
            continue
        sheet = f"sheet {ref['page']}" + (f" ({ref['title']})" if ref.get("title") else "")
        if not ref["reliable"]:
            items.append(item(f"Photo {n + 1}", f"Photo {n + 1} matches drawing {sheet}", "Same as drawing",
                              "Too different to compare", False, warn=True, severity="minor", key=f"p{n}",
                              code="DRAWING_NOT_COMPARABLE",
                              message=f"Photo {n + 1} shows drawing {sheet}, but too much of it differs to list single changes.",
                              fix="Upload a straight, sharp, uncropped picture of the sheet."))
            continue
        if not ref["changes"]:
            items.append(item(f"Photo {n + 1}", f"Photo {n + 1} matches drawing {sheet}", "Same as drawing",
                              "Same as drawing", True, key=f"p{n}"))
            continue
        for k, ch in enumerate(ref["changes"], 1):
            was, now = ch.get("drawing_text", ""), ch.get("image_text", "")
            if ch["kind"] == "removed":
                found, what = "Missing", f"{_quote(was)} from the drawing is missing" if was else "Part of the drawing is missing"
                fix = f"Add back {_quote(was)} as shown on drawing {sheet}." if was else f"Restore this part as shown on drawing {sheet}."
            elif ch["kind"] == "added":
                found, what = (now or "Extra marks"), (f"{_quote(now)} is not in the drawing" if now else "Extra marks not in the drawing")
                fix = f"Remove {_quote(now) if now else 'it'}, or update drawing {sheet} if it is meant to be there."
            else:
                found, what = (now or "Different"), (f"{_quote(was)} differs from the drawing" if was else "This area differs from the drawing")
                fix = (f"Change {_quote(now)} back to {_quote(was)} as on drawing {sheet}." if was and now
                       else f"Make this area match drawing {sheet}.")
            items.append(item(f"Photo {n + 1} #{k}", what, was or "As drawing", found, False,
                              severity="major", code="DRAWING_DIFFERENCE", key=f"p{n}:{k}",
                              message=f"Difference {k} on photo {n + 1} vs drawing {sheet}: {ch['kind']}"
                                      + (f" (drawing: {_quote(was)}, photo: {_quote(now)})" if was or now else "") + ".",
                              bbox=ch["bbox"], photo=n, fix=fix))
    return items
