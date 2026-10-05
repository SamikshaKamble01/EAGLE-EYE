// All inspections: filter PASS/FAIL, paginate, open, delete.
import { ChevronLeft, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ErrorState, Loading, PageHeader, VerdictBadge } from "../components/ui";
import { deleteInspection, listInspections } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Verdict } from "../lib/types";
import { useApi } from "../lib/useApi";

const PAGE_SIZE = 10;

export default function History() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const verdict = (params.get("verdict") ?? "") as Verdict | "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const { data, loading, error, reload } = useApi(
    () => listInspections({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, verdict }),
    [verdict, page],
  );

  const setQuery = (next: { verdict?: string; page?: number }) => {
    const q = new URLSearchParams(params);
    if (next.verdict !== undefined) {
      if (next.verdict) q.set("verdict", next.verdict);
      else q.delete("verdict");
      q.delete("page");
    }
    if (next.page !== undefined) q.set("page", String(next.page));
    setParams(q);
  };

  async function remove(id: string) {
    if (!window.confirm("Delete this inspection and its files?")) return;
    await deleteInspection(id);
    reload();
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Inspection history"
        subtitle="Every inspection is stored in the database with its report"
        actions={
          <button className="btn btn-ghost" onClick={reload}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      <div className="mb-4 flex gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200 w-fit">
        {[
          { v: "", label: "All" },
          { v: "PASS", label: "Passed" },
          { v: "FAIL", label: "Failed" },
        ].map((f) => (
          <button
            key={f.v}
            onClick={() => setQuery({ verdict: f.v })}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${verdict === f.v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : data && data.items.length === 0 ? (
        <div className="card px-6 py-16 text-center text-sm text-slate-500">No inspections {verdict ? `with verdict ${verdict}` : "yet"}.</div>
      ) : data ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Cabinet</th>
                  <th className="th">Verdict</th>
                  <th className="th text-right">Score</th>
                  <th className="th">ID</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className={`divide-y divide-slate-100 ${loading ? "opacity-50" : ""}`}>
                {data.items.map((i) => (
                  <tr key={i.id} onClick={() => navigate(`/inspections/${i.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="td whitespace-nowrap text-slate-600">{formatDate(i.created_at)}</td>
                    <td className="td font-medium">{i.cabinet_name || <span className="text-slate-400">Unnamed</span>}</td>
                    <td className="td">
                      <VerdictBadge verdict={i.verdict} size="sm" />
                    </td>
                    <td className="td text-right font-semibold tabular-nums">{i.score != null ? `${i.score}%` : "–"}</td>
                    <td className="td font-mono text-xs text-slate-400">{i.id.slice(0, 8)}</td>
                    <td className="td text-right">
                      <button
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(i.id);
                        }}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              {data.total} inspection{data.total === 1 ? "" : "s"} · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <button className="btn btn-ghost px-2.5 py-1.5" disabled={page <= 1} onClick={() => setQuery({ page: page - 1 })}>
                <ChevronLeft size={16} />
              </button>
              <button className="btn btn-ghost px-2.5 py-1.5" disabled={page >= pages} onClick={() => setQuery({ page: page + 1 })}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
