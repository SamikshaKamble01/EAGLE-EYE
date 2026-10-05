"""Text helpers shared by the PDF, Excel, OCR and rule-engine services."""
import re

# Characters OCR commonly confuses. Used only for "is this probably the same
# label?" comparisons, never to rewrite what was actually read.
_OCR_FOLD = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1",
                           "|": "1", "S": "5", "B": "8", "Z": "2", "G": "6"})


def normalize_label(text) -> str:
    """'  -k1 ' -> 'K1' ;  'x1 : 3' -> 'X1:3'"""
    if text is None:
        return ""
    s = str(text).strip().upper()
    s = re.sub(r"\s+", "", s)
    s = s.lstrip("-=+")                      # IEC 81346 prefixes
    s = s.strip(".,;'\"()[]{}")
    if s.endswith(".0") and s[:-2].isdigit():  # Excel turns 101 into 101.0
        s = s[:-2]
    return s


def ocr_fold(label: str) -> str:
    """Make OCR-confusable characters equal: 'KI' and 'K1' fold to the same thing.
    The first character is kept so a tag prefix (e.g. 'S' or 'B') survives."""
    if not label:
        return label
    return label[0] + label[1:].translate(_OCR_FOLD)


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def tag_prefix(label: str) -> str:
    m = re.match(r"[A-Z]+", label or "")
    return m.group(0) if m else ""


# --------------------------------------------------------------------------- #
# Component type vocabulary
# --------------------------------------------------------------------------- #
# canonical type -> keywords that identify it in a PDF description / model class
COMPONENT_KEYWORDS: dict[str, list[str]] = {
    "overload_relay": ["overload relay", "overload", "olr", "thermal relay"],
    "circuit_breaker": ["circuit breaker", "mcb", "mccb", "breaker", "rccb", "rcbo", "elcb", "isolator"],
    "contactor": ["contactor"],
    "relay": ["relay", "interface relay", "control relay"],
    "fuse": ["fuse"],
    "terminal_block": ["terminal block", "terminal", "tb "],
    "power_supply": ["power supply", "psu", "smps"],
    "plc": ["plc", "controller", "cpu module", "io module", "i/o module"],
    "vfd": ["vfd", "variable frequency drive", "inverter", "drive"],
    "timer": ["timer"],
    "transformer": ["transformer"],
    "push_button": ["push button", "pushbutton", "button", "emergency stop", "e-stop"],
    "indicator_lamp": ["indicator", "pilot lamp", "pilot light", "lamp", "led"],
    "energy_meter": ["energy meter", "meter", "ammeter", "voltmeter"],
    "surge_protector": ["surge", "spd"],
}

# IEC 81346 letter codes -> most likely type (used when no description exists)
TAG_PREFIX_TYPES: dict[str, str] = {
    "K": "contactor", "KA": "relay", "KM": "contactor", "KT": "timer",
    "Q": "circuit_breaker", "QF": "circuit_breaker", "F": "fuse", "FU": "fuse",
    "FR": "overload_relay", "X": "terminal_block", "XT": "terminal_block",
    "G": "power_supply", "GS": "power_supply", "T": "transformer",
    "A": "plc", "U": "vfd", "S": "push_button", "SB": "push_button",
    "H": "indicator_lamp", "HL": "indicator_lamp", "P": "energy_meter",
}


def canonical_type(text: str | None, tag: str | None = None) -> str:
    """Map a free text description / model class name to a canonical type."""
    if text:
        t = " " + str(text).lower().replace("_", " ") + " "
        for ctype, words in COMPONENT_KEYWORDS.items():
            if any(w in t for w in words):
                return ctype
    if tag:
        prefix = tag_prefix(normalize_label(tag))
        if prefix in TAG_PREFIX_TYPES:
            return TAG_PREFIX_TYPES[prefix]
        if prefix[:1] in TAG_PREFIX_TYPES:
            return TAG_PREFIX_TYPES[prefix[:1]]
    return "unknown"
