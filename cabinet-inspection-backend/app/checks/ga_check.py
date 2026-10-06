"""GA check: every part of the drawing is present, of the right kind, and in the right order."""
from statistics import median

from app.checks.base import CheckContext, estimate_gap, item, register
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
    in the same left-to-right order as the drawing lists them."""
    rows = _rows(located)
    moved: list[dict] = []
    for row in rows:
        for prefix in {d["prefix"] for d in row}:
            family = [d for d in row if d["prefix"] == prefix]
            moved += [family[i] for i in _out_of_order([d["index"] for d in family])]

    expected = " - ".join(d["tag"] for d in sorted(located, key=lambda d: d["index"]))
    found = " - ".join(d["tag"] for row in rows for d in row)
    box = None
    if moved:
        box = [min(d["box"][0] for d in moved), min(d["box"][1] for d in moved),
               max(d["box"][2] for d in moved), max(d["box"][3] for d in moved)]
    tags = ", ".join(sorted(d["tag"] for d in moved))
    return item("Device order", "Devices are in the order of the drawing", expected or "-", found or "-",
                not moved, severity="major", code="COMPONENT_ORDER", bbox=box, key="order",
                message=f"{tags} {'is' if len(moved) == 1 else 'are'} not in the order shown in the drawing.")


@register("ga", "GA check", order=10)
def run(ctx: CheckContext) -> list[dict]:
    checks = ctx.core.get("components", [])
    boxes = [(c["tag"], ctx.device_box(c.get("bbox"))) for c in checks]
    items: list[dict] = []
    located: list[dict] = []

    for index, c in enumerate(checks):
        tag, status, box = c["tag"], c["status"], boxes[index][1]
        what = f"{_nice(c['type']).capitalize()} {tag} is installed"
        if status in _PRESENT:
            items.append(item(tag, what, "Present", "Present", True, bbox=box))
        elif status == "type_mismatch":
            d = ctx.defect("COMPONENT_TYPE_MISMATCH", tag) or {}
            items.append(item(tag, what, _nice(c["type"]), _nice(c.get("detected_type")), False,
                              severity="critical", code="COMPONENT_TYPE_MISMATCH",
                              message=d.get("message", f"{tag} is the wrong kind of device."), bbox=box))
        else:
            d = ctx.defect("COMPONENT_MISSING", tag) or {}
            items.append(item(tag, what, "Present", "Missing", False, severity="critical",
                              code="COMPONENT_MISSING", message=d.get("message", f"{tag} was not found."),
                              bbox=estimate_gap(boxes, index, ctx.image_size), estimated=True))
        if box and status != "missing":
            located.append({"tag": tag, "index": index, "prefix": tag_prefix(tag), "box": box,
                            "cx": (box[0] + box[2]) / 2, "cy": (box[1] + box[3]) / 2})

    # quantity problems the detector reports per device type (trained model only)
    for d in ctx.core.get("defects", []):
        if d["code"] in ("COMPONENT_COUNT_SHORT", "EXTRA_COMPONENT"):
            items.append(item(_nice(d["item"]), f"Number of {_nice(d['item'])}s", d["expected"], d["actual"], False,
                              severity=d["severity"], code=d["code"], message=d["message"],
                              key=f"count:{d['item']}"))

    if len(located) > 1:
        items.append(_order_item(located))
    return items
