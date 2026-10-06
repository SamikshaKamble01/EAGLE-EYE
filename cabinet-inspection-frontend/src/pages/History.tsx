// All inspections: search, filter, sort, select several, export, delete.
// The latest 100 are loaded once; searching and sorting then happen instantly in the browser.
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, RefreshCw, ScanLine, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useFeedback } from "../components/Feedback";
import { ErrorState, PageHeader, ScoreBar, Skeleton, VerdictBadge } from "../components/ui";
import { deleteInspection, listInspections } from "../lib/api";
import { downloadCsv } from "../lib/export";
import { formatDate, timeAgo } from "../lib/format";
import type { InspectionSummary } from "../lib/types";
import { useApi } from "../lib/useApi";

const PAGE_SIZE = 10;
const LOAD_LIMIT = 100; // backend maximum per request

type Filter = "" | "PASS" | "FAIL" | "ERROR";
type SortKey = "created_at" | "cabinet_name" | "score";

const FILTERS: { v: Filter; label: string }[] = [
  { v: "", label: "All" },
  { v: "PASS", label: "Passed" },
  { v: "FAIL", label: "Failed" },
  { v: "ERROR", label: "Errors" },
];

const matchesFilter = (i: InspectionSummary, f: Filter) => (f === "" ? true : f === "ERROR" ? i.verdict === null : i.verdict === f);

