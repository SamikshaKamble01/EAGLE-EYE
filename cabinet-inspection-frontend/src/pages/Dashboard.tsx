// Overview: totals, pass/fail donut, score trend, most common defects, latest inspections.
import { Activity, ArrowRight, CircleCheck, CircleX, ClipboardList, Gauge, RefreshCw, ScanLine } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Donut, TrendChart, type TrendPoint } from "../components/charts";
import { ErrorState, PageHeader, ScoreBar, SeverityBadge, Skeleton, StatCard, VerdictBadge, severityStyle } from "../components/ui";
import { getStats, listInspections } from "../lib/api";
import { defectTitle, formatDate, timeAgo } from "../lib/format";
import { useApi } from "../lib/useApi";

const REFRESH_MS = 10_000;
const TREND_POINTS = 30;

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(() => getStats(), []);
  const { data: list, reload: reloadList } = useApi(() => listInspections({ limit: TREND_POINTS }), []);
  const [live, setLive] = useState(true);

  // live mode: re-fetch quietly so new inspections appear without pressing F5
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      reload();
      reloadList();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [live, reload, reloadList]);

  const trend = useMemo<TrendPoint[]>(
    () =>
      (list?.items ?? [])
        .filter((i) => i.score != null)
        .map((i) => ({ id: i.id, label: i.cabinet_name || "Unnamed cabinet", date: formatDate(i.created_at), score: i.score as number, verdict: i.verdict }))
        .reverse(),
    [list],
  );

  const newButton = (
    <Link to="/inspect" className="btn btn-primary">
      <ScanLine size={18} /> New inspection
    </Link>
  );

  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return null;

  if (data.total === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="card relative flex flex-col items-center gap-4 overflow-hidden px-6 py-20 text-center">
          <div className="pointer-events-none absolute -top-24 h-64 w-64 rounded-full bg-sky-500/20 blur-3xl" />
          <div className="relative rounded-2xl bg-sky-500/15 p-4 text-sky-500">
            <ScanLine size={36} />
          </div>
          <h2 className="text-lg font-bold">No inspections yet</h2>
          <p className="max-w-md text-sm text-muted">
            Upload a cabinet photo with its drawing PDF and wiring Excel. The system checks every component and wire label and tells
            you exactly what is missing or wrong.
          </p>
          {newButton}
        </div>
      </>
    );
  }

  const maxCount = Math.max(1, ...data.defects_by_code.map((d) => d.count));
  const sevTotal = data.defects_by_severity.critical + data.defects_by_severity.major + data.defects_by_severity.minor;
  const decimals = (n: number) => (Number.isInteger(n) ? 0 : 1);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Quality overview of all cabinet inspections"
        actions={
          <>
            <button
              onClick={() => setLive((v) => !v)}
              title={live ? "Auto-refresh every 10 seconds is on" : "Auto-refresh is off"}
              className={`btn px-3 ${live ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "btn-ghost"}`}
            >
              <span className="relative flex h-2 w-2">
                {live && <span className="ping-soft absolute inline-flex h-full w-full rounded-full bg-emerald-500" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-slate-400"}`} />
              </span>
              Live
            </button>
            <button
              className="btn btn-ghost px-3"
              title="Refresh now"
              aria-label="Refresh now"
              onClick={() => {
                reload();
                reloadList();
              }}
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            {newButton}
          </>
        }
      />

      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div style={{ "--i": 0 } as CSSProperties}>
          <StatCard
            label="Inspections"
            value={data.total}
            icon={ClipboardList}
            hint={data.errored ? `${data.errored} could not be processed` : "all processed"}
            onClick={() => navigate("/history")}
          />
        </div>
        <div style={{ "--i": 1 } as CSSProperties}>
          <StatCard
            label="Pass rate"
            value={data.pass_rate}
            decimals={decimals(data.pass_rate)}
            suffix="%"
            icon={CircleCheck}
            tone="emerald"
            accent={data.pass_rate >= 80 ? "text-emerald-500" : data.pass_rate >= 50 ? "text-amber-500" : "text-red-500"}
            hint={`${data.passed} passed`}
            onClick={() => navigate("/history?verdict=PASS")}
          />
        </div>
        <div style={{ "--i": 2 } as CSSProperties}>
          <StatCard
            label="Failed"
            value={data.failed}
            icon={CircleX}
            tone="red"
            accent={data.failed ? "text-red-500" : ""}
            hint="need rework"
            onClick={() => navigate("/history?verdict=FAIL")}
          />
        </div>
        <div style={{ "--i": 3 } as CSSProperties}>
          <StatCard
            label="Average score"
            value={data.avg_score}
            decimals={decimals(data.avg_score)}
            suffix="%"
            icon={Gauge}
            tone="amber"
            hint="checks passed per inspection"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.7fr]">
        {/* outcome donut */}
        <div className="card p-5">
          <h2 className="font-semibold">Outcomes</h2>
          <p className="mb-4 text-xs text-muted">Click a slice to open those inspections</p>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <Donut
              segments={[
                { key: "PASS", label: "Passed", value: data.passed, color: "#10b981" },
                { key: "FAIL", label: "Failed", value: data.failed, color: "#ef4444" },
                { key: "ERROR", label: "Errors", value: data.errored, color: "#94a3b8" },
              ]}
              onSelect={(key) => navigate(`/history?verdict=${key}`)}
              center={
                <>
                  <span className="text-3xl font-bold tabular-nums">{data.pass_rate}%</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">pass rate</span>
                </>
              }
            />
            <ul className="space-y-2 text-sm">
              {[
                { key: "PASS", label: "Passed", value: data.passed, dot: "bg-emerald-500" },
                { key: "FAIL", label: "Failed", value: data.failed, dot: "bg-red-500" },
                { key: "ERROR", label: "Errors", value: data.errored, dot: "bg-slate-400" },
              ].map((row) => (
                <li key={row.key}>
                  <Link to={`/history?verdict=${row.key}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-raised">
                    <span className={`h-2.5 w-2.5 rounded-full ${row.dot}`} />
                    <span className="w-14 text-muted">{row.label}</span>
                    <span className="font-semibold tabular-nums">{row.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* score trend */}
        <div className="card p-5">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <Activity size={17} className="text-sky-500" /> Score trend
              </h2>
              <p className="text-xs text-muted">Last {trend.length} scored inspection{trend.length === 1 ? "" : "s"}, oldest to newest · click a point to open it</p>
            </div>
          </div>
          {trend.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">No scored inspections yet.</p>
          ) : (
            <TrendChart points={trend} onSelect={(id) => navigate(`/inspections/${id}`)} />
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* most common defects */}
        <div className="card p-5">
          <h2 className="font-semibold">Most common defects</h2>
          <p className="mb-5 text-xs text-muted">Where wiring and assembly go wrong most often</p>
          {data.defects_by_code.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No defects recorded — every inspection passed.</p>
          ) : (
            <ul className="space-y-3.5">
              {data.defects_by_code.map((d, i) => (
                <li key={`${d.code}-${d.severity}`} className="group">
                  <div className="mb-1 flex items-center gap-2 text-sm">
                    <SeverityBadge severity={d.severity} />
                    <span className="font-medium">{defectTitle(d.code)}</span>
                    <span className="ml-auto font-semibold tabular-nums">{d.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-raised">
                    <div
                      className={`anim-grow-x h-full rounded-full transition-[filter] group-hover:brightness-125 ${severityStyle[d.severity].bar}`}
                      style={{ width: `${(d.count / maxCount) * 100}%`, animationDelay: `${i * 80}ms` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {sevTotal > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">By severity</div>
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                {(["critical", "major", "minor"] as const).map((s) =>
                  data.defects_by_severity[s] ? (
                    <div
                      key={s}
                      className={`${severityStyle[s].bar} transition-[filter] hover:brightness-125`}
                      style={{ width: `${(data.defects_by_severity[s] / sevTotal) * 100}%` }}
                      title={`${s}: ${data.defects_by_severity[s]}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-2 flex gap-4 text-xs text-muted">
                {(["critical", "major", "minor"] as const).map((s) => (
                  <span key={s} className="flex items-center gap-1.5 capitalize">
                    <span className={`h-2 w-2 rounded-full ${severityStyle[s].bar}`} />
                    {s} {data.defects_by_severity[s]}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* recent */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">Latest inspections</h2>
            <Link to="/history" className="group flex items-center gap-1 text-sm font-medium text-sky-500 hover:text-sky-400">
              View all <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {data.recent.map((i) => (
              <li
                key={i.id}
                onClick={() => navigate(`/inspections/${i.id}`)}
                className="group flex cursor-pointer items-center gap-3 px-5 py-3.5 transition-colors hover:bg-raised"
              >
                <VerdictBadge verdict={i.verdict} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.cabinet_name || "Unnamed cabinet"}</div>
                  <div className="text-xs text-muted" title={formatDate(i.created_at)}>
                    {timeAgo(i.created_at)}
                  </div>
                </div>
                <ScoreBar score={i.score} />
                <ArrowRight size={15} className="text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <Skeleton className="mb-6 h-9 w-48" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.7fr]">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
