"""Fault-impact (root-cause) analysis for an inspected cabinet.

Inputs: the inspection result (what was found, per expected component), the cabinet's DOCUMENTED
topology (app/data/topology/<cabinet>.json), optional inspector observations and a policy.

What it does
  1. Gives every expected component a component status and a SEPARATE label status.
  2. For each missing / wrongly installed component follows the documented connections:
     missing component -> circuit -> dependent parts -> subsystem -> cabinet.
     A part counts as LOST only when no documented alternative supply path is left;
     a part that still has a second documented feed is only DEGRADED (redundancy lost).
  3. Treats label defects as identification defects, never as an open circuit.
  4. Reports separate statuses (component, circuit, subsystem, cabinet function, identification,
     safety review) and an overall disposition from the policy.

What it never does: invent connections, ratings or wire numbers; call parts defective only
because they are downstream; assume a part that is not in the pictures is missing; declare
wiring correct or the cabinet electrically safe (nothing here is measured).

The acceptance rules in DEFAULT_POLICY are defaults, NOT an approved project policy.
"""
from collections import defaultdict, deque

POWER_EDGES = ("power", "signal")                      # edge types a fault can travel along

DEFAULT_POLICY = {
    "approved": False,                      # nobody approved these rules - the report says so
    "photo_evidence_sufficient": True,      # "not found in a photo that covers the place" counts as missing
    "missing_component": "FAIL",            # FAIL | HOLD - a required part of the approved drawing is missing
    "unverified_components": "HOLD",        # FAIL | HOLD | IGNORE - parts that could not be checked
    "documentation_defects_allowed": True,  # label / identification defects alone: PASS WITH DOCUMENTATION DEFECTS
    "protective_label_defect": "HOLD",      # missing / wrong label on a protective device -> engineering review
    "severity": {"supply_lost": "critical", "redundancy_lost": "major", "local": "major",
                 "spare": "minor", "unknown_impact": "major", "safety": "critical"},
    "safety_nodes": [],                     # tags the project names as safety related (besides drawing flags)
}

DISPOSITIONS = {
    "PASS": "PASS",
    "PASS_WITH_DOCUMENTATION_DEFECTS": "PASS WITH DOCUMENTATION DEFECTS",
    "FAIL": "FAIL",
    "HOLD_FOR_ENGINEERING_REVIEW": "HOLD FOR ENGINEERING REVIEW",
}
STATE_RANK = ["fault", "lost", "uncertain", "degraded", "documentation", "unverified", "ok", "not_inspected"]
PROTECTIVE_KINDS = {"breaker", "isolator", "surge", "spare", "fuse_terminal"}
PROTECTIVE_PREFIXES = {"CB", "Q", "QF", "RCCB", "MCB", "DS", "SPD", "F", "FU", "FSW"}


# --------------------------------------------------------------------------- #
# the documented graph
# --------------------------------------------------------------------------- #
class Graph:
    def __init__(self, topology: dict | None):
        self.nodes = dict((topology or {}).get("nodes", {}))
        self.edges = list((topology or {}).get("edges", []))
        self.succ, self.pred = defaultdict(list), defaultdict(list)
        for e in self.edges:
            if e["type"] in POWER_EDGES:
                self.succ[e["from"]].append(e)
                self.pred[e["to"]].append(e)
        self.sources = {n for n, v in self.nodes.items() if v.get("kind") == "source"}

    def __bool__(self):
        return bool(self.nodes)

    def reach(self, failed=frozenset()) -> set[str]:
        """Nodes that still receive supply from some documented source when `failed` parts are gone."""
        seen = {s for s in self.sources if s not in failed}
        queue = deque(seen)
        while queue:
            n = queue.popleft()
            for e in self.succ[n]:
                if e["to"] not in seen and e["to"] not in failed:
                    seen.add(e["to"])
                    queue.append(e["to"])
        return seen

    def downstream(self, start) -> set[str]:
        seen, queue = set(), deque([start])
        while queue:
            for e in self.succ[queue.popleft()]:
                if e["to"] not in seen:
                    seen.add(e["to"])
                    queue.append(e["to"])
        return seen

    def effects(self, failed: set[str], unknown: set[str] = frozenset()) -> dict:
        """What the loss of `failed` parts does, using only documented connections."""
        failed = {f for f in failed if f in self.nodes}
        base = self.reach()
        now = self.reach(failed)
        lost = base - now - failed
        degraded = set()
        for n in now:
            before = [e for e in self.pred[n] if e["from"] in base]
            after = [e for e in self.pred[n] if e["from"] in now]
            if len(before) >= 2 and len(after) < len(before):
                degraded.add(n)
        unverified_dependence = (now - self.reach(failed | {u for u in unknown if u in self.nodes})) - failed
        # downstream of a failed part but without any documented supply source: connection incomplete
        no_source = set()
        for f in failed:
            no_source |= {n for n in self.downstream(f) if n not in base}
        return {"lost": lost, "degraded": degraded, "uncertain": (unverified_dependence | no_source) - lost,
                "base": base, "now": now}

    def remaining_feeds(self, node: str, now: set[str]) -> list[str]:
        return [e["from"] for e in self.pred[node] if e["from"] in now]


