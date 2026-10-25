"""Writes app/data/topology/13SP04331.json: the electrical connections that are DRAWN on
the schematic sheets of cabinet 13SP04331 (document AO-400-13-S463-000056 rev 03 ASF):

    sheet 10  24VDC POWER DISTRIBUTION - 1   AC feeds UPSA / UPSB / NORMAL, PS11, PS21
    sheet 11  24VDC POWER DISTRIBUTION - 2   D11 / D21, CB41/42/51/52, X41 / X51, alarm, smoke detector
    sheet 12  24VDC POWER DISTRIBUTION - 3   X42 / X52 -> modules 13MFW04331 ... 13MFW04371

It was read from the drawing images by a person (not by software), so it must be checked by
an engineer. Only connections visible on those sheets are listed; everything the sheets do not
show is written to "unknown" - nothing is guessed. Run:  python scripts/build_topology_13sp04331.py
"""
import json
from pathlib import Path

nodes: dict[str, dict] = {}
edges: list[dict] = []


def node(id_, kind, function, circuit, subsystem, sheet, **extra):
    nodes[id_] = {"kind": kind, "function": function, "circuit": circuit, "subsystem": subsystem, "sheet": sheet, **extra}


def edge(a, b, sheet, type_="power", via=None):
    e = {"from": a, "to": b, "type": type_, "sheet": sheet}
    if via:
        e["via"] = via
    edges.append(e)


AC, PSU, DIST, MON, FIRE = ("AC input and protection", "24 VDC power supply", "24 VDC distribution",
                            "Monitoring and alarm", "Fire detection")

# ---- sheet 10: the three AC feeds ---------------------------------------------------------
for side, (n, (ext, pdp, cable, term, iso, term2, loadname)) in {
        "A": ("1", ("EXT-UPSA", "13DC04331", "C-13SP04331-01", "XP1", "DS1", "XP11", "UPSA")),
        "B": ("2", ("EXT-UPSB", "13DC04332", "C-13SP04331-03", "XS1", "DS2", "XS21", "UPSB"))}.items():
    c = f"AC feed {side} ({loadname})"
    node(ext, "source", f"AC supply {loadname} from PDP cabinet {pdp} (cable {cable})", c, AC, "10", external=True)
    node(term, "terminal", f"Incoming terminal block {loadname}", c, AC, "10")
    node(iso, "isolator", "Isolator 40 A", c, AC, "10")
    node(term2, "terminal", f"Terminal block after isolator ({loadname})", c, AC, "10")
    node(f"CB{n}1", "breaker", "Circuit breaker 16 A type C - feeds the 24 VDC power supply", c, AC, "10")
    node(f"CB{n}2", "breaker", "Circuit breaker 6 A type C - feeds the fan / filter / light-switch terminal", c, AC, "10")
    node(f"CB{n}3", "breaker", "Circuit breaker 6 A type C - feeds the cabinet light", c, AC, "10")
    node(f"CB{n}4", "spare", "Circuit breaker 6 A type C - SPARE (drawing: do not connect additional load)", c, AC, "10")
    node(f"SPD{n}", "surge", "Surge protection device (L, N, PE)", c, AC, "10")
    node(f"PS{n}1", "power_supply", "Power supply 40 A, 100-240 VAC in, 24 VDC out", c, PSU, "10")
    node(f"X-FSW{n}", "terminal", "Terminal block to FSW / CF", c, AC, "10")
    node(f"FSW{n}", "load", "FSW (load on the 6 A breaker)", c, AC, "10")
    node(f"CF{n}", "load", "CF (load on the 6 A breaker)", c, AC, "10")
    node(f"CL{n}", "load", "Cabinet light CL", c, AC, "10")
    edge(ext, term, "10"); edge(term, iso, "10"); edge(iso, term2, "10")
    for cb in (f"CB{n}1", f"CB{n}2", f"CB{n}3", f"CB{n}4", f"SPD{n}"):
        edge(term2, cb, "10")
    edge(f"CB{n}1", f"PS{n}1", "10")
    edge(f"CB{n}2", f"X-FSW{n}", "10"); edge(f"X-FSW{n}", f"FSW{n}", "10"); edge(f"X-FSW{n}", f"CF{n}", "10")
    edge(f"CB{n}3", f"CL{n}", "10")

