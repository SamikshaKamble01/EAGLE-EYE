// Root cause and fault impact: what a missing part or label means for the circuits, the cabinet and
// the maintenance team. Everything shown comes from result.impact (backend impact_service); nothing
// is invented here. The dependency graph only draws connections that are on the drawings.
import { AlertTriangle, ArrowRight, Check, ChevronDown, CircleHelp, Copy, GitBranch, Network, ShieldAlert, Tag, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { saveObservations } from "../lib/api";
import type { Disposition, Impact, ImpactDefect, NodeState, Observation } from "../lib/types";

export const DISPOSITION_STYLE: Record<Disposition, string> = {
  PASS: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-emerald-500/40",
  PASS_WITH_DOCUMENTATION_DEFECTS: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/40",
  FAIL: "bg-red-500/15 text-red-600 dark:text-red-300 ring-red-500/40",
  HOLD_FOR_ENGINEERING_REVIEW: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/40",
};

/** colours of the graph states: confirmed fault, possible impact, documentation defect, unverified */
export const NODE_STYLE: Record<NodeState, { fill: string; stroke: string; text: string; dash?: string; label: string }> = {
  fault: { fill: "#fee2e2", stroke: "#ef4444", text: "#991b1b", label: "Fault (part missing / wrong)" },
  lost: { fill: "#ffedd5", stroke: "#f97316", text: "#9a3412", label: "Supply lost (probable)" },
  degraded: { fill: "#fef9c3", stroke: "#eab308", text: "#854d0e", label: "Redundancy lost (probable)" },
  uncertain: { fill: "#f3e8ff", stroke: "#a855f7", text: "#6b21a8", dash: "5 3", label: "Impact unknown" },
  documentation: { fill: "#e0f2fe", stroke: "#0ea5e9", text: "#075985", label: "Label / documentation defect" },
  unverified: { fill: "#f1f5f9", stroke: "#64748b", text: "#334155", dash: "5 3", label: "Not verified" },
  ok: { fill: "#dcfce7", stroke: "#22c55e", text: "#166534", label: "No defect found" },
  not_inspected: { fill: "#ffffff", stroke: "#cbd5e1", text: "#64748b", label: "Not inspected" },
};

const CONFIDENCE: Record<string, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  probable: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  unknown: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
const FINAL: Record<string, string> = {
  FAIL: "bg-red-500/15 text-red-600 dark:text-red-300",
  HOLD: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  DOCUMENTATION_DEFECT: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  UNVERIFIED: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
const STATUS_CHIP: Record<string, string> = {
  FAULT: "bg-red-500/15 text-red-600 dark:text-red-300",
  SUPPLY_LOST: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  REDUNDANCY_LOST: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-300",
  UNKNOWN: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  DOCUMENTATION_DEFECT: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  NO_DEFECT_FOUND: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  NOT_ASSESSED: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const KIND_TITLE: Record<string, string> = {
  component_missing: "Component missing",
  component_incorrectly_installed: "Wrong device installed",
  label_missing: "Label missing",
  label_incorrect: "Label does not match the drawing",
  label_unreadable: "Label not readable",
  label_present_component_missing: "Label left behind, component gone",
  wire_label_missing: "Wire label missing",
  wire_label_incorrect: "Wire label wrong",
};

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

// ---------------------------------------------------------------- dependency graph
function DependencyGraph({ graph, focus }: { graph: Impact["graph"]; focus: Set<string> | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  const hit = (n: Impact["graph"]["nodes"][number]) => !focus || focus.has(n.id) || n.members.some((m) => focus.has(m));
  const connected = useMemo(() => new Set(graph.edges.flatMap((e) => [e.from, e.to])), [graph]);
  const nodes = useMemo(() => graph.nodes.filter((n) => connected.has(n.id)), [graph, connected]);
  const isolated = useMemo(() => graph.nodes.filter((n) => !connected.has(n.id)), [graph, connected]);
  const layout = useMemo(() => {
    const ids = nodes.map((n) => n.id);
    const flow = graph.edges.filter((e) => e.type !== "monitor");
    const depth: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
    for (let pass = 0; pass < ids.length; pass++) {
      let changed = false;
      for (const e of flow) {
        if (depth[e.to] < depth[e.from] + 1) {
          depth[e.to] = depth[e.from] + 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // monitor-only nodes (alarm terminal) sit one column right of their furthest source
    for (const e of graph.edges.filter((x) => x.type === "monitor")) depth[e.to] = Math.max(depth[e.to], depth[e.from] + 1);
    const columns: Record<number, string[]> = {};
    for (const i of ids) (columns[depth[i]] ??= []).push(i);
    // order each column by the average row of its neighbours on the left (fewer crossing lines)
    const rowOf: Record<string, number> = {};
    const cols = Object.keys(columns).map(Number).sort((a, b) => a - b);
    cols.forEach((c, ci) => {
      if (ci > 0) {
        const score = (id: string) => {
          const rows = graph.edges.filter((e) => e.to === id && rowOf[e.from] !== undefined).map((e) => rowOf[e.from]);
          return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 1e6;
        };
        columns[c].sort((a, b) => score(a) - score(b));
      }
      columns[c].forEach((id, r) => (rowOf[id] = r));
    });
    const W = 150, H = 38, GX = 52, GY = 14;
    const pos: Record<string, { x: number; y: number }> = {};
    let rows = 0;
    Object.entries(columns).forEach(([d, list]) => {
      list.forEach((id, row) => (pos[id] = { x: 8 + Number(d) * (W + GX), y: 8 + row * (H + GY) }));
      rows = Math.max(rows, list.length);
    });
    return { pos, W, H, width: 16 + (Object.keys(columns).length) * (W + GX) - GX, height: 16 + rows * (H + GY) - GY };
  }, [graph, nodes]);

  if (!graph.nodes.length) {
    return <p className="text-sm text-muted">No fault to draw: every inspected part is without defect, or no electrical topology is documented for this cabinet.</p>;
  }
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const sel = picked ? byId[picked] : null;
  // the picked node, everything feeding it and everything it feeds
  const related = new Set<string>();
  if (sel) {
    related.add(sel.id);
    for (const upstream of [true, false]) {
      const queue = [sel.id];
      while (queue.length) {
        const cur = queue.pop()!;
        for (const e of graph.edges) {
          const next = upstream ? (e.to === cur ? e.from : null) : e.from === cur ? e.to : null;
          if (next && !related.has(next)) {
            related.add(next);
            queue.push(next);
          }
        }
      }
    }
  }
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white p-1 dark:bg-slate-100">
        {nodes.length > 0 && <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ minWidth: Math.min(layout.width, 1100), width: "100%", maxHeight: 620 }} role="img" aria-label="Fault dependency graph">
          <defs>
            <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#64748b" />
            </marker>
          </defs>
          {graph.edges.map((e, i) => {
            const a = layout.pos[e.from], b = layout.pos[e.to];
            if (!a || !b) return null;
            const x1 = a.x + layout.W, y1 = a.y + layout.H / 2, x2 = b.x, y2 = b.y + layout.H / 2;
            const mid = (x1 + x2) / 2;
            const hot = ["fault", "lost", "degraded", "uncertain"].includes(byId[e.to]?.state) && ["fault", "lost"].includes(byId[e.from]?.state);
            const dim = sel ? !(related.has(e.from) && related.has(e.to)) : focus ? !(hit(byId[e.from]) && hit(byId[e.to])) : false;
            return (
              <path key={i} d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`} fill="none" markerEnd="url(#arr)"
                stroke={hot ? "#f97316" : "#94a3b8"} strokeWidth={hot ? 2 : 1.2} strokeDasharray={e.type === "monitor" ? "3 3" : undefined} opacity={dim ? 0.12 : 0.9}>
                <title>{`${e.from} → ${e.to} (${e.type}, sheet ${e.sheet})`}</title>
              </path>
            );
          })}
          {nodes.map((n) => {
            const p = layout.pos[n.id], st = NODE_STYLE[n.state];
            const dim = sel ? !related.has(n.id) : !hit(n);
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.22 : 1} style={{ cursor: "pointer", transition: "opacity .2s" }}
                onClick={() => setPicked(picked === n.id ? null : n.id)}>
                <title>{`${n.label}: ${n.function}\n${st.label}${n.members.length ? `\n${n.members.slice(0, 8).join(", ")}${n.members.length > 8 ? " ..." : ""}` : ""}`}</title>
                {picked === n.id && <rect x="-4" y="-4" width={layout.W + 8} height={layout.H + 8} rx="11" fill="none" stroke="#0ea5e9" strokeWidth="2" />}
                <rect width={layout.W} height={layout.H} rx="8" fill={st.fill} stroke={st.stroke} strokeWidth={n.state === "fault" ? 2.6 : 1.6} strokeDasharray={st.dash} />
                <text x={layout.W / 2} y={layout.H / 2 - 3} textAnchor="middle" fontSize="12" fontWeight="700" fill={st.text} fontFamily="ui-monospace, monospace">
                  {n.label.length > 20 ? n.label.slice(0, 19) + "…" : n.label}
                </text>
                <text x={layout.W / 2} y={layout.H / 2 + 11} textAnchor="middle" fontSize="9" fill={st.text} opacity="0.85">
                  {n.kind.replace(/_/g, " ")}
                </text>
              </g>
            );
          })}
        </svg>}
      </div>
      {isolated.length > 0 && (
        <div className="mt-2 rounded-lg border border-line bg-raised px-3 py-2">
          <div className="mb-1.5 text-[11px] font-semibold text-muted">
            {isolated.length} inspected parts are not on the documented schematic sheets, so no connection can be drawn (impact unknown)
          </div>
          <div className="flex flex-wrap gap-1">
            {isolated.map((n) => (
              <span key={n.id} title={`${NODE_STYLE[n.state].label}: ${n.function}`}
                className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold"
                style={{ background: NODE_STYLE[n.state].fill, borderColor: NODE_STYLE[n.state].stroke, color: NODE_STYLE[n.state].text, borderStyle: NODE_STYLE[n.state].dash ? "dashed" : "solid", opacity: focus && !hit(n) ? 0.25 : 1 }}>
                {n.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {sel ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs">
          <b className="tag text-sm">{sel.label}</b>
          <Chip cls="bg-raised text-ink ring-1 ring-line">{NODE_STYLE[sel.state].label}</Chip>
          <span className="text-muted">{sel.function}</span>
          {sel.members.length > 0 && <span className="text-faint">{sel.members.slice(0, 6).join(", ")}{sel.members.length > 6 ? ` … +${sel.members.length - 6}` : ""}</span>}
          <span className="ml-auto text-faint">Highlighted: what feeds it and what it feeds · click again to clear</span>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-faint">Click a part to follow what feeds it and what it feeds.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted">
        {(["fault", "lost", "degraded", "uncertain", "documentation", "unverified", "ok"] as NodeState[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <i className="inline-block h-3 w-4 rounded-sm" style={{ background: NODE_STYLE[s].fill, border: `1.6px ${NODE_STYLE[s].dash ? "dashed" : "solid"} ${NODE_STYLE[s].stroke}` }} />
            {NODE_STYLE[s].label}
          </span>
        ))}
        <span>Dashed arrow = monitoring signal. Only connections drawn on the schematic sheets are shown.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- inspector observation
function ObservationControl({ id, tag, current, onSaved }: { id: string; tag: string; current?: Observation; onSaved: (impact: Impact, obs: Record<string, Observation>) => void }) {
  const [component, setComponent] = useState(current?.component ?? "");
  const [label, setLabel] = useState(current?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const apply = async () => {
    setBusy(true);
    setErr("");
    try {
      const body: Observation | null = component || label ? { ...(component && { component }), ...(label && { label }) } as Observation : null;
      const r = await saveObservations(id, { [tag]: body });
      onSaved(r.impact, r.observations);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const sel = "rounded-md border border-line bg-surface px-2 py-1 text-xs";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-xs">
      <span className="font-semibold text-muted">Inspector observation</span>
      <select className={sel} value={component} onChange={(e) => setComponent(e.target.value as Observation["component"] & string)} aria-label="Component observed">
        <option value="">Component: from photos</option>
        <option value="present">Component is present</option>
        <option value="missing">Component is missing</option>
        <option value="unknown">Cannot verify component</option>
      </select>
      <select className={sel} value={label} onChange={(e) => setLabel(e.target.value as Observation["label"] & string)} aria-label="Label observed">
        <option value="">Label: from photos</option>
        <option value="ok">Label present and correct</option>
        <option value="missing">Label missing</option>
        <option value="incorrect">Label wrong</option>
        <option value="unreadable">Label unreadable</option>
        <option value="present">Label left on rail (no component)</option>
        <option value="unknown">Cannot verify label</option>
      </select>
      <button onClick={apply} disabled={busy} className="cursor-pointer rounded-md bg-sky-500 px-3 py-1 font-semibold text-white hover:bg-sky-600 disabled:opacity-50">
        {busy ? "Saving…" : "Apply"}
      </button>
      {err && <span className="text-red-500">{err}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- cause chain
/** missing part -> circuit -> dependent parts -> subsystem -> cabinet, in words, from the defect's own data */
function CauseChain({ d }: { d: ImpactDefect }) {
  const c = d.consequences;
  const dependants = c.lost.length + c.degraded.length;
  const cabinet = d.redundancy?.mitigated
    ? { t: "Keeps working on the other feed", cls: "border-yellow-500/50 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200" }
    : c.lost.length
      ? { t: "Function lost (probable)", cls: "border-orange-500/60 bg-orange-500/10 text-orange-800 dark:text-orange-200" }
      : c.uncertain.length || d.impact_confidence === "unknown"
        ? { t: "Cabinet impact unknown", cls: "border-purple-500/50 bg-purple-500/10 text-purple-800 dark:text-purple-200" }
        : { t: "No wider impact documented", cls: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" };
  const lose = c.lost.length ? `${c.lost.length} lose supply` : "";
  const one = c.degraded.length ? `${c.degraded.length} lose one feed` : "";
  const steps = [
    { k: "Fault", t: `${d.tag} ${d.kind === "component_incorrectly_installed" ? "wrong device" : "missing"}`, cls: "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-200 font-bold" },
    { k: "Circuit", t: d.circuit ?? "not documented", cls: "border-line bg-surface" },
    { k: "Dependent parts", t: dependants ? [lose, one].filter(Boolean).join(", ") : c.uncertain.length ? `${c.uncertain.length} unknown` : "none documented", cls: dependants ? "border-orange-500/50 bg-orange-500/10" : "border-line bg-surface" },
    { k: "Subsystem", t: d.subsystem ?? "not documented", cls: "border-line bg-surface" },
    { k: "Cabinet", t: cabinet.t, cls: `${cabinet.cls} font-semibold` },
  ];
  return (
    <ol className="flex flex-wrap items-stretch gap-1.5 text-xs">
      {steps.map((s, i) => (
        <li key={s.k} className="flex items-center gap-1.5">
          <div className={`rounded-lg border px-2.5 py-1.5 ${s.cls}`}>
            <div className="text-[9px] font-bold uppercase tracking-wide opacity-60">{s.k}</div>
            {s.t}
          </div>
          {i < steps.length - 1 && <ArrowRight size={13} className="text-faint" />}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- one defect
function DefectCard({ d, id, observations, onSaved, focused, onFocus }: { d: ImpactDefect; id: string; observations?: Record<string, Observation>; onSaved: (i: Impact, o: Record<string, Observation>) => void; focused: boolean; onFocus: () => void }) {
  const [open, setOpen] = useState(d.final_status === "FAIL" && d.consequences.lost.length + d.consequences.degraded.length > 0);
  const c = d.consequences;
  const list = (items: string[]) => (items.length ? items.slice(0, 12).join(", ") + (items.length > 12 ? ` … (+${items.length - 12})` : "") : "none");
  const wireOrComponent = d.kind.startsWith("wire_label") ? "wire" : "component";
  return (
    <div className={`rounded-xl border bg-raised transition-shadow ${focused ? "ring-2 ring-sky-500" : ""} ${d.final_status === "FAIL" ? "border-red-500/40" : d.final_status === "HOLD" ? "border-amber-500/40" : "border-line"}`}>
      <button onClick={() => { setOpen(!open); onFocus(); }} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left">
        <span className="tag text-base font-bold">{d.tag}</span>
        <span className="text-sm font-semibold">{KIND_TITLE[d.kind] ?? d.kind}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Chip cls={FINAL[d.final_status]}>{pretty(d.final_status)}</Chip>
          <Chip cls={CONFIDENCE[d.impact_confidence]}>Impact {d.impact_confidence}</Chip>
          {d.approval_required && <Chip cls="bg-violet-500/15 text-violet-700 dark:text-violet-300">Engineering approval</Chip>}
          <ChevronDown size={15} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3 text-sm">
          {d.kind.startsWith("component") && <CauseChain d={d} />}
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <Field t="1 · Expected">{d.expected.tag}{d.expected.description && d.expected.description !== d.expected.tag ? ` – ${d.expected.description}` : ""}<br /><span className="text-xs text-muted">{d.expected.function}</span></Field>
            <Field t="2 · Observed">{d.observed}<br /><span className="text-xs text-muted">label: {pretty(d.label_observed)}</span></Field>
            <Field t="3 · Evidence and drawing">{d.evidence.detail} <span className="text-xs text-muted">({d.evidence.source}, confidence {d.evidence.confidence})</span><br /><span className="text-xs text-muted">{d.reference}</span></Field>
            <Field t="4 · Circuit and subsystem">{d.circuit ?? <i className="text-muted">not documented</i>} · {d.subsystem ?? <i className="text-muted">not documented</i>}</Field>
            {wireOrComponent === "component" && (
              <Field t="5 · Possible downstream consequences">
                {d.kind.startsWith("component") ? (
                  <>
                    <span className="text-orange-600 dark:text-orange-300">Supply lost:</span> {list(c.lost)}<br />
                    <span className="text-yellow-700 dark:text-yellow-300">Redundancy lost:</span> {list(c.degraded)}<br />
                    <span className="text-purple-600 dark:text-purple-300">Unknown:</span> {list(c.uncertain)}
                  </>
                ) : (
                  "None: a label problem does not interrupt a circuit."
                )}
              </Field>
            )}
            <Field t="6 · Impact is"><Chip cls={CONFIDENCE[d.impact_confidence]}>{d.impact_confidence}</Chip> <span className="text-xs text-muted">{d.impact_confidence === "probable" ? "taken from the drawing, not tested" : d.impact_confidence === "unknown" ? "the drawings do not show enough" : "established"}</span></Field>
            <Field t="7 · Severity and rationale"><b>{d.severity}</b> – {d.rationale}</Field>
            <Field t="8 · Redundancy">{d.redundancy ? `${d.redundancy.mitigated ? "Mitigated. " : "Not mitigated. "}${d.redundancy.note}` : "No documented redundancy applies."}</Field>
            <Field t="9 · Corrective action">{d.corrective_action}</Field>
            <Field t="10 · Retest / verification">{d.retest}</Field>
            <Field t="11 · Final status">
              <Chip cls={FINAL[d.final_status]}>{pretty(d.final_status)}</Chip>{" "}
              {d.approval_required ? <span className="text-xs font-semibold text-violet-600 dark:text-violet-300">engineering approval required</span> : <span className="text-xs text-muted">no extra approval needed</span>}
            </Field>
          </dl>
          <div className="flex flex-wrap gap-1.5">{d.classification.map((k) => <Chip key={k} cls="bg-raised text-muted ring-1 ring-line">{k}</Chip>)}</div>
          {d.missing_information && <p className="text-xs text-purple-600 dark:text-purple-300">Missing information: {d.missing_information}</p>}
          {!d.kind.startsWith("wire_label") && <ObservationControl id={id} tag={d.tag} current={observations?.[d.tag]} onSaved={onSaved} />}
        </div>
      )}
    </div>
  );
}

function Field({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-faint">{t}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- the panel
export default function ImpactPanel({ id, impact, observations, onChanged }: { id: string; impact: Impact; observations?: Record<string, Observation>; onChanged: (i: Impact, o: Record<string, Observation>) => void }) {
  const s = impact.summary, st = impact.statuses;
  const [view, setView] = useState<"all" | "electrical" | "labelling" | "unresolved">("all");
  const [approvalOnly, setApprovalOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const keep = (d: ImpactDefect) => !approvalOnly || d.approval_required;
  const electrical = impact.defects.filter((d) => d.kind.startsWith("component") && keep(d));
  const labelling = impact.defects.filter((d) => (d.kind.startsWith("label") || d.kind.startsWith("wire_label")) && keep(d));
  const unresolved = impact.components.filter((c) => c.component_status === "UNVERIFIABLE");
  const focused = impact.defects.find((d) => d.id === focusId);
  const focusSet = useMemo(
    () => (focused ? new Set([focused.tag, ...focused.consequences.lost, ...focused.consequences.degraded, ...focused.consequences.uncertain]) : null),
    [focused],
  );
  const show = (k: typeof view) => view === "all" || view === k;
  const toggleFocus = (d: ImpactDefect) => setFocusId(focusId === d.id ? null : d.id);

  const copySummary = async () => {
    const lines = [
      `Root cause and fault impact${impact.cabinet ? ` - cabinet ${impact.cabinet}` : ""}`,
      `Disposition: ${impact.disposition_label}${impact.engineering_approval_required ? " (engineering approval required)" : ""}`,
      `Electrical defects: ${s.electrical_defects} | Labelling defects: ${s.labeling_defects} | Unresolved: ${s.unresolved}`,
      `Cabinet function: ${pretty(st.cabinet_functional)} | Safety review: ${pretty(st.safety_review)}`,
      "",
      ...impact.defects.map((d) => `- ${d.tag}: ${KIND_TITLE[d.kind] ?? d.kind} [${pretty(d.final_status)}, impact ${d.impact_confidence}] ${d.rationale} Action: ${d.corrective_action}`),
      "",
      "Consequences come from the documented drawings; they were not tested or measured.",
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };
  const tile = (n: number, title: string, note: string, cls: string, Icon: typeof Zap, key: typeof view) => (
    <button onClick={() => setView(view === key ? "all" : key)} aria-pressed={view === key}
      className={`cursor-pointer rounded-xl border p-3 text-left transition-shadow ${cls} ${view === key ? "ring-2 ring-sky-500" : "hover:shadow-md"}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide opacity-80"><Icon size={14} />{title}</div>
      <div className="mt-1 text-3xl font-extrabold tabular-nums">{n}</div>
      <div className="text-xs opacity-80">{note}</div>
    </button>
  );
  return (
    <div className="card anim-fade-up mt-6 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-semibold"><GitBranch size={17} className="text-sky-500" /> Root cause and fault impact</h2>
        <span className={`rounded-lg px-3 py-1 text-sm font-extrabold ring-1 ${DISPOSITION_STYLE[impact.disposition]}`}>{impact.disposition_label}</span>
        {impact.engineering_approval_required && <Chip cls="bg-violet-500/15 text-violet-700 dark:text-violet-300"><ShieldAlert size={12} className="mr-1 inline" />Engineering approval required</Chip>}
        <span className="ml-auto text-xs text-muted">{impact.cabinet ? `Cabinet ${impact.cabinet}` : "Cabinet not identified"}</span>
        <button onClick={copySummary} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1 text-xs font-semibold text-muted hover:text-ink">
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {copied ? "Copied" : "Copy summary"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        What a missing part or label means for the circuits, from the documented drawings. {impact.policy.note} Consequences are drawn from the schematic, not tested or measured.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {tile(s.electrical_defects, "Electrical defects", "parts missing or wrongly installed", "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300", Zap, "electrical")}
        {tile(s.labeling_defects, "Labelling defects", "labels missing, wrong or unreadable", "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300", Tag, "labelling")}
        {tile(s.unresolved, "Unresolved", "could not be verified from the evidence", "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300", CircleHelp, "unresolved")}
      </div>

      <div className="mt-4 grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
        <Field t="Cabinet function"><Chip cls={STATUS_CHIP[st.cabinet_functional] ?? STATUS_CHIP.UNKNOWN}>{pretty(st.cabinet_functional)}</Chip></Field>
        <Field t="Identification / documentation"><Chip cls={st.identification === "OK" ? STATUS_CHIP.NO_DEFECT_FOUND : st.identification === "DEFECTS" ? STATUS_CHIP.DOCUMENTATION_DEFECT : STATUS_CHIP.NOT_ASSESSED}>{pretty(st.identification)}</Chip></Field>
        <Field t="Safety review"><Chip cls={st.safety_review === "REQUIRED" ? STATUS_CHIP.FAULT : st.safety_review === "UNKNOWN" ? STATUS_CHIP.UNKNOWN : STATUS_CHIP.NO_DEFECT_FOUND}>{pretty(st.safety_review)}</Chip> <span className="text-xs text-muted">only drawing-flagged or policy-named parts are checked</span></Field>
        <Field t="Components">
          <span className="flex flex-wrap gap-1.5">{Object.entries(st.component).map(([k, v]) => <Chip key={k} cls="bg-raised text-muted ring-1 ring-line">{pretty(k)} {v}</Chip>)}</span>
        </Field>
        <Field t="Circuits">
          <span className="flex flex-wrap gap-1.5">{st.circuit.map((c) => <span key={c.name} title={c.reason.join("\n")}><Chip cls={STATUS_CHIP[c.status]}>{c.name}: {pretty(c.status)}</Chip></span>)}</span>
        </Field>
        <Field t="Subsystems">
          <span className="flex flex-wrap gap-1.5">{st.subsystem.map((c) => <span key={c.name} title={c.reason.join("\n")}><Chip cls={STATUS_CHIP[c.status]}>{c.name}: {pretty(c.status)}</Chip></span>)}</span>
        </Field>
      </div>

      <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold"><Network size={15} className="text-sky-500" /> Dependency graph – fault origin and affected parts</h3>
      {focused && (
        <p className="mb-2 flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300">
          Showing the effect of <b className="tag">{focused.tag}</b> only.
          <button onClick={() => setFocusId(null)} className="cursor-pointer underline">Show everything</button>
        </p>
      )}
      <DependencyGraph graph={impact.graph} focus={focusSet} />

      <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
        <div className="flex rounded-lg bg-raised p-0.5 font-semibold">
          {([["all", "All"], ["electrical", `Electrical (${electrical.length})`], ["labelling", `Labelling (${labelling.length})`], ["unresolved", `Unresolved (${unresolved.length})`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className={`cursor-pointer rounded-md px-3 py-1.5 transition ${view === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{label}</button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 font-medium text-muted">
          <input type="checkbox" className="accent-sky-500" checked={approvalOnly} onChange={(e) => setApprovalOnly(e.target.checked)} />
          Needs engineering approval only
        </label>
      </div>

      {show("electrical") && electrical.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold"><Zap size={15} className="text-red-500" /> Electrical defects ({electrical.length})</h3>
          <div className="space-y-2">{electrical.map((d) => <DefectCard key={d.id} d={d} id={id} observations={observations} onSaved={onChanged} focused={focusId === d.id} onFocus={() => toggleFocus(d)} />)}</div>
        </>
      )}
      {show("labelling") && labelling.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold"><Tag size={15} className="text-sky-500" /> Labelling and identification defects ({labelling.length})</h3>
          <div className="space-y-2">{labelling.map((d) => <DefectCard key={d.id} d={d} id={id} observations={observations} onSaved={onChanged} focused={focusId === d.id} onFocus={() => toggleFocus(d)} />)}</div>
        </>
      )}
      {show("unresolved") && unresolved.length > 0 && (
        <details open={view === "unresolved"} className="mt-6 rounded-xl border border-line bg-raised">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold"><CircleHelp size={15} className="text-slate-500" /> Unresolved – not verified ({unresolved.length})</summary>
          <p className="px-3 text-xs text-muted">These places are not in the photos (or their labels cannot be read). They are not reported as missing. If an inspector checked one, record it here.</p>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto px-3 pb-2">
            {unresolved.slice(0, 40).map((c) => (
              <li key={c.tag} className="py-2 text-xs">
                <b className="tag text-sm">{c.tag}</b> <span className="text-muted">{c.description !== c.tag ? c.description : ""} {c.location ? `· ${c.location} view` : ""}</span>
                <ObservationControl id={id} tag={c.tag} current={observations?.[c.tag]} onSaved={onChanged} />
              </li>
            ))}
          </ul>
          {unresolved.length > 40 && <p className="px-3 pb-2 text-xs text-muted">… and {unresolved.length - 40} more.</p>}
        </details>
      )}

      {electrical.length + labelling.length === 0 && view !== "unresolved" && (
        <p className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          {impact.defects.length ? "No defect matches this filter." : "No missing part or label defect was found in the evidence. This does not prove the wiring is correct: nothing here is measured."}
        </p>
      )}

      {impact.missing_information.length > 0 && (
        <details className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold"><AlertTriangle size={15} className="text-purple-500" /> Missing engineering information ({impact.missing_information.length})</summary>
          <ul className="space-y-2 px-3 pb-3 text-xs">
            {impact.missing_information.map((m, i) => (
              <li key={i}><b>{m.about}</b> – {m.reason} <span className="text-purple-600 dark:text-purple-300">Needed: {m.needed}</span></li>
            ))}
          </ul>
        </details>
      )}
      <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[11px] text-faint">{impact.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
    </div>
  );
}
