// Result page: verdict, score, defects (hover = highlight, click = pin + zoom on photo), checks, report.
import { ArrowLeft, ArrowRight, Braces, Check, Copy, Crosshair, FileSpreadsheet, FileText, RefreshCcw, Search, Table2, Trash2, TriangleAlert, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CheckSheet from "../components/CheckSheet";
import { useFeedback } from "../components/Feedback";
import InspectionViewer from "../components/InspectionViewer";
import RecheckDialog from "../components/RecheckDialog";
import { ErrorState, ScoreRing, SeverityBadge, Skeleton, StatusText, VerdictBadge, severityStyle } from "../components/ui";
import { checklistXlsxUrl, deleteInspection, getHistory, getInspection, reportUrl, snippetUrl } from "../lib/api";
import { downloadCsv, downloadJson } from "../lib/export";
import { defectTitle, formatDate, humanize } from "../lib/format";
import type { Severity } from "../lib/types";
import { useApi } from "../lib/useApi";

type Tab = "sheet" | "components" | "wires" | "pipeline";

export default function InspectionDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const { data, loading, error, reload } = useApi(() => getInspection(id), [id]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [query, setQuery] = useState("");
  const { data: chain } = useApi(() => getHistory(id), [id]);
  const [tab, setTab] = useState<Tab>("sheet");
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  const result = data?.result;

  // moving to another inspection (e.g. after a re-check) starts clean
  useEffect(() => {
    setPinned(null);
    setHighlight(null);
    setRecheckOpen(false);
  }, [id]);

  const defects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (result?.defects ?? []).filter(
      (d) =>
        (filter === "all" || d.severity === filter) &&
        (!q || [d.item, d.message, d.code, d.expected, d.actual].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [result, filter, query]);

  // J / K step through the defects (like a review tool)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "escape") setPinned(null);
      if (key !== "j" && key !== "k") return;
      // positions (in the visible list) of defects that point at something
      const rows = defects.map((d, i) => (d.item ? i : -1)).filter((i) => i >= 0);
      if (!rows.length) return;
      const at = rows.findIndex((i) => defects[i].item === pinned);
      const next = rows[key === "j" ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length];
      setPinned(defects[next].item);
      document.getElementById(`defect-${next}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [defects, pinned]);

  if (loading && !data) return <DetailSkeleton />;
  if (error) return <ErrorState message={error.status === 404 ? "This inspection does not exist (it may have been deleted)." : error.message} onRetry={reload} />;
  if (!data) return null;

  async function remove() {
    const ok = await confirm({
      title: "Delete this inspection?",
      message: "The record, the photo and the PDF report are removed permanently.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteInspection(id);
      toast("Inspection deleted");
      navigate("/history");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete the inspection", "error");
    }
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Could not copy to the clipboard", "error");
    }
  }

  const header = (
    <Link to="/history" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:-translate-x-0.5 hover:text-ink">
      <ArrowLeft size={16} /> All inspections
    </Link>
  );

  // inspection that crashed (unreadable PDF etc.)
  if (data.status !== "completed" || !result) {
    return (
      <>
        {header}
        <div className="card flex gap-4 p-6">
          <TriangleAlert className="shrink-0 text-red-500" size={28} />
          <div>
            <h1 className="text-lg font-bold">Inspection could not be completed</h1>
            <p className="mt-1 text-sm text-muted">{data.error ?? "Unknown error."}</p>
            <p className="mt-3 text-xs text-faint">
              {formatDate(data.created_at)} · {data.id}
            </p>
            <button className="btn btn-danger mt-4" onClick={remove}>
              <Trash2 size={16} /> Delete record
            </button>
          </div>
        </div>
      </>
    );
  }

  const r = result;
  const s = r.summary;
  const pass = r.verdict === "PASS";
  const name = data.cabinet_name || "Unnamed cabinet";
  const fileBase = `inspection_${id.slice(0, 8)}`;
  const totalMs = Object.values(r.timings_ms).reduce((a, b) => a + b, 0);
  const maxMs = Math.max(1, ...Object.values(r.timings_ms));
  const components = r.components.filter((c) => !problemsOnly || c.status !== "ok");
  const wires = r.wire_labels.filter((w) => !problemsOnly || w.status !== "ok");
  const active = highlight ?? pinned;
  const sheet = r.checklist;
  const shownTab: Tab = tab === "sheet" && !sheet ? "components" : tab;
  const openIssues = sheet ? sheet.filter((i) => i.result === "FAIL").length : s.critical + s.major;
  const rowFor = (code: string, item: string | null) => sheet?.find((i) => i.code === code && i.item === item);
  const proofFor = (code: string, item: string | null) => (rowFor(code, item)?.snippet ? rowFor(code, item) : undefined);
  const fixes = (sheet ?? []).filter((i) => i.result === "FAIL" && i.fix);

  const exportDefects = () => {
    downloadCsv(`${fileBase}_defects.csv`, [
      ["Severity", "Code", "Item", "Expected", "Found", "Message"],
      ...r.defects.map((d) => [d.severity, d.code, d.item, d.expected, d.actual, d.message]),
    ]);
    toast("Defect list exported as CSV");
  };

  const rowClass = (item: string) =>
    `cursor-pointer transition-colors ${pinned === item ? "bg-sky-500/15" : active === item ? "bg-sky-500/10" : "hover:bg-raised"}`;
  const togglePin = (item: string) => setPinned((p) => (p === item ? null : item));

  return (
    <>
      {header}

      {/* ---- summary bar ---- */}
      <div className="card relative mb-6 overflow-hidden p-6">
        <div
          className={`pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full blur-3xl ${pass ? "bg-emerald-500/20" : "bg-red-500/20"}`}
        />
        <div className={`absolute inset-x-0 top-0 h-1 ${pass ? "bg-emerald-500" : "bg-red-500"}`} />
        <div className="relative flex flex-wrap items-center gap-6">
          <ScoreRing score={r.score} size={112} />
          <div className="min-w-56 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <VerdictBadge verdict={r.verdict} size="lg" />
              <div>
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
                  {name}
                  {data.round > 1 && (
                    <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-bold text-sky-600 dark:text-sky-400">Re-check {data.round - 1}</span>
                  )}
                </h1>
                <p className="text-sm text-muted">{formatDate(data.created_at)}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">
              {pass
                ? "The cabinet matches the drawing and wiring list."
                : `${s.critical + s.major} issue${s.critical + s.major === 1 ? "" : "s"} must be fixed before approval.`}
            </p>
            <div className="mt-3 max-w-md">
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>Checks passed</span>
                <span className="font-semibold tabular-nums text-ink">
                  {s.checks_passed} / {s.checks_total}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-raised">
                <div
                  className={`anim-grow-x h-full rounded-full ${pass ? "bg-emerald-500" : "bg-linear-to-r from-amber-500 to-red-500"}`}
                  style={{ width: `${s.checks_total ? (s.checks_passed / s.checks_total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {(["critical", "major", "minor"] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setFilter((f) => (f === sev ? "all" : sev))}
                title={`Show only ${sev} defects`}
                className={`cursor-pointer rounded-xl border px-4 py-2 transition hover:-translate-y-0.5 ${
                  filter === sev ? "border-sky-500 bg-sky-500/10" : "border-line bg-raised"
                }`}
              >
                <div className={`text-2xl font-bold tabular-nums ${s[sev] ? severityStyle[sev].text : "text-faint"}`}>{s[sev]}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{sev}</div>
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-44 lg:flex-col">
            <button className={`btn ${pass ? "btn-ghost" : "btn-primary"}`} onClick={() => setRecheckOpen(true)} title="Upload a new photo after the fix">
              <RefreshCcw size={16} /> Re-check
            </button>
            <a href={reportUrl(id)} target="_blank" rel="noreferrer" className={`btn ${pass ? "btn-primary" : "btn-ghost"}`}>
              <FileText size={16} /> PDF report
            </a>
            {sheet && (
              <a href={checklistXlsxUrl(id)} className="btn btn-ghost" title="The filled QC check sheet as an Excel file">
                <FileSpreadsheet size={16} /> QC sheet (Excel)
              </a>
            )}
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1 px-2" onClick={exportDefects} title="Export the defect list as CSV">
                <Table2 size={16} /> CSV
              </button>
              <button
                className="btn btn-ghost flex-1 px-2"
                title="Export the full result as JSON"
                onClick={() => {
                  downloadJson(`${fileBase}.json`, data);
                  toast("Full result exported as JSON");
                }}
              >
                <Braces size={16} /> JSON
              </button>
              <button className="btn btn-danger px-2.5" onClick={remove} title="Delete this inspection">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---- re-check: before vs after ---- */}
      {r.recheck && (
        <div className="card anim-fade-up mb-6 p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <RefreshCcw size={17} className="text-sky-500" /> Re-check after the fix
              </h2>
              {data.parent_id && (
                <Link to={`/inspections/${data.parent_id}`} className="text-xs font-medium text-sky-500 hover:underline">
                  Open the inspection before the fix
                </Link>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className="rounded-xl border border-line bg-raised px-3 py-1.5 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Before</div>
                <div className="font-bold tabular-nums">
                  <span className={r.recheck.before.verdict === "PASS" ? "text-emerald-500" : "text-red-500"}>{r.recheck.before.verdict}</span>{" "}
                  {r.recheck.before.score}%
                </div>
              </div>
              <ArrowRight size={18} className="text-muted" />
              <div className="rounded-xl border border-line bg-raised px-3 py-1.5 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">After</div>
                <div className="font-bold tabular-nums">
                  <span className={r.recheck.after.verdict === "PASS" ? "text-emerald-500" : "text-red-500"}>{r.recheck.after.verdict}</span>{" "}
                  {r.recheck.after.score}%
                </div>
              </div>
            </div>
            <div className="ml-auto grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ["Closed", r.recheck.closed, "text-emerald-500"],
                  ["Still open", r.recheck.still_open, "text-red-500"],
                  ["New", r.recheck.new, "text-amber-500"],
                ] as const
              ).map(([label, list, color]) => (
                <div key={label} className="rounded-xl border border-line bg-raised px-4 py-1.5">
                  <div className={`text-2xl font-bold tabular-nums ${list.length ? color : "text-faint"}`}>{list.length}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
                </div>
              ))}
            </div>
          </div>
          {r.recheck.closed.length + r.recheck.still_open.length + r.recheck.new.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3 text-xs">
              {r.recheck.closed.map((x) => (
                <span key={x.key} className="rounded-full bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-600 dark:text-emerald-400">
                  ✓ {x.check_title}: <span className="tag">{x.item}</span> closed
                </span>
              ))}
              {r.recheck.still_open.map((x) => (
                <span key={x.key} className="rounded-full bg-red-500/15 px-2.5 py-1 font-semibold text-red-600 dark:text-red-400">
                  {x.check_title}: <span className="tag">{x.item}</span> still open
                </span>
              ))}
              {r.recheck.new.map((x) => (
                <span key={x.key} className="rounded-full bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-700 dark:text-amber-400">
                  {x.check_title}: <span className="tag">{x.item}</span> new
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- photo + defects ---- */}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <InspectionViewer id={id} result={r} highlight={highlight} pinned={pinned} onHover={setHighlight} onPin={setPinned} />

        <div className="card flex flex-col">
          <div className="space-y-3 border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto font-semibold">
                Defects <span className="text-muted">({defects.length === r.defects.length ? r.defects.length : `${defects.length} of ${r.defects.length}`})</span>
              </h2>
              {(["all", "critical", "major", "minor"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`chip ${filter === f ? "chip-on" : "chip-off"}`}>
                  {f}
                  {f !== "all" && <span className="ml-1 opacity-60">{s[f]}</span>}
                </button>
              ))}
            </div>
            {r.defects.length > 0 && (
              <label className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5 focus-within:border-sky-500">
                <Search size={14} className="text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by tag, wire number or text…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
                />
                <span className="hidden shrink-0 text-[11px] text-faint sm:inline">
                  <span className="kbd">J</span> <span className="kbd">K</span> next / previous
                </span>
              </label>
            )}
          </div>
          {r.defects.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="rounded-full bg-emerald-500/15 p-4 text-emerald-500">
                <Check size={32} strokeWidth={3} />
              </div>
              <p className="max-w-xs text-sm text-muted">No defects found. Every expected component and wire label was found.</p>
            </div>
          ) : (
            <ul className="stagger divide-y divide-line overflow-y-auto xl:max-h-[70vh]">
              {defects.map((d, i) => (
                <li
                  key={`${d.code}-${d.item}-${i}`}
                  id={`defect-${i}`}
                  style={{ "--i": Math.min(i, 10) } as CSSProperties}
                  onMouseEnter={() => setHighlight(d.item)}
                  onMouseLeave={() => setHighlight(null)}
                  onClick={() => d.item && togglePin(d.item)}
                  className={`relative cursor-pointer px-4 py-3 transition-colors ${
                    d.item && pinned === d.item ? "bg-sky-500/15" : d.item && active === d.item ? "bg-sky-500/10" : "hover:bg-raised"
                  }`}
                >
                  <span className={`absolute inset-y-0 left-0 w-1 ${severityStyle[d.severity].bar} ${d.item && pinned === d.item ? "" : "opacity-40"}`} />
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={d.severity} />
                    <span className="text-sm font-semibold">{defectTitle(d.code)}</span>
                    {d.item && pinned === d.item && <Crosshair size={14} className="text-sky-500" />}
                    {d.item && <span className="tag ml-auto rounded bg-raised px-1.5 py-0.5 text-xs">{d.item}</span>}
                  </div>
                  <p className="mt-1.5 text-sm text-muted">{d.message}</p>
                  {rowFor(d.code, d.item)?.fix && (
                    <div className="mt-2 flex gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-sm">
                      <Wrench size={15} className="mt-0.5 shrink-0 text-sky-500" />
                      <span>{rowFor(d.code, d.item)!.fix}</span>
                    </div>
                  )}
                  {proofFor(d.code, d.item) && (
                    <img
                      src={snippetUrl(id, proofFor(d.code, d.item)!.snippet as string)}
                      alt={`Proof for ${d.item}`}
                      loading="lazy"
                      className="mt-2 max-h-28 rounded-lg border border-line"
                    />
                  )}
                  {(d.expected || d.actual) && (
                    <div className="mt-1.5 flex gap-4 text-xs text-muted">
                      {d.expected && (
                        <span>
                          expected <b className="tag text-ink">{d.expected}</b>
                        </span>
                      )}
                      {d.actual && (
                        <span>
                          found <b className="tag text-ink">{d.actual}</b>
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {defects.length === 0 && (
                <li className="p-6 text-center text-sm text-muted">
                  No defects match.{" "}
                  <button
                    className="cursor-pointer font-semibold text-sky-500 hover:underline"
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                  >
                    Clear filters
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* ---- fix list: how it should be assembled ---- */}
      {fixes.length > 0 && (
        <div className="card anim-fade-up mt-6 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Wrench size={17} className="text-sky-500" /> How to fix it
          </h2>
          <p className="mb-3 text-xs text-muted">
            What the technician has to do, taken from the drawing and the wire list · click a step to see it on the photo
          </p>
          <ol className="space-y-2">
            {fixes.map((f, n) => (
              <li
                key={f.key}
                onClick={() => togglePin(f.item)}
                onMouseEnter={() => setHighlight(f.item)}
                onMouseLeave={() => setHighlight(null)}
                className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  pinned === f.item ? "border-sky-500 bg-sky-500/10" : "border-line bg-raised hover:border-sky-400/60"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white">{n + 1}</span>
                <span className="flex-1">{f.fix}</span>
                <span className="hidden shrink-0 text-xs text-faint sm:inline">
                  {f.check_title} · row #{f.no}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ---- expected vs found ---- */}
      <div className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="mr-auto flex rounded-lg bg-raised p-0.5 text-sm font-semibold">
            {(
              [
                ...(sheet ? ([["sheet", `QC check sheet (${sheet.length})`]] as const) : []),
                ["components", `Components (${r.components.length})`],
                ["wires", `Wire labels (${r.wire_labels.length})`],
                ["pipeline", "Pipeline"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`cursor-pointer rounded-md px-3 py-1.5 transition ${shownTab === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {(shownTab === "components" || shownTab === "wires") && (
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted">
              <input type="checkbox" className="accent-sky-500" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
              Problems only
            </label>
          )}
        </div>

        {shownTab === "sheet" && sheet && (
          <CheckSheet id={id} sheet={sheet} checks={r.checks ?? []} highlight={highlight} pinned={pinned} onHover={setHighlight} onPin={togglePin} />
        )}

        {shownTab === "components" && (
          <div key="components" className="anim-fade-in overflow-x-auto">
            <table className="w-full">
              <thead className="bg-raised">
                <tr>
                  <th className="th">Tag</th>
                  <th className="th">Expected type (from PDF)</th>
                  <th className="th">Status</th>
                  <th className="th">Read as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {components.map((c) => (
                  <tr
                    key={c.tag}
                    onMouseEnter={() => setHighlight(c.tag)}
                    onMouseLeave={() => setHighlight(null)}
                    onClick={() => togglePin(c.tag)}
                    className={rowClass(c.tag)}
                  >
                    <td className="td tag">{c.tag}</td>
                    <td className="td text-muted" title={c.description}>
                      {humanize(c.type)}
                    </td>
                    <td className="td">
                      <StatusText status={c.status} />
                    </td>
                    <td className="td tag text-muted">{c.read_as ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {components.length === 0 && <p className="p-6 text-center text-sm text-muted">All components are OK.</p>}
          </div>
        )}

        {shownTab === "wires" && (
          <div key="wires" className="anim-fade-in overflow-x-auto">
            {r.wire_labels.length === 0 ? (
              <p className="p-6 text-sm text-muted">Wire label check is disabled in the backend settings.</p>
            ) : (
              <>
                <table className="w-full">
                  <thead className="bg-raised">
                    <tr>
                      <th className="th">Wire (from Excel)</th>
                      <th className="th">Status</th>
                      <th className="th">Read as</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {wires.map((w) => (
                      <tr
                        key={w.label}
                        onMouseEnter={() => setHighlight(w.label)}
                        onMouseLeave={() => setHighlight(null)}
                        onClick={() => togglePin(w.label)}
                        className={rowClass(w.label)}
                      >
                        <td className="td tag">{w.label}</td>
                        <td className="td">
                          <StatusText status={w.status} />
                        </td>
                        <td className="td tag text-muted">{w.read_as ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {wires.length === 0 && <p className="p-6 text-center text-sm text-muted">All wire labels are OK.</p>}
              </>
            )}
          </div>
        )}

        {shownTab === "pipeline" && (
          <div key="pipeline" className="anim-fade-in grid gap-8 p-5 md:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Processing time per step</h3>
                <span className="text-sm font-bold tabular-nums">{(totalMs / 1000).toFixed(1)} s total</span>
              </div>
              <ul className="space-y-2.5">
                {Object.entries(r.timings_ms).map(([step, ms]) => (
                  <li key={step} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3 text-sm">
                    <span className="truncate text-muted">{humanize(step)}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-raised">
                      <div className="anim-grow-x h-full rounded-full bg-linear-to-r from-sky-500 to-indigo-500" style={{ width: `${(ms / maxMs) * 100}%` }} />
                    </div>
                    <span className="text-right font-mono text-xs tabular-nums">{Math.round(ms)} ms</span>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="grid h-fit grid-cols-2 gap-3 text-sm">
              {[
                ["Vision engine", r.engines.vision],
                ["OCR engine", r.engines.ocr],
                ["Components detected", s.detected_components],
                ["Labels read", s.ocr_labels_read],
                ["Expected components", s.expected_components],
                ["Expected wire labels", s.expected_wire_labels],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-line bg-raised px-3 py-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
                  <dd className="mt-0.5 font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {/* ---- history of this cabinet: first inspection and every re-check ---- */}
      {chain && chain.length > 1 && (
        <div className="card mt-6 p-5">
          <h2 className="font-semibold">History of this cabinet</h2>
          <p className="mb-4 text-xs text-muted">Every photo that was checked, from the first inspection to the latest re-check</p>
          <ol className="flex flex-wrap items-stretch gap-2">
            {chain.map((h, i) => (
              <li key={h.id} className="flex items-center gap-2">
                {i > 0 && <ArrowRight size={16} className="text-faint" />}
                <Link
                  to={`/inspections/${h.id}`}
                  className={`block rounded-xl border px-3 py-2 transition hover:-translate-y-0.5 ${
                    h.id === id ? "border-sky-500 bg-sky-500/10" : "border-line bg-raised hover:border-sky-400/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <VerdictBadge verdict={h.verdict} size="sm" />
                    <span className="text-sm font-semibold">{h.round > 1 ? `Re-check ${h.round - 1}` : "First inspection"}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {formatDate(h.created_at)} · {h.score != null ? `${h.score}%` : "–"} · {h.open_issues} open
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}

      {recheckOpen && <RecheckDialog id={id} cabinetName={name} openIssues={openIssues} onClose={() => setRecheckOpen(false)} />}

      {/* ---- footer ---- */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Inspection ID</span>
        <button onClick={copyId} title="Copy ID" className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono hover:text-ink">
          {data.id}
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        </button>
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}
