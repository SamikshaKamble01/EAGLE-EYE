// Pop-up opened from the "Average score" card: score of every inspection as a bar chart,
// the average as a dashed line, and how the scores are spread.
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TrendPoint } from "./charts";
import { scoreColor } from "./ui";

interface Props {
  points: TrendPoint[]; // oldest first
  average: number;
  onClose: () => void;
  onSelect: (id: string) => void;
}

const BUCKETS = [
  { label: "100%", test: (s: number) => s >= 100, color: "#10b981" },
  { label: "75 – 99%", test: (s: number) => s >= 75 && s < 100, color: "#f59e0b" },
  { label: "50 – 74%", test: (s: number) => s >= 50 && s < 75, color: "#f97316" },
  { label: "Below 50%", test: (s: number) => s < 50, color: "#ef4444" },
];

export default function ScoreBreakdown({ points, average, onClose, onSelect }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scores = points.map((p) => p.score);
  const best = scores.length ? Math.max(...scores) : 0;
  const worst = scores.length ? Math.min(...scores) : 0;
  const buckets = BUCKETS.map((b) => ({ ...b, count: scores.filter(b.test).length }));
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));
  const active = hover !== null ? points[hover] : null;

  // rendered on <body> so it covers the whole window, sidebar included
  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Score breakdown"
        className="card anim-scale-in max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">Score breakdown</h2>
            <p className="text-sm text-muted">
              Last {points.length} scored inspection{points.length === 1 ? "" : "s"}, oldest to newest · click a bar to open it
            </p>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-3 text-center">
          {[
            ["Average", average],
            ["Best", best],
            ["Lowest", worst],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-raised px-3 py-2.5">
              <div className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(value as number) }}>
                {value}%
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
            </div>
          ))}
        </div>

        {points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No scored inspections yet.</p>
        ) : (
          <>
            {/* bar chart */}
            <div className="flex gap-2">
              <div className="flex h-56 w-8 flex-col justify-between text-right text-[10px] tabular-nums text-faint">
                <span>100</span>
                <span>75</span>
                <span>50</span>
                <span>25</span>
                <span>0</span>
              </div>
              <div className="relative h-56 flex-1">
                {[0, 25, 50, 75, 100].map((v) => (
                  <div key={v} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${v}%` }} />
                ))}
                <div className="absolute inset-0 flex items-end justify-center gap-1.5 sm:gap-2.5">
                  {points.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-label={`${p.label}: ${p.score}%`}
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      onClick={() => onSelect(p.id)}
                      className="group relative flex h-full max-w-14 flex-1 cursor-pointer items-end"
                    >
                      <span
                        className="w-full origin-bottom rounded-t-md transition-[filter,opacity] group-hover:brightness-125"
                        style={{
                          height: `${Math.max(p.score, 1.5)}%`,
                          background: scoreColor(p.score),
                          opacity: hover !== null && hover !== i ? 0.45 : 1,
                          animation: `grow-y .7s cubic-bezier(.2,.7,.2,1) ${i * 40}ms both`,
                        }}
                      />
                    </button>
                  ))}
                </div>
                {/* average line */}
                <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-sky-400" style={{ bottom: `${average}%` }}>
                  <span className="absolute -top-5 right-0 rounded bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold text-white">avg {average}%</span>
                </div>
              </div>
            </div>

            <div className="mt-3 h-10 rounded-lg border border-line bg-raised px-3 py-2 text-sm">
              {active ? (
                <span className="flex flex-wrap items-center gap-x-3">
                  <b>{active.label}</b>
                  <span className={`font-bold ${active.verdict === "PASS" ? "text-emerald-500" : "text-red-500"}`}>{active.verdict}</span>
                  <span className="tabular-nums">{active.score}%</span>
                  <span className="text-muted">{active.date}</span>
                </span>
              ) : (
                <span className="text-muted">Hover a bar to see the inspection.</span>
              )}
            </div>

            {/* distribution */}
            <h3 className="mb-3 mt-6 text-sm font-semibold">How the scores are spread</h3>
            <ul className="space-y-2.5">
              {buckets.map((b) => (
                <li key={b.label} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3 text-sm">
                  <span className="text-muted">{b.label}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-raised">
                    <div className="anim-grow-x h-full rounded-full" style={{ width: `${(b.count / maxBucket) * 100}%`, background: b.color }} />
                  </div>
                  <span className="text-right font-semibold tabular-nums">{b.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
