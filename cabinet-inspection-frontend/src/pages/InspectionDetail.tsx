// Result page: verdict, score, defects (hover = highlight on photo), checks, report.
import { ArrowLeft, Download, FileText, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import InspectionViewer from "../components/InspectionViewer";
import { ErrorState, Loading, ScoreRing, SeverityBadge, StatusText, VerdictBadge, severityStyle } from "../components/ui";
import { deleteInspection, getInspection, reportUrl } from "../lib/api";
import { defectTitle, formatDate, humanize } from "../lib/format";
import type { Severity } from "../lib/types";
import { useApi } from "../lib/useApi";

export default function InspectionDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(() => getInspection(id), [id]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [filter, setFilter] = useState<Severity | "all">("all");

  if (loading) return <Loading label="Loading inspection…" />;
  if (error) return <ErrorState message={error.status === 404 ? "This inspection does not exist (it may have been deleted)." : error.message} onRetry={reload} />;
  if (!data) return null;

  async function remove() {
    if (!window.confirm("Delete this inspection and its files?")) return;
    await deleteInspection(id);
    navigate("/history");
  }

  const header = (
    <Link to="/history" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
      <ArrowLeft size={16} /> All inspections
    </Link>
  );

  // inspection that crashed (unreadable PDF etc.)
  if (data.status !== "completed" || !data.result) {
    return (
      <>
        {header}
        <div className="card flex gap-4 p-6">
          <TriangleAlert className="shrink-0 text-red-500" size={28} />
          <div>
            <h1 className="text-lg font-bold">Inspection could not be completed</h1>
            <p className="mt-1 text-sm text-slate-600">{data.error ?? "Unknown error."}</p>
            <p className="mt-3 text-xs text-slate-400">{formatDate(data.created_at)} · {data.id}</p>
            <button className="btn btn-danger mt-4" onClick={remove}>
              <Trash2 size={16} /> Delete record
            </button>
          </div>
        </div>
      </>
    );
  }

  const r = data.result;
  const s = r.summary;
  const defects = r.defects.filter((d) => filter === "all" || d.severity === filter);

  return (
    <>
      {header}

      {/* ---- summary bar ---- */}
      <div className="card mb-6 flex flex-wrap items-center gap-6 p-6">
        <ScoreRing score={r.score} />
        <div className="min-w-48 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge verdict={r.verdict} size="lg" />
            <div>
              <h1 className="text-xl font-bold">{data.cabinet_name || "Unnamed cabinet"}</h1>
              <p className="text-sm text-slate-500">{formatDate(data.created_at)}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {s.checks_passed} of {s.checks_total} checks passed ·{" "}
            {r.verdict === "PASS"
              ? "the cabinet matches the drawing and wiring list."
              : `${s.critical + s.major} issue${s.critical + s.major === 1 ? "" : "s"} must be fixed before approval.`}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          {(["critical", "major", "minor"] as const).map((sev) => (
            <div key={sev} className="rounded-lg bg-slate-50 px-4 py-2">
              <div className={`text-2xl font-bold tabular-nums ${s[sev] ? severityStyle[sev].text : "text-slate-300"}`}>{s[sev]}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{sev}</div>
            </div>
          ))}
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:flex-col">
          <a href={reportUrl(id)} target="_blank" rel="noreferrer" className="btn btn-primary">
            <FileText size={16} /> Open PDF report
          </a>
          <a href={reportUrl(id, true)} className="btn btn-ghost">
            <Download size={16} /> Download
          </a>
          <button className="btn btn-danger" onClick={remove}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </div>

      {/* ---- photo + defects ---- */}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <InspectionViewer id={id} result={r} highlight={highlight} onSelect={setHighlight} />

        <div className="card flex flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
            <h2 className="mr-auto font-semibold">Defects ({r.defects.length})</h2>
            {(["all", "critical", "major", "minor"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                  filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {r.defects.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
              <VerdictBadge verdict="PASS" />
              <p className="text-sm text-slate-600">No defects found. Every expected component and wire label was found.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-y-auto xl:max-h-[70vh]">
              {defects.map((d, i) => (
                <li
                  key={`${d.code}-${d.item}-${i}`}
                  onMouseEnter={() => setHighlight(d.item)}
                  onMouseLeave={() => setHighlight(null)}
                  className={`cursor-default px-4 py-3 transition ${highlight === d.item ? "bg-sky-50" : "hover:bg-slate-50"}`}
                >
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={d.severity} />
                    <span className="text-sm font-semibold">{defectTitle(d.code)}</span>
                    {d.item && <span className="tag ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-xs">{d.item}</span>}
                  </div>
                  <p className="mt-1.5 text-sm text-slate-600">{d.message}</p>
                  {(d.expected || d.actual) && (
                    <div className="mt-1.5 flex gap-4 text-xs text-slate-500">
                      {d.expected && (
                        <span>
                          expected <b className="tag text-slate-700">{d.expected}</b>
                        </span>
                      )}
                      {d.actual && (
                        <span>
                          found <b className="tag text-slate-700">{d.actual}</b>
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {defects.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No {filter} defects.</li>}
            </ul>
          )}
        </div>
      </div>

      {/* ---- expected vs found tables ---- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Components (from PDF)</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Tag</th>
                  <th className="th">Expected type</th>
                  <th className="th">Status</th>
                  <th className="th">Read as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.components.map((c) => (
                  <tr
                    key={c.tag}
                    onMouseEnter={() => setHighlight(c.tag)}
                    onMouseLeave={() => setHighlight(null)}
                    className={highlight === c.tag ? "bg-sky-50" : ""}
                  >
                    <td className="td tag">{c.tag}</td>
                    <td className="td text-slate-600" title={c.description}>
                      {humanize(c.type)}
                    </td>
                    <td className="td">
                      <StatusText status={c.status} />
                    </td>
                    <td className="td tag text-slate-500">{c.read_as ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Wire labels (from Excel)</h2>
          {r.wire_labels.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">Wire label check is disabled in the backend settings.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Wire</th>
                    <th className="th">Status</th>
                    <th className="th">Read as</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.wire_labels.map((w) => (
                    <tr
                      key={w.label}
                      onMouseEnter={() => setHighlight(w.label)}
                      onMouseLeave={() => setHighlight(null)}
                      className={highlight === w.label ? "bg-sky-50" : ""}
                    >
                      <td className="td tag">{w.label}</td>
                      <td className="td">
                        <StatusText status={w.status} />
                      </td>
                      <td className="td tag text-slate-500">{w.read_as ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---- technical details ---- */}
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
        <span>
          Vision: <b>{r.engines.vision}</b>
        </span>
        <span>
          OCR: <b>{r.engines.ocr}</b>
        </span>
        <span>
          Components detected: <b>{s.detected_components}</b>
        </span>
        <span>
          Labels read: <b>{s.ocr_labels_read}</b>
        </span>
        <span>
          Processing time: <b>{(Object.values(r.timings_ms).reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s</b>
        </span>
        <span className="font-mono">ID {data.id}</span>
      </div>
    </>
  );
}
