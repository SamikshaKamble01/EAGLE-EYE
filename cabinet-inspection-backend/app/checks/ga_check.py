"""GA check: every part of the drawing is present, of the right kind, and in the right order."""
from statistics import median

from app.checks.base import CheckContext, estimate_gap, item, neighbours, place, register
from app.utils.text import tag_prefix

_PRESENT = {"ok", "label_mismatch", "label_missing"}


def _nice(ctype: str) -> str:
    return (ctype or "unknown").replace("_", " ")


def _rows(located: list[dict]) -> list[list[dict]]:
    """Group devices into rows of the cabinet (top to bottom), each left to right."""
    if not located:
        return []
    height = median(d["box"][3] - d["box"][1] for d in located)
    rows: list[list[dict]] = []
    for d in sorted(located, key=lambda d: d["cy"]):
        if rows and d["cy"] - sum(x["cy"] for x in rows[-1]) / len(rows[-1]) < 0.6 * height:
            rows[-1].append(d)
        else:
            rows.append([d])
    return [sorted(r, key=lambda d: d["cx"]) for r in rows]


def _out_of_order(sequence: list[int]) -> set[int]:
    """Positions that are NOT part of the longest increasing run = the moved ones."""
    n = len(sequence)
    best, link = [1] * n, [-1] * n
    for i in range(n):
        for j in range(i):
            if sequence[j] < sequence[i] and best[j] + 1 > best[i]:
                best[i], link[i] = best[j] + 1, j
    keep, i = set(), max(range(n), key=best.__getitem__) if n else -1
    while i >= 0:
        keep.add(i)
        i = link[i]
    return set(range(n)) - keep


def _order_item(located: list[dict]) -> dict:
    """Devices of one family (same letters: K1, K2, K3 ...) must appear in the photo
    in the same left-to-right order as the drawing lists them (row by row, photo by photo)."""
    rows = [row for photo in sorted({d["photo"] for d in located})
            for row in _rows([d for d in located if d["photo"] == photo])]
    moved: list[dict] = []
    for row in rows:
        for prefix in {d["prefix"] for d in row}:
            family = [d for d in row if d["prefix"] == prefix]
            moved += [family[i] for i in _out_of_order([d["index"] for d in family])]

    expected = " - ".join(d["tag"] for d in sorted(located, key=lambda d: d["index"]))
    found = " - ".join(d["tag"] for row in rows for d in row)
    box, photo = None, None
    if moved:
        photo = moved[0]["photo"]
        same = [d for d in moved if d["photo"] == photo]
        box = [min(d["box"][0] for d in same), min(d["box"][1] for d in same),
               max(d["box"][2] for d in same), max(d["box"][3] for d in same)]
    tags = ", ".join(sorted(d["tag"] for d in moved))
    return item("Device order", "Devices are in the order of the drawing", expected or "-", found or "-",
                not moved, severity="major", code="COMPONENT_ORDER", bbox=box, photo=photo, key="order",
                message=f"{tags} {'is' if len(moved) == 1 else 'are'} not in the order shown in the drawing.",
                fix=f"Move {tags} so the devices read {expected} from left to right.")


@register("ga", "GA check", order=10)
def run(ctx: CheckContext) -> list[dict]:
    checks = ctx.core.get("components", [])
    boxes = [(c["tag"], ctx.device_box(c.get("bbox"), c.get("photo")), c.get("photo") or 0) for c in checks]
    items: list[dict] = []
    located: list[dict] = []
    tags = [c["tag"] for c in checks]
    present = {c["tag"] for c in checks if c["status"] != "missing"}

    for index, c in enumerate(checks):
        tag, status, box, photo = c["tag"], c["status"], boxes[index][1], boxes[index][2]
        what = f"{_nice(c['type']).capitalize()} {tag} is installed"
        part = f"{_nice(c['type'])} {tag}" + (f" ({c['description']})" if c.get("description") else "")
        if status in _PRESENT:
            items.append(item(tag, what, "Present", "Present", True, bbox=box, photo=photo))
        elif status == "type_mismatch":
            d = ctx.defect("COMPONENT_TYPE_MISMATCH", tag) or {}
            items.append(item(tag, what, _nice(c["type"]), _nice(c.get("detected_type")), False,
                              severity="critical", code="COMPONENT_TYPE_MISMATCH",
                              message=d.get("message", f"{tag} is the wrong kind of device."), bbox=box, photo=photo,
                              fix=f"Replace the {_nice(c.get('detected_type'))} at this position with the {part}."))
        else:
            d = ctx.defect("COMPONENT_MISSING", tag) or {}
            where = place(*neighbours(tags, index, present))
            gap, gap_photo = estimate_gap(boxes, index, ctx.image_size)
            items.append(item(tag, what, "Present", "Missing", False, severity="critical",
                              code="COMPONENT_MISSING", message=d.get("message", f"{tag} was not found."),
                              bbox=gap, photo=gap_photo, estimated=True,
                              fix=f"Install the {part}" + (f" {where}" if where else "")
                                  + f" and label it {tag}. If it is already there, make its label visible."))
        if box and status != "missing":
            located.append({"tag": tag, "index": index, "prefix": tag_prefix(tag), "box": box, "photo": photo,
                            "cx": (box[0] + box[2]) / 2, "cy": (box[1] + box[3]) / 2})

    # quantity problems the detector reports per device type (trained model only)
    for d in ctx.core.get("defects", []):
        if d["code"] in ("COMPONENT_COUNT_SHORT", "EXTRA_COMPONENT"):
            items.append(item(_nice(d["item"]), f"Number of {_nice(d['item'])}s", d["expected"], d["actual"], False,
                              severity=d["severity"], code=d["code"], message=d["message"],
                              key=f"count:{d['item']}",
                              fix=(f"Install the missing {_nice(d['item'])}(s): the drawing needs {d['expected']}."
                                   if d["code"] == "COMPONENT_COUNT_SHORT" else
                                   f"Remove the surplus {_nice(d['item'])}(s): the drawing lists only {d['expected']}.")))

    # The order rule needs the drawing's left-to-right order. A parts table gives it; tags
    # collected from nameplate / layout pages of a drawing set do not (they are sorted by
    # name, and PS11, PS21, PS12 ... may well sit side by side), so it is skipped there.
    from_drawing_set = any(str(c.get("source", "")).startswith(("nameplate", "layout"))
                           for c in ctx.expected_components)
    if len(located) > 1 and not from_drawing_set:
        items.append(_order_item(located))
    return items