# --------------------------------------------------------------------------- #
# component and label status
# --------------------------------------------------------------------------- #
def _label_function(tag: str, kind: str | None) -> str:
    prefix = "".join(ch for ch in tag if ch.isalpha())
    if kind in PROTECTIVE_KINDS or (not kind and prefix in PROTECTIVE_PREFIXES):
        return "protective-device identification"
    if kind in ("terminal",) or (not kind and prefix.startswith("X")):
        return "terminal identification"
    return "component identification"


def _component_records(result, graph, observations, policy):
    expected = {c["tag"]: c for c in (result.get("expected") or {}).get("components", []) if c.get("tag")}
    unseen = {r.get("item") for r in result.get("checklist", []) if r.get("code") == "NOT_PHOTOGRAPHED"}
    records = []
    for c in result.get("components", []):
        tag = c["tag"]
        node = graph.nodes.get(tag)
        status = c.get("status")
        obs = observations.get(tag, {})
        by_inspector = bool(obs.get("component") in ("present", "missing"))
        evidence, confidence = "", "medium"

        if status == "ok":
            comp, label = "PRESENT", "OK"
            evidence = f"label '{c.get('read_as') or tag}' read in photo {(c.get('photo') or 0) + 1}"
            if c.get("matched_by") == "drawing":
                evidence, confidence = "matches the drawing sheet shown in the picture", "high"
        elif status == "label_missing":
            comp, label = "PRESENT", "UNREADABLE"
            evidence = "device seen, its label could not be read"
        elif status == "label_mismatch":
            comp, label = "INCORRECTLY_IDENTIFIED", "INCORRECT"
            evidence = f"label reads '{c.get('read_as') or '?'}', drawing says '{tag}'"
        elif status == "type_mismatch":
            comp, label = "INCORRECTLY_INSTALLED", "UNVERIFIED"
            evidence = f"a {str(c.get('detected_type') or 'different device').replace('_', ' ')} was found instead"
        elif tag in unseen:
            comp, label = "UNVERIFIABLE", "UNVERIFIED"
            evidence, confidence = "the place is not in the photos, so it cannot be judged", "none"
        else:
            comp, label = "MISSING", "UNVERIFIED"
            evidence, confidence = "not found in the photos that cover this place", "low"
            if not policy["photo_evidence_sufficient"]:
                comp, evidence = "UNVERIFIABLE", "not found in photos (policy: photos alone cannot prove absence)"

        # an inspector's observation beats what the photos suggest
        if obs.get("component") == "present" and comp in ("MISSING", "UNVERIFIABLE"):
            comp, evidence, confidence = "PRESENT", "inspector observed the component", "high"
        elif obs.get("component") == "missing":
            comp, evidence, confidence = "MISSING", "inspector confirmed the component is not there", "high"
        elif obs.get("component") == "unknown":
            comp, evidence, confidence = "UNVERIFIABLE", "inspector could not verify the component", "none"
        ol = obs.get("label")
        if ol:
            label = {"ok": "OK", "missing": "MISSING", "incorrect": "INCORRECT", "unreadable": "UNREADABLE",
                     "unknown": "UNVERIFIED", "present": "PRESENT_WITHOUT_COMPONENT"}.get(ol, label)
            if ol == "present" and comp == "PRESENT":
                label = "OK"
        if comp == "MISSING" and label == "OK":
            label = "PRESENT_WITHOUT_COMPONENT"      # the label is still on the rail / panel

        exp = expected.get(tag, {})
        records.append({
            "tag": tag,
            "description": c.get("description") or exp.get("description") or "",
            "type": c.get("type"),
            "function": (node or {}).get("function") or c.get("description") or "not documented",
            "cabinet": (result.get("topology") or {}).get("cabinet"),
            "location": exp.get("view") or None,
            "circuit": (node or {}).get("circuit"),
            "subsystem": (node or {}).get("subsystem"),
            "kind": (node or {}).get("kind"),
            "in_topology": node is not None,
            "incoming": [{"from": e["from"], "via": e.get("via"), "sheet": e["sheet"]} for e in graph.pred.get(tag, [])] if node else None,
            "outgoing": [{"to": e["to"], "via": e.get("via"), "sheet": e["sheet"]} for e in graph.succ.get(tag, [])] if node else None,
            "terminals_and_wires": "not documented (needs wire list / terminal schedule)",
            "expected_quantity": 1,
            "observed_quantity": 1 if comp in ("PRESENT", "INCORRECTLY_IDENTIFIED", "INCORRECTLY_INSTALLED") else
                                 (0 if comp == "MISSING" else None),
            "component_status": comp,
            "label_status": label,
            "label_function": _label_function(tag, (node or {}).get("kind")),
            "evidence": {"source": "inspector observation" if by_inspector else "inspection photos", "detail": evidence,
                         "confidence": confidence, "photo": c.get("photo")},
            "reference": _reference(exp, node, result),
            "safety": bool((node or {}).get("safety")) or tag in policy["safety_nodes"],
        })
    return records