export default function History() {
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();
  const raw = (params.get("verdict") ?? "").toUpperCase();
  const filter: Filter = raw === "PASS" || raw === "FAIL" || raw === "ERROR" ? raw : "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, loading, error, reload } = useApi(() => listInspections({ limit: LOAD_LIMIT }), []);

  const setQueryParams = (next: { verdict?: Filter; page?: number }) => {
    const q = new URLSearchParams(params);
    if (next.verdict !== undefined) {
      if (next.verdict) q.set("verdict", next.verdict);
      else q.delete("verdict");
      q.delete("page");
    }
    if (next.page !== undefined) {
      if (next.page > 1) q.set("page", String(next.page));
      else q.delete("page");
    }
    setParams(q);
  };

  const all = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.v, all.filter((i) => matchesFilter(i, f.v)).length])), [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter(
      (i) => matchesFilter(i, filter) && (!q || (i.cabinet_name ?? "").toLowerCase().includes(q) || i.id.toLowerCase().includes(q)),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "score") return ((a.score ?? -1) - (b.score ?? -1)) * dir;
      if (sort.key === "cabinet_name") return (a.cabinet_name ?? "").localeCompare(b.cabinet_name ?? "") * dir;
      return a.created_at.localeCompare(b.created_at) * dir;
    });
  }, [all, filter, query, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  // drop selections that are no longer in the list (deleted / reloaded)
  useEffect(() => {
    setSelected((sel) => {
      const kept = new Set([...sel].filter((id) => all.some((i) => i.id === id)));
      return kept.size === sel.size ? sel : kept;
    });
  }, [all]);

  const toggle = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePage = () =>
    setSelected((sel) => {
      const next = new Set(sel);
      for (const i of visible) {
        if (allVisibleSelected) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });

  async function remove(ids: string[]) {
    const many = ids.length > 1;
    const ok = await confirm({
      title: many ? `Delete ${ids.length} inspections?` : "Delete this inspection?",
      message: "The records, photos and PDF reports are removed permanently.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => deleteInspection(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) toast(`${failed} of ${ids.length} could not be deleted`, "error");
    else toast(many ? `${ids.length} inspections deleted` : "Inspection deleted");
    setSelected(new Set());
    reload();
  }

  function exportCsv() {
    const list = selected.size ? rows.filter((i) => selected.has(i.id)) : rows;
    downloadCsv("inspections.csv", [
      ["Date", "Cabinet", "Verdict", "Score", "Status", "ID"],
      ...list.map((i) => [i.created_at, i.cabinet_name, i.verdict ?? "ERROR", i.score, i.status, i.id]),
    ]);
    toast(`Exported ${list.length} row${list.length === 1 ? "" : "s"} as CSV`);
  }

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "cabinet_name" ? "asc" : "desc" }));

  const sortHeader = (k: SortKey, label: string, right = false) => (
    <th key={k} className={`th ${right ? "text-right!" : ""}`}>
      <button onClick={() => sortBy(k)} className={`inline-flex cursor-pointer items-center gap-1 uppercase tracking-wider hover:text-ink ${sort.key === k ? "text-ink" : ""}`}>
        {label}
        {sort.key === k && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        title="Inspection history"
        subtitle="Every inspection is stored in the database with its report"
        actions={
          <>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length}>
              <Download size={16} /> Export CSV
            </button>
            <button className="btn btn-ghost" onClick={reload} title="Reload from the backend">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex w-fit gap-1 rounded-xl border border-line bg-surface p-1 shadow-sm">
          {FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => setQueryParams({ verdict: f.v })}
              className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                filter === f.v ? "bg-ink text-surface shadow" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              {f.label}
              {data && <span className="ml-1.5 text-xs opacity-60">{counts[f.v]}</span>}
            </button>
          ))}
        </div>
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm focus-within:border-sky-500 sm:max-w-xs">
          <Search size={16} className="text-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (page > 1) setQueryParams({ page: 1 });
            }}
            placeholder="Search by cabinet name or ID…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
          {query && (
            <button onClick={() => setQuery("")} title="Clear search" className="cursor-pointer text-faint hover:text-ink">
              <X size={15} />
            </button>
          )}
        </label>
      </div>

      {/* bulk actions */}
      {selected.size > 0 && (
        <div className="anim-fade-up mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <button className="cursor-pointer text-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <div className="ml-auto flex gap-2">
            <button className="btn btn-ghost px-3 py-1.5" onClick={exportCsv}>
              <Download size={15} /> Export
            </button>
            <button className="btn btn-danger px-3 py-1.5" onClick={() => void remove([...selected])}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="card space-y-3 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error && !data ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : all.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <p className="text-sm text-muted">No inspections yet.</p>
          <Link to="/inspect" className="btn btn-primary">
            <ScanLine size={18} /> Run the first one
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="card px-6 py-16 text-center text-sm text-muted">
          Nothing matches these filters.{" "}
          <button
            className="cursor-pointer font-semibold text-sky-500 hover:underline"
            onClick={() => {
              setQuery("");
              setQueryParams({ verdict: "" });
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-raised">
                <tr>
                  <th className="th w-10">
                    <input type="checkbox" className="cursor-pointer accent-sky-500" checked={allVisibleSelected} onChange={togglePage} aria-label="Select all on this page" />
                  </th>
                  {sortHeader("created_at", "Date")}
                  {sortHeader("cabinet_name", "Cabinet")}
                  <th className="th">Verdict</th>
                  {sortHeader("score", "Score", true)}
                  <th className="th">ID</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className={`divide-y divide-line transition-opacity ${loading ? "opacity-50" : ""}`}>
                {visible.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => navigate(`/inspections/${i.id}`)}
                    className={`group cursor-pointer transition-colors ${selected.has(i.id) ? "bg-sky-500/10" : "hover:bg-raised"}`}
                  >
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="cursor-pointer accent-sky-500"
                        checked={selected.has(i.id)}
                        onChange={() => toggle(i.id)}
                        aria-label={`Select ${i.cabinet_name || "inspection"}`}
                      />
                    </td>
                    <td className="td whitespace-nowrap text-muted" title={formatDate(i.created_at)}>
                      {timeAgo(i.created_at)}
                    </td>
                    <td className="td font-medium">
                      {i.cabinet_name || <span className="text-faint">Unnamed</span>}
                      {i.round > 1 && (
                        <span className="ml-2 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-600 dark:text-sky-400">Re-check {i.round - 1}</span>
                      )}
                    </td>
                    <td className="td">
                      <VerdictBadge verdict={i.verdict} size="sm" />
                    </td>
                    <td className="td">
                      <ScoreBar score={i.score} />
                    </td>
                    <td className="td font-mono text-xs text-faint">{i.id.slice(0, 8)}</td>
                    <td className="td text-right">
                      <button
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove([i.id]);
                        }}
                        className="cursor-pointer rounded-md p-1.5 text-faint opacity-60 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-muted">
            <span>
              {rows.length} inspection{rows.length === 1 ? "" : "s"} · page {current} of {pages}
              {data && data.total > all.length && ` · showing the latest ${all.length} of ${data.total}`}
            </span>
            <div className="flex gap-2">
              <button className="btn btn-ghost px-2.5 py-1.5" disabled={current <= 1} onClick={() => setQueryParams({ page: current - 1 })} aria-label="Previous page">
                <ChevronLeft size={16} />
              </button>
              <button className="btn btn-ghost px-2.5 py-1.5" disabled={current >= pages} onClick={() => setQueryParams({ page: current + 1 })} aria-label="Next page">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