c = "AC normal (socket)"
node("EXT-NORMAL", "source", "AC supply NORMAL from PDP cabinet 13DC04331 (cable C-13SP04331-02)", c, AC, "10", external=True)
node("XU1", "terminal", "Incoming terminal block NORMAL", c, AC, "10")
node("DS3", "isolator", "Isolator 40 A", c, AC, "10")
node("RCCB1", "breaker", "Residual-current breaker 25 A type C", c, AC, "10")
node("REC1", "load", "Socket outlet 13 A", c, AC, "10")
edge("EXT-NORMAL", "XU1", "10"); edge("XU1", "DS3", "10"); edge("DS3", "RCCB1", "10"); edge("RCCB1", "REC1", "10")

# ---- sheet 11: DC distribution -------------------------------------------------------------
LOADS = [("F1", "13PK04331"), ("F2", "13PK04332"), ("F3", "13EIOC04331"), ("F4", "13EIOC04332"),
         ("F5", "4 WIDE CARRIER"), ("F6", "13PK04333"), ("F7", "13EIOC04333")]
for side, n, ps, d, cbs in (("A", "1", "PS11", "D11", ("CB41", "CB42")), ("B", "2", "PS21", "D21", ("CB51", "CB52"))):
    c = f"24 VDC feed {side}"
    xa, xb = ("X41", "X42") if side == "A" else ("X51", "X52")
    node(d, "diode_module", "Redundancy / decoupling module 80 A, 12-28 V (In1 wired, In2 not wired on the drawing)", c, DIST, "11")
    node(cbs[0], "breaker", "Circuit breaker 25 A type C - feeds the fuse terminal for the PK / EIOC loads", c, DIST, "11")
    node(cbs[1], "breaker", "Circuit breaker 25 A type C - feeds the fuse terminal for the MFW modules (sheet 12)", c, DIST, "11")
    node(xa, "fuse_terminal", "Fuse terminal block, 4 A fuses (PK / EIOC loads)", c, DIST, "11")
    node(xb, "fuse_terminal", "Fuse terminal block, 1 A fuses (13MFW modules)", c, DIST, "12")
    edge(ps, d, "10/11"); edge(d, cbs[0], "11"); edge(d, cbs[1], "11")
    edge(cbs[0], xa, "11"); edge(cbs[1], xb, "11/12")

c = "Dual-fed loads"
for fuse, name in LOADS:
    node(name, "load", f"{name}: fed by X41 (primary, fuse {fuse}) and X51 (secondary, fuse {fuse})", c, DIST, "11",
         external=True, dual_fed=True)
    edge("X41", name, "11", via=f"X41-{fuse} (PRI)")
    edge("X51", name, "11", via=f"X51-{fuse} (SEC)")

# ---- sheet 12: 13MFW modules (each module has two supply inputs: 1A/1B from X42, 3A/3B from X52) ----
first = [(f"F{i}", f"13MFW0{4330 + i}") for i in range(1, 24)]
second = {24: 4354, 25: 4355, 26: 4356, 28: 4358, 29: 4359, 30: 4360, 31: 4361, 32: 4362, 33: 4363,
          34: 4364, 36: 4366, 37: 4367, 38: 4370, 39: 4371}              # F27, F35, F40-F45 are SPARE on the drawing
modules = first + [(f"F{f}", f"13MFW0{n}") for f, n in second.items()]
for fuse, name in modules:
    node(name, "load", f"Module {name}: supply 1A/1B from X42-{fuse}, 3A/3B from X52-{fuse}", c, DIST, "12",
         group="13MFW modules", dual_fed=True)
    edge("X42", name, "12", via=f"X42-{fuse} (1 A)")
    edge("X52", name, "12", via=f"X52-{fuse} (1 A)")