def _reference(exp: dict, node: dict | None, result: dict) -> str:
    doc = (result.get("topology") or {}).get("document")
    parts = []
    if node and doc:
        parts.append(f"{doc.split(',')[0]}, schematic sheet {node['sheet']}")
    src = str(exp.get("source") or "")
    if src:
        parts.append(f"drawing {src.replace(' p', ' page ')}")
    return "; ".join(parts) or "no drawing reference"


# --------------------------------------------------------------------------- #
# the analysis
# --------------------------------------------------------------------------- #
def _names(graph: Graph, ids, limit=10) -> str:
    """Readable list; members of a group ('13MFW modules') are counted together."""
    groups, single = defaultdict(list), []
    for i in sorted(ids):
        g = graph.nodes.get(i, {}).get("group")
        (groups[g] if g else single).append(i)
    out = single[:limit] + [f"{len(m)} {g}" for g, m in sorted(groups.items())]
    more = len(single) - limit
    return ", ".join(out) + (f" and {more} more" if more > 0 else "") if out else "none"


def _fix_component(rec) -> tuple[str, str]:
    desc = rec["description"] if rec["description"] and rec["description"] != rec["tag"] else (rec["type"] or "")
    what = f"{desc.replace('_', ' ')} {rec['tag']}".strip()
    place = f" ({rec['location']} inside view)" if rec.get("location") else ""
    return (f"Install {what} as shown on the approved drawing{place}, and label it {rec['tag']}.",
            "Fit it, repeat the inspection with a photo of this position, and have the downstream supply checked "
            "by the project's functional test procedure.")


