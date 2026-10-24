"""Wire colour check (the brief's stretch "wiring check"): the wire next to every ferrule
that was found must have the colour the wire list asks for.

How: the wire leaves the ferrule sleeve along its long side, so a strip of pixels just
beyond both ends of the sleeve is classified into wire colours (HSV). Only a CLEAR reading
counts - a dominant real colour covering most of the strip. Grey / white (usually the
mounting plate, not a wire) or a mixed strip is "unclear" and never reported as a fault.

Runs only when the wire list has a Colour column and the photos are available.
Wiring connectivity (where the wire goes) is NOT verified by this check.
"""
import cv2
import numpy as np

from app.checks.base import CheckContext, item, register

# wire list spellings -> colour
_NAMES = {
    "black": "black", "bk": "black", "blk": "black",
    "brown": "brown", "bn": "brown", "brn": "brown",
    "red": "red", "rd": "red",
    "orange": "orange", "or": "orange", "og": "orange",
    "yellow": "yellow", "ye": "yellow", "yel": "yellow",
    "green": "green", "gn": "green", "grn": "green",
    "blue": "blue", "bu": "blue", "blu": "blue", "dark blue": "blue", "light blue": "blue",
    "violet": "violet", "vt": "violet", "purple": "violet",
    "grey": "grey", "gray": "grey", "gy": "grey",
    "white": "white", "wh": "white", "wht": "white",
    "green yellow": "green_yellow", "gn ye": "green_yellow", "gnye": "green_yellow", "green/yellow": "green_yellow",
    "yellow green": "green_yellow", "pe": "green_yellow", "earth": "green_yellow",
}
CLEAR_SHARE = 0.45          # the dominant colour must cover at least this share of the strip


def expected_colour(text: str | None) -> str | None:
    t = (text or "").strip().lower().replace("-", " ").replace("_", " ")
    t = " ".join(t.split())
    return _NAMES.get(t) or _NAMES.get(t.replace(" ", ""))


def classify(pixels_bgr: np.ndarray) -> dict[str, int]:
    """Count pixels per wire colour."""
    if pixels_bgr.size == 0:
        return {}
    hsv = cv2.cvtColor(pixels_bgr.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2HSV).reshape(-1, 3)
    h, s, v = hsv[:, 0].astype(int), hsv[:, 1].astype(int), hsv[:, 2].astype(int)
    names = np.full(len(h), "", dtype=object)
    names[v < 60] = "black"
    rest = v >= 60
    low_sat = rest & (s < 50)
    names[low_sat & (v > 170)] = "white"
    names[low_sat & (v <= 170)] = "grey"
    col = rest & (s >= 50)
    names[col & ((h < 8) | (h >= 170))] = "red"
    names[col & (h >= 8) & (h < 22) & (v < 165)] = "brown"
    names[col & (h >= 8) & (h < 22) & (v >= 165)] = "orange"
    names[col & (h >= 22) & (h < 35)] = "yellow"
    names[col & (h >= 35) & (h < 85)] = "green"
    names[col & (h >= 85) & (h < 130)] = "blue"
    names[col & (h >= 130) & (h < 170)] = "violet"
    out: dict[str, int] = {}
    for n in names:
        out[n] = out.get(n, 0) + 1
    return out


def read_colour(counts: dict[str, int]) -> str | None:
    """The clearly dominant wire colour, or None when unclear."""
    total = sum(counts.values())
    if total < 20:
        return None
    green, yellow = counts.get("green", 0), counts.get("yellow", 0)
    if green / total > 0.2 and yellow / total > 0.2:            # striped earth conductor
        return "green_yellow"
    name, n = max(counts.items(), key=lambda kv: kv[1])
    return name if n / total >= CLEAR_SHARE else None


def wire_strips(image: np.ndarray, box) -> np.ndarray:
    """Pixels just beyond both ends of the ferrule sleeve, along its long side."""
    H, W = image.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in box]
    w, h = x2 - x1, y2 - y1
    parts = []
    if w >= h:      # horizontal sleeve -> wire runs left / right
        L, band = max(8, int(h * 0.9)), max(2, int(h * 0.18))
        cy = (y1 + y2) // 2
        for a, b in ((x1 - L, x1 - 3), (x2 + 3, x2 + L)):
            parts.append(image[max(0, cy - band):min(H, cy + band), max(0, a):min(W, b)])
    else:           # vertical sleeve -> wire runs up / down
        L, band = max(8, int(w * 0.9)), max(2, int(w * 0.18))
        cx = (x1 + x2) // 2
        for a, b in ((y1 - L, y1 - 3), (y2 + 3, y2 + L)):
            parts.append(image[max(0, a):min(H, b), max(0, cx - band):min(W, cx + band)])
    parts = [p.reshape(-1, 3) for p in parts if p.size]
    return np.concatenate(parts) if parts else np.empty((0, 3), np.uint8)


@register("wire_colour", "Wire colour check", order=40)
def run(ctx: CheckContext) -> list[dict]:
    images = ctx.images or []
    wires = ctx.expected_wiring.get("wires", [])
    if not images or not any(w.get("color") for w in wires):
        return []                     # no photos at hand or no Colour column: check not run
    items = []
    for w_check in ctx.core.get("wire_labels", []):
        label = w_check["label"]
        if w_check["status"] != "ok" or not w_check.get("bbox"):
            continue                  # ferrule not found: the ferrule check already reports it
        rows = [w for w in wires if w.get("wire_no") == label and w.get("color")]
        want = expected_colour(rows[0]["color"]) if rows else None
        if not want:
            continue
        photo = w_check.get("photo") or 0
        if photo >= len(images):
            continue
        sleeve = ctx.device_box(w_check["bbox"], photo)
        got = read_colour(classify(wire_strips(images[photo], sleeve)))
        if got is None or (got in ("grey", "white") and want not in ("grey", "white")):
            continue                  # unclear (or just the mounting plate): never guess
        nice = lambda c: c.replace("_", "-")
        route = f"{rows[0].get('from', '')} -> {rows[0].get('to', '')}".strip(" ->")
        items.append(item(label, f"Wire {label}" + (f" ({route})" if route else "") + f" is {nice(want)}",
                          nice(want), nice(got), got == want, severity="major", code="WIRE_COLOUR_MISMATCH",
                          message=f"Wire {label} should be {nice(want)} according to the wire list, "
                                  f"but the wire at its ferrule looks {nice(got)}.",
                          fix=f"Check wire {label}" + (f" ({route})" if route else "")
                              + f": replace it with a {nice(want)} wire if it is really {nice(got)}.",
                          bbox=sleeve, photo=photo))
    return items
