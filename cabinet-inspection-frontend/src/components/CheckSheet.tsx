// The QC check sheet: every check as a row with PASS / FAIL, expected vs found,
// and a zoomed proof picture for every FAIL. Click a row to find it on the photo.
import { Crosshair, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { snippetUrl } from "../lib/api";
import type { CheckSummary, ChecklistItem } from "../lib/types";

interface Props {
  id: string;
  sheet: ChecklistItem[];
  checks: CheckSummary[];
  highlight: string | null;
  pinned: string | null;
  onHover: (item: string | null) => void;
  onPin: (item: string) => void;
}

const resultStyle = {
  PASS: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  FAIL: "bg-red-500/15 text-red-600 dark:text-red-400",
  WARN: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const changeStyle = {
  closed: { label: "Closed", cls: "bg-emerald-500 text-white" },
  open: { label: "Still open", cls: "bg-red-500 text-white" },
  new: { label: "New", cls: "bg-amber-500 text-white" },
};

type ResultFilter = "all" | "FAIL" | "PASS";

export default function CheckSheet({ id, sheet, checks, highlight, pinned, onHover, onPin }: Props) {
  const [result, setResult] = useState<ResultFilter>("all");
  const [check, setCheck] = useState<string>("all");
  const [zoom, setZoom] = useState<ChecklistItem | null>(null);

  const rows = useMemo(
    () =>
      sheet.filter(
        (i) => (check === "all" || i.check === check) && (result === "all" || (result === "FAIL" ? i.result !== "PASS" : i.result === "PASS")),
      ),
    [sheet, check, result],
  );
  const passed = sheet.filter((i) => i.result === "PASS").length;
  const hasChanges = sheet.some((i) => i.change);
  const active = highlight ?? pinned;

  return (
    <div className="anim-fade-in">
      {/* one tile per plug-in check */}
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 sm:grid-cols-4">
        {checks
          .filter((c) => c.passed + c.failed + c.warnings > 0)
          .map((c) => (
            <button
              key={c.id}
              onClick={() => setCheck((v) => (v === c.id ? "all" : c.id))}
              className={`cursor-pointer rounded-xl border px-3 py-2.5 text-left transition hover:-translate-y-0.5 ${
                check === c.id ? "border-sky-500 bg-sky-500/10" : "border-line bg-raised"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{c.title}</span>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.failed ? "bg-red-500" : c.warnings ? "bg-amber-500" : "bg-emerald-500"}`} />
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {c.failed ? <b className="text-red-500">{c.failed} failed</b> : c.warnings ? `${c.warnings} note${c.warnings === 1 ? "" : "s"}` : "all passed"}
                {c.passed > 0 && ` · ${c.passed} passed`}
              </div>
            </button>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        {(
          [
            ["all", `All ${sheet.length}`],
            ["FAIL", `Not passed ${sheet.length - passed}`],
            ["PASS", `Pass ${passed}`],
          ] as const
        ).map(([key, label]) => (
          <button key={key} onClick={() => setResult(key)} className={`chip normal-case ${result === key ? "chip-on" : "chip-off"}`}>
            {label}
          </button>
        ))}
        {check !== "all" && (
          <button onClick={() => setCheck("all")} className="chip chip-off flex items-center gap-1 normal-case">
            {checks.find((c) => c.id === check)?.title} <X size={12} />
          </button>
        )}
        <span className="ml-auto hidden text-xs text-faint sm:inline">Click a row to find it on the photo</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-raised">
            <tr>
              <th className="th w-10">#</th>
              <th className="th">Check</th>
              <th className="th">Item</th>
              <th className="th">Expected (drawing)</th>
              <th className="th">Found (photo)</th>
              <th className="th">Result</th>
              <th className="th">Proof</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((i) => (
              <tr
                key={i.key}
                onMouseEnter={() => onHover(i.item)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onPin(i.item)}
                className={`cursor-pointer align-top transition-colors ${
                  pinned === i.item ? "bg-sky-500/15" : active === i.item ? "bg-sky-500/10" : i.result === "FAIL" ? "bg-red-500/5 hover:bg-red-500/10" : "hover:bg-raised"
                }`}
              >
                <td className="td tabular-nums text-faint">{i.no}</td>
                <td className="td whitespace-nowrap text-muted">{i.check_title}</td>
                <td className="td">
                  <div className="tag flex items-center gap-1.5">
                    {i.item}
                    {pinned === i.item && <Crosshair size={13} className="text-sky-500" />}
                  </div>
                  <div className="mt-0.5 max-w-64 text-xs text-muted">{i.description}</div>
                </td>
                <td className="td tag text-muted">{i.expected}</td>
                <td className={`td tag ${i.result === "FAIL" ? "text-red-500" : ""}`}>{i.found}</td>
                <td className="td">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-extrabold ${resultStyle[i.result]}`}>{i.result}</span>
                  {i.change && (
                    <span className={`ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${changeStyle[i.change].cls}`}>
                      {changeStyle[i.change].label}
                    </span>
                  )}
                  {i.result !== "PASS" && i.message && <div className="mt-1 max-w-72 text-xs text-muted">{i.message}</div>}
                  {i.fix && (
                    <div className="mt-1.5 flex max-w-72 gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400">
                      <Wrench size={13} className="mt-0.5 shrink-0" /> {i.fix}
                    </div>
                  )}
                </td>
                <td className="td">
                  {i.snippet ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setZoom(i);
                      }}
                      title="Enlarge the proof picture"
                      className="block cursor-zoom-in overflow-hidden rounded-lg border border-line transition hover:border-sky-400 hover:shadow-lg"
                    >
                      <img src={snippetUrl(id, i.snippet)} alt={`Proof for ${i.item}`} loading="lazy" className="h-16 w-28 object-cover" />
                    </button>
                  ) : (
                    <span className="text-faint">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted">No rows match these filters.</p>}
      </div>
      {hasChanges && (
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Closed / Still open / New compare this re-check with the inspection before the fix.
        </p>
      )}

      {zoom && <ProofDialog id={id} item={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

/** Large proof picture with expected vs found. */
function ProofDialog({ id, item, onClose }: { id: string; item: ChecklistItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="card anim-scale-in max-h-[92vh] w-full max-w-2xl overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <span className={`rounded-md px-2 py-0.5 text-xs font-extrabold ${resultStyle[item.result]}`}>{item.result}</span>
          <h2 className="font-semibold">
            #{item.no} {item.check_title} · <span className="tag">{item.item}</span>
          </h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto cursor-pointer rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="bg-slate-950 p-3">
          <img src={snippetUrl(id, item.snippet as string)} alt={`Proof for ${item.item}`} className="mx-auto max-h-[55vh] rounded" />
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-raised px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Expected (drawing)</div>
            <div className="tag mt-0.5">{item.expected}</div>
          </div>
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Found (photo)</div>
            <div className="tag mt-0.5 text-red-500">{item.found}</div>
          </div>
          <p className="text-sm text-muted sm:col-span-2">
            {item.message}
            {item.bbox_estimated && " The box marks the place where it was expected."}
          </p>
          {item.fix && (
            <div className="flex gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm sm:col-span-2">
              <Wrench size={16} className="mt-0.5 shrink-0 text-sky-500" />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">How to fix</div>
                {item.fix}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