def load_policy(path) -> dict:
    """Project policy from a JSON file (any key of DEFAULT_POLICY); defaults when no file is given."""
    import json
    from pathlib import Path
    if not path or not Path(path).is_file():
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def analyze(result: dict, topology: dict | None = None, observations: dict | None = None,
            policy: dict | None = None) -> dict:
    policy = {**DEFAULT_POLICY, **(policy or {}), "severity": {**DEFAULT_POLICY["severity"], **((policy or {}).get("severity") or {})}}
    observations = observations or {}
    graph = Graph(topology)
    result = {**result, "topology": topology and {"cabinet": topology.get("cabinet"), "document": topology.get("document")}}
    records = _component_records(result, graph, observations, policy)

    failed = {r["tag"] for r in records if r["component_status"] in ("MISSING", "INCORRECTLY_INSTALLED")}
    unknown = {r["tag"] for r in records if r["component_status"] == "UNVERIFIABLE"}
    combined = graph.effects(failed, unknown) if graph else {"lost": set(), "degraded": set(), "uncertain": set(), "base": set(), "now": set()}
    sev = policy["severity"]
    safety_nodes = {n for n, v in graph.nodes.items() if v.get("safety")} | set(policy["safety_nodes"])
    defects = []

    def defect(rec, kind, **kw):
        base = {"id": f"{kind}:{rec['tag']}", "tag": rec["tag"], "kind": kind,
                "expected": {"tag": rec["tag"], "description": rec["description"], "function": rec["function"]},
                "reference": rec["reference"], "circuit": rec["circuit"], "subsystem": rec["subsystem"],
                "evidence": rec["evidence"], "approval_required": False}
        base.update(kw)
        defects.append(base)

    # ---- missing / wrongly installed components: follow the documented connections ----
    for rec in sorted((r for r in records if r["component_status"] in ("MISSING", "INCORRECTLY_INSTALLED")),
                      key=lambda r: r["tag"]):
        tag, wrong = rec["tag"], rec["component_status"] == "INCORRECTLY_INSTALLED"
        fix, retest = _fix_component(rec)
        if wrong:
            fix = f"Replace what is installed at {tag} with the approved {rec['description'] or rec['type']}."
        node = graph.nodes.get(tag)
        ctx = {"lost": [], "degraded": [], "uncertain": []}
        if not graph:
            conf, severity, rationale, redundancy = "unknown", sev["unknown_impact"], \
                "No documented electrical topology for this cabinet, so the consequence cannot be traced.", None
            needs = "Schematic / circuit diagrams of this cabinet in the project data"
        elif node is None:
            conf, severity, rationale, redundancy = "unknown", sev["unknown_impact"], \
                f"{tag} does not appear on the documented schematic sheets, so its consequence cannot be traced.", None
            needs = f"Schematic sheet showing {tag}"
        else:
            eff = graph.effects({tag}, set())
            ctx = {k: sorted(eff[k]) for k in ("lost", "degraded", "uncertain")}
            touched = {tag} | eff["lost"] | eff["uncertain"]
            lost_loads = sorted(n for n in eff["lost"] if graph.nodes[n]["kind"] == "load")
            if node["kind"] == "spare":
                conf, severity = "probable", sev["spare"]
                rationale = "A spare item: the drawing documents no load on it."
            elif lost_loads:
                conf, severity = "probable", sev["supply_lost"]
                rationale = f"No documented alternative supply remains for: {_names(graph, lost_loads)}."
            elif eff["lost"] or eff["degraded"]:
                conf, severity = "probable", sev["redundancy_lost"]
                rationale = ((f"The supply branch {_names(graph, eff['lost'])} is lost. " if eff["lost"] else "") +
                             (f"{_names(graph, eff['degraded'])} lose one of their documented supplies and keep working "
                              "on the other one" if eff["degraded"] else "") +
                             " - redundancy is lost, the function is not (probable, from the drawing; not tested).")
            elif eff["uncertain"]:
                conf, severity = "unknown", sev["unknown_impact"]
                rationale = f"Connections beyond {tag} are not completely documented ({_names(graph, eff['uncertain'])})."
            elif graph.succ.get(tag):
                conf, severity = "probable", sev["local"]
                rationale = "Documented dependants keep another supply path."
            else:
                conf, severity = "confirmed" if rec["evidence"]["confidence"] == "high" else "probable", sev["local"]
                rationale = f"No documented part depends on {tag}: a local fault without wider electrical impact."
            if touched & safety_nodes:
                severity = sev["safety"]
                rationale += " A part flagged safety-related on the drawing is affected - safety review required."
            redundancy = None
            if eff["degraded"] or eff["lost"]:
                feeds = sorted({f for n in eff["degraded"] for f in graph.remaining_feeds(n, eff["now"])})
                redundancy = {"mitigated": not lost_loads,
                              "note": (f"Second documented feed remains for {_names(graph, eff['degraded'])}: "
                                       f"{', '.join(feeds[:4])}" + (" ..." if len(feeds) > 4 else "") + "."
                                       if eff["degraded"] else "") +
                                      (f" No alternative for: {_names(graph, lost_loads)}." if lost_loads else "")}
            elif graph.succ.get(tag):
                redundancy = {"mitigated": True, "note": "Dependants have another documented path."}
            needs = None
            if ctx["lost"] or ctx["degraded"]:
                retest = ("After fitting it, check the supply at: " + _names(graph, ctx["lost"] + ctx["degraded"]) +
                          ", using the project's functional test procedure, and repeat the inspection.")
        safe = bool(node and ({tag} | set(ctx["lost"]) | set(ctx["uncertain"])) & safety_nodes)
        final = "FAIL" if wrong else policy["missing_component"]
        defect(rec, "component_incorrectly_installed" if wrong else "component_missing",
               observed=("Wrong device installed: " + rec["evidence"]["detail"]) if wrong else "Not found",
               label_observed=rec["label_status"], consequences=ctx, impact_confidence=conf,
               severity=severity, rationale=rationale, redundancy=redundancy, corrective_action=fix, retest=retest,
               final_status=final, approval_required=safe or severity == "critical" or conf == "unknown",
               safety_related=safe, missing_information=needs,
               classification=(["Bill-of-material deviation (spare item)"] if node and node["kind"] == "spare" else
                               ["Electrical functional defect"] if node else
                               ["Electrical functional defect (impact unknown)"]))

    # ---- labels: identification defects, never an open circuit ----
    for rec in sorted(records, key=lambda r: r["tag"]):
        if rec["component_status"] in ("MISSING", "UNVERIFIABLE", "INCORRECTLY_INSTALLED"):
            if rec["label_status"] == "PRESENT_WITHOUT_COMPONENT":
                defect(rec, "label_present_component_missing",
                       observed="The label is still on the rail / panel but the component is not there",
                       label_observed=rec["label_status"], consequences={"lost": [], "degraded": [], "uncertain": []},
                       impact_confidence="confirmed", severity="minor", final_status="DOCUMENTATION_DEFECT",
                       rationale="A leftover label makes the position look occupied during maintenance.",
                       redundancy=None, classification=["Maintenance/traceability risk"],
                       corrective_action=f"Remove or correct the label {rec['tag']} until the component is fitted.",
                       retest="Confirm on the next inspection.")
            continue
        ls, fn = rec["label_status"], rec["label_function"]
        if ls in ("OK", "UNVERIFIED", "PRESENT_WITHOUT_COMPONENT"):
            continue
        protective = fn == "protective-device identification"
        review = protective or rec["safety"]
        cls = (["Potential safety or compliance concern", "Maintenance/traceability risk"] if protective else
               ["Identification/documentation defect", "Maintenance/traceability risk"] if fn == "terminal identification" else
               ["Identification/documentation defect"])
        if ls == "UNREADABLE":
            cls, final = ["Unverified condition requiring inspection"], "UNVERIFIED"
            what, text = "Label visible but not readable", "The label could not be read, so identification is unverified."
        else:
            final = policy["protective_label_defect"] if review else "DOCUMENTATION_DEFECT"
            what = "Label missing" if ls == "MISSING" else "Label wrong"
            text = (f"The {fn} is {'absent' if ls == 'MISSING' else 'wrong'}; the component itself is present. This is an "
                    "identification defect: it does not mean any circuit is open.")
        if ls == "INCORRECT":
            what = f"Label does not match the drawing ({rec['evidence']['detail']})"
        defect(rec, "label_missing" if ls == "MISSING" else "label_unreadable" if ls == "UNREADABLE" else "label_incorrect",
               observed=what, label_observed=ls, consequences={"lost": [], "degraded": [], "uncertain": []},
               impact_confidence="confirmed" if ls != "UNREADABLE" else "unknown",
               severity="major" if review and final != "UNVERIFIED" else "minor", rationale=text, redundancy=None,
               classification=cls, final_status=final, approval_required=review,
               safety_related=bool(rec["safety"]),
               corrective_action=(f"Fit / correct the label '{rec['tag']}' as on the nameplate drawing"
                                  f" and confirm the device really is the {rec['description'] or 'one the drawing requires'}."
                                  if ls == "INCORRECT" else f"Fit a readable label '{rec['tag']}'."),
               retest="Re-photograph the label and run a re-check.")

    # ---- wire labels (wire list needed): identification and verification risk only ----
    wires = (result.get("expected") or {}).get("wiring", [])
    for w in result.get("wire_labels", []):
        if w.get("status") in ("ok", None):
            continue
        route = next(((x.get("from"), x.get("to")) for x in wires if x.get("wire_no") == w["label"]), None)
        rec = {"tag": w["label"], "description": f"Wire label {w['label']}", "function": "wire identification",
               "reference": "wire list", "circuit": None, "subsystem": None,
               "evidence": {"source": "inspection photos", "detail": f"photo {(w.get('photo') or 0) + 1}", "confidence": "medium", "photo": w.get("photo")}}
        missing = w["status"] == "missing"
        defect(rec, "wire_label_missing" if missing else "wire_label_incorrect",
               observed="Wire label not found" if missing else f"Wire label reads '{w.get('read_as') or '?'}'",
               label_observed="MISSING" if missing else "INCORRECT",
               expected={"tag": w["label"], "description": f"wire {route[0]} -> {route[1]}" if route else "wire label", "function": "wire identification"},
               consequences={"lost": [], "degraded": [], "uncertain": []}, impact_confidence="unknown",
               severity="minor", final_status="DOCUMENTATION_DEFECT", redundancy=None,
               rationale="Point-to-point verification of this wire is unreliable and maintenance could reconnect it wrongly. "
                         "The label alone does not show the conductor is disconnected - that is not assumed.",
               classification=["Maintenance/traceability risk", "Identification/documentation defect"],
               corrective_action=f"Fit / correct wire label '{w['label']}'" + (f" on {route[0]} -> {route[1]}." if route else "."),
               retest="Re-photograph the sleeve; verify the wire continuity only with the project's test method.",
               missing_information="Physical continuity of the wire is not established by this inspection")

    return _summarise(result, records, defects, graph, combined, failed, unknown, policy, topology)


