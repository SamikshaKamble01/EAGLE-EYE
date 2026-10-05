// App shell: sidebar navigation, top bar (quick search, theme), live backend status.
import { Cpu, Database, History as HistoryIcon, LayoutDashboard, Moon, ScanLine, ScanText, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { getHealth } from "../lib/api";
import { useTheme } from "../lib/theme";
import type { Health } from "../lib/types";
import { useApi } from "../lib/useApi";
import CommandPalette from "./CommandPalette";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inspect", label: "New inspection", icon: ScanLine, end: false },
  { to: "/history", label: "History", icon: HistoryIcon, end: false },
];

const HEALTH_POLL_MS = 15_000;

function HealthPanel({ data, offline }: { data: Health | null; offline: boolean }) {
  const rows = [
    { label: "OCR", icon: ScanText, ok: data?.services.ocr.available, detail: data?.services.ocr.engine },
    { label: "Vision", icon: Cpu, ok: data?.services.vision.available, detail: data?.services.vision.backend },
    { label: "Database", icon: Database, ok: data?.services.database.available, detail: "sqlite" },
  ];
  return (
    <div className="rounded-xl border border-white/5 bg-white/5 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Backend services</div>
      {offline ? (
        <div className="flex items-center gap-2 text-xs text-red-300">
          <span className="h-2 w-2 rounded-full bg-red-400" /> Backend offline
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(({ label, icon: Icon, ok, detail }) => (
            <li key={label} className="flex items-center gap-2 text-xs text-slate-300">
              <span className={`h-2 w-2 rounded-full ${ok === undefined ? "bg-slate-500" : ok ? "bg-emerald-400" : "bg-red-400"}`} />
              <Icon size={13} className="text-slate-400" />
              <span>{label}</span>
              {detail && <span className="ml-auto font-mono text-[10px] text-slate-500">{detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ data, offline }: { data: Health | null; offline: boolean }) {
  const state = offline ? "offline" : !data ? "checking" : data.status === "ok" ? "online" : "degraded";
  const color = { offline: "bg-red-500", checking: "bg-slate-400", online: "bg-emerald-500", degraded: "bg-amber-500" }[state];
  return (
    <div className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted sm:flex" title="Checked every 15 seconds">
      <span className="relative flex h-2 w-2">
        {state === "online" && <span className={`ping-soft absolute inline-flex h-full w-full rounded-full ${color}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      Backend {state}
    </div>
  );
}

export default function Layout() {
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: health, error: healthError, reload: reloadHealth } = useApi(() => getHealth(), []);

  useEffect(() => {
    const t = setInterval(reloadHealth, HEALTH_POLL_MS);
    return () => clearInterval(t);
  }, [reloadHealth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive
        ? "bg-linear-to-r from-sky-500/25 to-indigo-500/10 text-white shadow-inner shadow-sky-500/10 ring-1 ring-sky-400/30"
        : "text-slate-300 hover:bg-white/5 hover:text-white"
    }`;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 border-r border-white/5 bg-linear-to-b from-slate-900 to-slate-950 p-4 md:sticky md:top-0 md:h-screen md:w-60">
        <div className="flex items-center gap-2.5 px-1">
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-lg shadow-lg shadow-sky-500/20" />
          <div>
            <div className="text-sm font-bold leading-tight text-white">Cabinet Inspection</div>
            <div className="text-[11px] text-slate-400">Expected vs actual</div>
          </div>
        </div>
        <nav className="flex gap-1 md:flex-col">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon size={18} />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden md:block">
          <HealthPanel data={health} offline={!!healthError} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/75 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full max-w-sm cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-faint transition hover:border-sky-400/60 hover:text-muted"
          >
            <Search size={16} />
            <span className="flex-1 text-left">Search cabinets, pages…</span>
            <span className="kbd">Ctrl K</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <StatusPill data={health} offline={!!healthError} />
            <button
              onClick={toggle}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label="Toggle theme"
              className="cursor-pointer rounded-lg border border-line bg-surface p-2 text-muted transition hover:text-ink"
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {/* key = pathname so every page fades in when you navigate */}
          <div key={location.pathname} className="anim-fade-up mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} theme={theme} onToggleTheme={toggle} />
    </div>
  );
}
