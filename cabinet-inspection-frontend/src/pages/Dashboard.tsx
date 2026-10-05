// Overview: totals, pass rate, most common defects, latest inspections.
import { ArrowRight, ScanLine } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ErrorState, Loading, PageHeader, SeverityBadge, StatCard, VerdictBadge, severityStyle } from "../components/ui";
import { getStats } from "../lib/api";
import { defectTitle, timeAgo } from "../lib/format";
import { useApi } from "../lib/useApi";

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(() => getStats(), []);

  const newButton = (
    <Link to="/inspect" className="btn btn-primary">
      <ScanLine size={18} /> New inspection
    </Link>
  );

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return null;

  if (data.total === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="card flex flex-col items-center gap-4 px-6 py-20 text-center">
          <div className="rounded-2xl bg-sky-100 p-4 text-sky-600">
            <ScanLine size={36} />
          </div>
          <h2 className="text-lg font-bold">No inspections yet</h2>
          <p className="max-w-md text-sm text-slate-500">
            Upload a cabinet photo with its drawing PDF and wiring Excel. The system checks every component and wire label and
            tells you exactly what is missing or wrong.
          </p>
          {newButton}
        </div>
      </>
    );
  }

  const maxCount = Math.max(1, ...data.defects_by_code.map((d) => d.count));
  const sevTotal = data.defects_by_severity.critical + data.defects_by_severity.major + data.defects_by_severity.minor;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Quality overview of all cabinet inspections" actions={newButton} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Inspections" value={data.total} hint={data.errored ? `${data.errored} could not be processed` : "all processed"} />
        <StatCard
          label="Pass rate"
          value={`${data.pass_rate}%`}
          accent={data.pass_rate >= 80 ? "text-emerald-600" : data.pass_rate >= 50 ? "text-amber-600" : "text-red-600"}
          hint={`${data.passed} passed`}
        />
        <StatCard label="Failed" value={data.failed} accent={data.failed ? "text-red-600" : "text-slate-900"} hint="need rework" />
        <StatCard label="Average score" value={`${data.avg_score}%`} hint="checks passed per inspection" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* most common defects */}
        <div className="card p-5">
          <h2 className="font-semibold">Most common defects</h2>
          <p className="mb-5 text-xs text-slate-500">Where wiring and assembly go wrong most often</p>
          {data.defects_by_code.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No defects recorded — every inspection passed.</p>
          ) : (
            <ul className="space-y-3.5">
              {data.defects_by_code.map((d) => (
                <li key={`${d.code}-${d.severity}`}>
                  <div className="mb-1 flex items-center gap-2 text-sm">
                    <SeverityBadge severity={d.severity} />
                    <span className="font-medium">{defectTitle(d.code)}</span>
                    <span className="ml-auto font-semibold tabular-nums">{d.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${severityStyle[d.severity].bar}`}
                      style={{ width: `${(d.count / maxCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {sevTotal > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">By severity</div>
              <div className="flex h-3 overflow-hidden rounded-full">
                {(["critical", "major", "minor"] as const).map((s) =>
                  data.defects_by_severity[s] ? (
                    <div
                      key={s}
                      className={severityStyle[s].bar}
                      style={{ width: `${(data.defects_by_severity[s] / sevTotal) * 100}%` }}
                      title={`${s}: ${data.defects_by_severity[s]}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-2 flex gap-4 text-xs text-slate-600">
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
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold">Latest inspections</h2>
            <Link to="/history" className="flex items-center gap-1 text-sm font-medium text-sky-600 hover:text-sky-700">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.recent.map((i) => (
              <li
                key={i.id}
                onClick={() => navigate(`/inspections/${i.id}`)}
                className="flex cursor-pointer items-center gap-3 px-5 py-3.5 hover:bg-slate-50"
              >
                <VerdictBadge verdict={i.verdict} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.cabinet_name || "Unnamed cabinet"}</div>
                  <div className="text-xs text-slate-500">{timeAgo(i.created_at)}</div>
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-600">{i.score != null ? `${i.score}%` : "–"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
