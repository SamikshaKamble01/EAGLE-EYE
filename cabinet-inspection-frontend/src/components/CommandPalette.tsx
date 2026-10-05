// Ctrl+K quick search: jump to a page, run an action, or open any inspection by name / ID.
import { CornerDownLeft, History as HistoryIcon, LayoutDashboard, Moon, ScanLine, Search, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listInspections } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Theme } from "../lib/theme";
import type { InspectionSummary } from "../lib/types";
import { VerdictBadge } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

interface Command {
  key: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  inspection?: InspectionSummary;
  run: () => void;
}

export default function CommandPalette({ open, onClose, theme, onToggleTheme }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [inspections, setInspections] = useState<InspectionSummary[]>([]);
  const list = useRef<HTMLUListElement>(null);

  // fresh list every time the palette opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    let alive = true;
    listInspections({ limit: 100 })
      .then((d) => alive && setInspections(d.items))
      .catch(() => alive && setInspections([]));
    return () => {
      alive = false;
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const actions: Command[] = [
      { key: "dash", label: "Go to dashboard", icon: LayoutDashboard, run: go("/") },
      { key: "new", label: "Start a new inspection", icon: ScanLine, run: go("/inspect") },
      { key: "hist", label: "Open inspection history", icon: HistoryIcon, run: go("/history") },
      { key: "failed", label: "Show failed inspections", icon: HistoryIcon, run: go("/history?verdict=FAIL") },
      {
        key: "theme",
        label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
        icon: theme === "dark" ? Sun : Moon,
        run: onToggleTheme,
      },
    ];
    const found: Command[] = inspections.map((i) => ({
      key: i.id,
      label: i.cabinet_name || "Unnamed cabinet",
      hint: `${timeAgo(i.created_at)} · ${i.id.slice(0, 8)}`,
      inspection: i,
      run: go(`/inspections/${i.id}`),
    }));
    const q = query.trim().toLowerCase();
    if (!q) return [...actions, ...found.slice(0, 6)];
    return [...actions, ...found].filter(
      (c) => c.label.toLowerCase().includes(q) || c.inspection?.id.toLowerCase().includes(q) || c.inspection?.verdict?.toLowerCase() === q,
    );
  }, [inspections, query, theme, navigate, onToggleTheme]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 pt-[14vh] backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Quick search" className="card anim-scale-in w-full max-w-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, commands.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(commands[index]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Search cabinets, IDs, pages…"
            className="w-full bg-transparent py-4 text-sm outline-none placeholder:text-faint"
          />
          <span className="kbd">Esc</span>
        </div>

        <ul ref={list} className="max-h-80 overflow-y-auto p-2">
          {commands.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{query}”.</li>}
          {commands.map((c, i) => (
            <li
              key={c.key}
              data-index={i}
              onMouseMove={() => setIndex(i)}
              onClick={() => run(c)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${i === index ? "bg-sky-500/15" : ""}`}
            >
              {c.inspection ? <VerdictBadge verdict={c.inspection.verdict} size="sm" /> : c.icon && <c.icon size={17} className="text-muted" />}
              <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
              {c.hint && <span className="shrink-0 text-xs text-muted">{c.hint}</span>}
              {i === index && <CornerDownLeft size={14} className="shrink-0 text-muted" />}
            </li>
          ))}
        </ul>

        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> move
          </span>
          <span>
            <span className="kbd">Enter</span> open
          </span>
        </div>
      </div>
    </div>
  );
}