# --------------------------------------------------------------------------- #
# statuses, disposition, graph for the UI
# --------------------------------------------------------------------------- #
def _node_states(records, defects, graph, combined, failed, unknown) -> dict[str, str]:
    doc = {d["tag"] for d in defects if d["final_status"] in ("DOCUMENTATION_DEFECT", "HOLD") and d["kind"].startswith("label")}
    states = {}
    for n in graph.nodes:
        states[n] = "not_inspected"
    for r in records:
        t = r["tag"]
        if r["component_status"] in ("MISSING", "INCORRECTLY_INSTALLED"):
            states[t] = "fault"
        elif r["component_status"] == "UNVERIFIABLE":
            states[t] = "unverified"
        elif t in doc or r["label_status"] in ("INCORRECT", "MISSING", "UNREADABLE") or r["component_status"] == "INCORRECTLY_IDENTIFIED":
            states[t] = "documentation"
        else:
            states[t] = "ok"
    for n in graph.nodes:
        if states[n] == "fault":
            continue
        for key, state in (("lost", "lost"), ("uncertain", "uncertain"), ("degraded", "degraded")):
            if n in combined[key]:
                if STATE_RANK.index(state) < STATE_RANK.index(states[n]):
                    states[n] = state
    return states


def _summarise(result, records, defects, graph, combined, failed, unknown, policy, topology):
    states = _node_states(records, defects, graph, combined, failed, unknown)
    comp_counts = defaultdict(int)
    for r in records:
        comp_counts[r["component_status"]] += 1
    label_counts = defaultdict(int)
    for r in records:
        label_counts[r["label_status"]] += 1

    # circuits and subsystems
    order = ["fault", "lost", "degraded", "uncertain", "unverified", "documentation"]
    names = {"fault": "FAULT", "lost": "SUPPLY_LOST", "degraded": "REDUNDANCY_LOST", "uncertain": "UNKNOWN",
             "unverified": "UNKNOWN", "documentation": "DOCUMENTATION_DEFECT"}

    def rollup(attr):
        groups = defaultdict(list)
        for n, v in graph.nodes.items():
            if v.get(attr):
                groups[v[attr]].append(n)
        out = []
        for name, members in groups.items():
            present = [states[m] for m in members]
            hit = next((s for s in order if s in present), None)
            status = names[hit] if hit else ("NO_DEFECT_FOUND" if "ok" in present else "NOT_ASSESSED")
            why = [f"{m}: {states[m].replace('_', ' ')}" for m in sorted(members) if states[m] in order][:6]
            out.append({"name": name, "status": status, "reason": why, "parts": len(members),
                        "inspected": sum(s != "not_inspected" for s in present)})
        return sorted(out, key=lambda x: (x["status"] in ("NO_DEFECT_FOUND", "NOT_ASSESSED"), x["name"]))

    circuits, subsystems = rollup("circuit"), rollup("subsystem")
    load_states = [states[n] for n, v in graph.nodes.items() if v.get("kind") == "load"]
    if not graph:
        functional = "NOT_ASSESSED"
    elif "lost" in load_states:
        functional = "FUNCTION_LOST_PROBABLE"
    elif "degraded" in load_states or any(s == "degraded" for s in states.values()):
        functional = "REDUNDANCY_LOST"
    elif any(s in ("uncertain", "unverified") for s in states.values()):
        functional = "UNKNOWN"
    elif failed:
        functional = "LOCAL_FAULT_ONLY"
    else:
        functional = "NO_FUNCTIONAL_LOSS_IDENTIFIED"

    verified_fail = [d for d in defects if d["final_status"] == "FAIL"]
    holds = [d for d in defects if d["final_status"] == "HOLD"]
    docs = [d for d in defects if d["final_status"] == "DOCUMENTATION_DEFECT"]
    unresolved = [r["tag"] for r in records if r["component_status"] == "UNVERIFIABLE"] + \
                 [d["tag"] for d in defects if d["final_status"] == "UNVERIFIED"]
    safety_hit = [d for d in defects if d.get("safety_related")]
    safety_unknown = [r["tag"] for r in records if r["safety"] and r["component_status"] == "UNVERIFIABLE"]

    if verified_fail:
        disposition = "FAIL"
    elif holds or (unresolved and policy["unverified_components"] == "HOLD") or safety_unknown:
        disposition = "HOLD_FOR_ENGINEERING_REVIEW"
    elif unresolved and policy["unverified_components"] == "FAIL":
        disposition = "FAIL"
    elif docs:
        disposition = "PASS_WITH_DOCUMENTATION_DEFECTS" if policy["documentation_defects_allowed"] else "FAIL"
    else:
        disposition = "PASS"
    if disposition == "PASS" and not records:
        disposition = "HOLD_FOR_ENGINEERING_REVIEW"             # nothing was inspected: nothing can be passed

    electrical = [d for d in defects if d["kind"] in ("component_missing", "component_incorrectly_installed")]
    labelling = [d for d in defects if d["kind"].startswith(("label", "wire_label"))]

    missing_info = []
    if not graph:
        missing_info.append({"about": "Electrical topology of this cabinet",
                             "reason": "No documented topology exists for it, so no fault can be traced.",
                             "needed": "Schematic / circuit diagrams read into app/data/topology/"})
    else:
        missing_info += topology.get("unknown", [])
        outside = sorted(r["tag"] for r in records if not r["in_topology"])
        if outside:
            missing_info.append({"about": f"{len(outside)} inspected parts are not on the documented schematic sheets "
                                          f"({', '.join(outside[:8])}{' ...' if len(outside) > 8 else ''})",
                                 "reason": "Their connections are unknown, so no consequence is traced for them.",
                                 "needed": "Schematic sheets that show these parts"})
    if unresolved:
        missing_info.append({"about": f"{len(unresolved)} parts could not be verified ({', '.join(sorted(unresolved)[:8])}"
                                      f"{' ...' if len(unresolved) > 8 else ''})",
                             "reason": "They are not in the photos or their labels are unreadable.",
                             "needed": "Photos / physical inspection of those places"})
    if not (result.get("expected") or {}).get("wiring"):
        missing_info.append({"about": "Wire list", "reason": "No wire list was given, so wire labels and terminal "
                             "connections are not checked.", "needed": "Wire list (Excel)"})
    if not policy["approved"]:
        missing_info.append({"about": "Approved acceptance policy",
                             "reason": "The pass / fail / hold rules used here are defaults, not approved project criteria.",
                             "needed": "Project acceptance criteria (severity thresholds, safety-related circuits)"})

    return {
        "cabinet": (topology or {}).get("cabinet"),
        "topology": {"found": bool(graph), "document": (topology or {}).get("document"),
                     "provenance": (topology or {}).get("provenance")},
        "policy": {**policy, "note": "Defaults - not an approved project policy." if not policy["approved"] else "Approved policy."},
        "disposition": disposition, "disposition_label": DISPOSITIONS[disposition],
        "engineering_approval_required": bool(holds or safety_hit or safety_unknown or
                                              any(d["approval_required"] for d in defects)),
        "statuses": {
            "component": dict(comp_counts), "label": dict(label_counts),
            "circuit": circuits, "subsystem": subsystems, "cabinet_functional": functional,
            "identification": ("DEFECTS" if labelling else "UNVERIFIED" if any(r["label_status"] == "UNVERIFIED" for r in records)
                               and not all(r["label_status"] == "OK" for r in records) else "OK"),
            "safety_review": ("REQUIRED" if safety_hit else "UNKNOWN" if safety_unknown else "NONE_IDENTIFIED"),
        },
        "summary": {"electrical_defects": len(electrical), "labeling_defects": len(labelling),
                    "unresolved": len(unresolved), "components": len(records)},
        "defects": defects,
        "components": records,
        "geometry": (topology or {}).get("geometry"),
        "wires": _wires_view(graph),
        "graph": _graph_view(graph, states, defects),
        "node_states": {n: st for n, st in sorted(states.items()) if st not in ("ok", "not_inspected")},
        "missing_information": missing_info,
        "assumptions": ["Consequences come from the documented drawing topology and were not tested or measured.",
                        "Nothing here shows the wiring is correct or the cabinet is electrically safe.",
                        "A part that is only downstream of a fault is reported as affected, not as defective."],
    }


