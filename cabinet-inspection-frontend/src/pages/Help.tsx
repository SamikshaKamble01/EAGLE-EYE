// Help centre: searchable FAQ, grouped by topic, with a link to every answer and a system check.
import { Activity, Check, ChevronDown, CircleHelp, Link2, Search, SearchX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getHealth } from "../lib/api";
import { ALL_FAQS, FAQ_GROUPS, searchFaqs, type Faq } from "../lib/faq";
import type { Health } from "../lib/types";
import { PageHeader } from "../components/ui";

function Answer({ faq }: { faq: Faq }) {
  // keep the author's order: paragraphs and bullet lists as they come
  const blocks: ({ t: "p"; text: string } | { t: "ul"; items: string[] })[] = [];
  for (const p of faq.a) {
    if (p.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (last?.t === "ul") last.items.push(p.slice(2));
      else blocks.push({ t: "ul", items: [p.slice(2)] });
    } else blocks.push({ t: "p", text: p });
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted">
      {blocks.map((b, i) =>
        b.t === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        ),
      )}
      {faq.links && (
        <div className="flex flex-wrap gap-2 pt-1">
          {faq.links.map((l) => (
            <Link key={l.to} to={l.to} className="btn px-3 py-1.5 text-xs">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FaqItem({ faq, open, onToggle }: { faq: Faq; open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${location.origin}${location.pathname}#${faq.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div id={faq.id} className={`scroll-mt-24 rounded-xl border bg-surface transition-colors ${open ? "border-sky-500/40" : "border-line"}`}>
      <button onClick={onToggle} aria-expanded={open} aria-controls={`${faq.id}-a`} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left">
        <span className="flex-1 text-sm font-semibold">{faq.q}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={`${faq.id}-a`} className="anim-fade-in border-t border-line px-4 pb-4 pt-3">
          <Answer faq={faq} />
          <button onClick={copy} className="mt-3 flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink">
            {copied ? <Check size={13} className="text-emerald-500" /> : <Link2 size={13} />} {copied ? "Link copied" : "Copy link to this answer"}
          </button>
        </div>
      )}
    </div>
  );
}

const SERVICE_LABEL: Record<string, string> = {
  database: "Database",
  ocr: "Label reading (OCR)",
  vision: "Detector",
  pdf: "PDF reader",
  excel: "Excel reader",
};

function SystemCheck() {
  const [state, setState] = useState<"idle" | "busy" | "offline" | "done">("idle");
  const [health, setHealth] = useState<Health | null>(null);
  const run = async () => {
    setState("busy");
    try {
      setHealth(await getHealth());
      setState("done");
    } catch {
      setHealth(null);
      setState("offline");
    }
  };
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Activity size={17} className="text-sky-500" />
        <div className="mr-auto">
          <h2 className="text-sm font-semibold">System check</h2>
          <p className="text-xs text-muted">Is the backend running, and are its parts working?</p>
        </div>
        <button onClick={run} disabled={state === "busy"} className="btn btn-primary px-3 py-1.5 text-xs">
          {state === "busy" ? "Checking…" : "Run check"}
        </button>
      </div>
      {state === "offline" && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          Cannot reach the backend. Open a terminal in the cabinet-inspection-backend folder and run <code className="tag">python run.py</code>, then check again.
        </p>
      )}
      {state === "done" && health && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {Object.entries(health.services).map(([key, svc]) => {
            const s = svc as { available: boolean; engine?: string; backend?: string; message?: string; note?: string };
            return (
              <li key={key} className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2 text-xs">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${s.available ? "bg-emerald-500" : "bg-red-500"}`} />
                <span>
                  <b>{SERVICE_LABEL[key] ?? key}</b> – {s.available ? "working" : "not available"}
                  {(s.engine || s.backend) && <span className="text-muted"> ({s.engine ?? s.backend})</span>}
                  {!s.available && (s.message || s.note) && <span className="block text-muted">{s.message ?? s.note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function Help() {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // a link like /help#why-missing opens that answer and scrolls to it
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id || !ALL_FAQS.some((f) => f.id === id)) return;
    setQuery("");
    setGroup("all");
    setOpen((prev) => new Set(prev).add(id));
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [location.hash]);

  const matches = useMemo(() => new Set(searchFaqs(query).map((f) => f.id)), [query]);
  const searching = query.trim().length > 0;
  const visible = useMemo(
    () =>
      FAQ_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => matches.has(i.id)) })).filter((g) => (group === "all" || g.id === group) && g.items.length > 0),
    [matches, group],
  );
  const shown = visible.reduce((n, g) => n + g.items.length, 0);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandAll = shown > 0 && visible.every((g) => g.items.every((i) => open.has(i.id)));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <CircleHelp size={24} className="text-sky-500" /> Help and FAQ
          </span>
        }
        subtitle="Answers to the questions people ask most. Search, or pick a topic. Every answer has its own link you can share."
      />

      <div className="card mb-5 p-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the help, e.g. missing, photo, backend, label…"
            aria-label="Search the help"
            className="w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-9 text-sm outline-none transition focus:border-sky-400"
          />
          {query && (
            <button onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted hover:text-ink">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {[{ id: "all", title: "All topics" }, ...FAQ_GROUPS].map((g) => {
            const count = g.id === "all" ? matches.size : FAQ_GROUPS.find((x) => x.id === g.id)!.items.filter((i) => matches.has(i.id)).length;
            return (
              <button
                key={g.id}
                onClick={() => setGroup(g.id)}
                aria-pressed={group === g.id}
                className={`cursor-pointer rounded-full px-3 py-1.5 font-semibold transition ${group === g.id ? "bg-sky-500 text-white" : "bg-raised text-muted hover:text-ink"}`}
              >
                {g.title} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
          <button
            onClick={() => setOpen(expandAll ? new Set() : new Set(visible.flatMap((g) => g.items.map((i) => i.id))))}
            className="ml-auto cursor-pointer font-semibold text-muted hover:text-ink"
          >
            {expandAll ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {shown === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
          <SearchX size={30} className="text-faint" />
          <p className="text-sm font-semibold">Nothing found for “{query}”</p>
          <p className="max-w-md text-sm text-muted">Try fewer or simpler words, or choose a topic above. If the app itself is not responding, run the system check below.</p>
          <button onClick={() => { setQuery(""); setGroup("all"); }} className="btn mt-1 px-3 py-1.5 text-xs">Show all questions</button>
        </div>
      ) : (
        <div className="space-y-7">
          {visible.map((g) => (
            <section key={g.id} aria-labelledby={`g-${g.id}`}>
              <h2 id={`g-${g.id}`} className="text-sm font-bold uppercase tracking-wide text-faint">
                {g.title} <span className="font-medium normal-case tracking-normal">· {g.blurb}</span>
              </h2>
              <div className="mt-2 space-y-2">
                {g.items.map((f) => (
                  <FaqItem key={f.id} faq={f} open={open.has(f.id) || (searching && shown <= 3)} onToggle={() => toggle(f.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <SystemCheck />
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Still stuck?</h2>
          <p className="mt-1 text-xs text-muted">Start from a known place:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/inspect" className="btn btn-primary px-3 py-1.5 text-xs">Start an inspection</Link>
            <Link to="/history" className="btn px-3 py-1.5 text-xs">Open the history</Link>
            <Link to="/" className="btn px-3 py-1.5 text-xs">Dashboard</Link>
          </div>
          <p className="mt-3 text-xs text-muted">Tip: press <span className="kbd">Ctrl K</span> anywhere to search inspections and pages.</p>
        </div>
      </div>
    </div>
  );
}