# ---- sheet 11: alarm circuit (monitoring contacts, no power) -------------------------------
c = "Alarm circuit"
node("X-ALM", "monitor", "Alarm terminal block to the control system (tag 13XA-05330, channel CH09)", c, MON, "11")
node("TS1", "monitor", "Thermostat, set to 35 degC", c, MON, "11")
node("ALM-FSW1", "monitor", "Alarm terminal block FSW1", c, MON, "11")
node("ALM-FSW2", "monitor", "Alarm terminal block FSW2", c, MON, "11")
for src in ("PS11", "PS21", "D11", "D21", "TS1", "ALM-FSW1", "ALM-FSW2"):
    edge(src, "X-ALM", "11", "monitor")
edge("FSW1", "ALM-FSW1", "11", "monitor"); edge("FSW2", "ALM-FSW2", "11", "monitor")

# ---- sheet 11: smoke detector wiring ------------------------------------------------------
c = "Smoke detector wiring"
node("SDTB1", "terminal", "Smoke detector terminal block 1 (1.5 mm2 black / white)", c, FIRE, "11", safety="candidate")
node("SDTB2", "terminal", "Smoke detector terminal block 2 (1.5 mm2 black / white)", c, FIRE, "11", safety="candidate")
node("13RDEW-40A949H", "load", "Smoke detector (wiring by others)", c, FIRE, "11", safety="candidate", external=True)
edge("SDTB1", "13RDEW-40A949H", "11", "signal"); edge("SDTB2", "13RDEW-40A949H", "11", "signal")

unknown = [
    {"about": "Supply of the smoke detector 13RDEW-40A949H",
     "reason": "Sheet 11 draws the detector terminals SDTB1 / SDTB2 and its wires, but not where its power or "
               "loop supply comes from.", "needed": "Fire detection loop drawing (HSSD wiring 13RDEW-40A949HI)"},
    {"about": "Whether the smoke detector circuit is a safety-related function",
     "reason": "The project acceptance criteria that name safety-related circuits were not provided.",
     "needed": "Approved project acceptance criteria / safety function list"},
    {"about": "Alarm contacts of PS11, PS21, D11, D21",
     "reason": "The contacts are drawn in the alarm circuit but are not separate parts with tags; what the alarm "
               "does when the device itself is missing is not documented.", "needed": "Alarm / loop check specification"},
    {"about": "Upstream supplies EXT-UPSA, EXT-UPSB, EXT-NORMAL and the loads in other cabinets",
     "reason": "They are in cabinets 13DC04331, 13DC04332 and in the cabinets named on sheet 11; their own "
               "protection and behaviour are not part of this drawing.", "needed": "Drawings of those cabinets"},
    {"about": "Wire numbers and terminal numbers of the power wiring",
     "reason": "The sheets give cable names and cross-sections (for example 6 mm2 BK), not numbered wires.",
     "needed": "Wire list / cable schedule"},
    {"about": "Ratings of X41 / X51 fuses F8-F10 and of the spare terminals",
     "reason": "Drawn as SPARE without connected loads.", "needed": "-"},
]

out = Path(__file__).resolve().parents[1] / "app" / "data" / "topology" / "13SP04331.json"
out.parent.mkdir(parents=True, exist_ok=True)
doc = {
    "cabinet": "13SP04331",
    "title": "PCS System Cabinet",
    "document": "AO-400-13-S463-000056 rev 03 (ASF 10-AUG-2026), sheets 10, 11, 12",
    "provenance": "Read from the drawing images by a person. NOT verified by an engineer. Only drawn connections are "
                  "listed; what the drawings do not show is in 'unknown'.",
    "geometry": {
        "width_mm": 810, "depth_mm": 810, "height_mm": 2000, "plinth_mm": 100,
        "source": "AO-400-13-S463-000056 rev 03, sheet 5 (cabinet outline dimensions)",
        "note": "All dimensions in mm (+/- 5) per the drawing. Width and depth read from the 810 dimensions of the "
                "front and side views; height 2000 plus a 100 mm plinth. Read by a person, not verified.",
    },
    "nodes": nodes, "edges": edges, "unknown": unknown,
}
out.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"{out}: {len(nodes)} nodes, {len(edges)} edges, {len(unknown)} unknown items")