def _wires_view(graph: Graph) -> list[dict]:
    """Every documented connection (for the 3D wires). Cable names / cross-sections are not on
    the topology, so wires carry only what the drawing names: the from / to parts and the sheet."""
    return [{"from": e["from"], "to": e["to"], "type": e["type"], "sheet": e["sheet"], **({"via": e["via"]} if e.get("via") else {})}
            for e in graph.edges]


def _graph_view(graph: Graph, states: dict, defects: list[dict]) -> dict:
    """Nodes and edges for the dependency graph, groups collapsed, only the interesting part."""
    if not graph:
        return {"nodes": [], "edges": []}
    interesting = {n for n, s in states.items() if s not in ("ok", "not_inspected")}
    if not interesting:
        return {"nodes": [], "edges": []}
    keep = set(interesting)
    for n in list(interesting):                       # one step up and down so the fault has context
        keep |= {e["from"] for e in graph.pred[n]} | {e["to"] for e in graph.succ[n]}
    for n in list(interesting):                       # and the supply chain back to its source
        queue = deque([n])
        while queue:
            for e in graph.pred[queue.popleft()]:
                if e["from"] not in keep:
                    keep.add(e["from"])
                    queue.append(e["from"])
    rank = {s: i for i, s in enumerate(STATE_RANK)}
    nodes, group_of = {}, {}
    for n in sorted(keep):
        v = graph.nodes.get(n) or {"kind": "unknown", "function": "not on the documented schematic sheets"}
        gid = f"group:{v['group']}" if v.get("group") else n
        group_of[n] = gid
        cur = nodes.get(gid)
        state = states[n]
        if cur is None:
            nodes[gid] = {"id": gid, "label": n if gid == n else v["group"], "kind": v["kind"], "circuit": v.get("circuit"),
                          "state": state, "members": [n] if gid != n else [], "function": v["function"]}
        else:
            cur["members"].append(n)
            if rank[state] < rank[cur["state"]]:
                cur["state"] = state
    for g in nodes.values():
        if g["members"]:
            g["label"] = f"{g['label']} x{len(g['members'])}"
    edges, seen = [], set()
    for e in graph.edges:
        a, b = group_of.get(e["from"]), group_of.get(e["to"])
        if a and b and a != b and (a, b, e["type"]) not in seen:
            seen.add((a, b, e["type"]))
            edges.append({"from": a, "to": b, "type": e["type"], "sheet": e["sheet"]})
    return {"nodes": list(nodes.values()), "edges": edges}
