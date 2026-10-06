// App shell: sidebar navigation and top bar (quick search, theme).
import { History as HistoryIcon, LayoutDashboard, Moon, ScanLine, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "../lib/theme";
import CommandPalette from "./CommandPalette";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inspect", label: "New inspection", icon: ScanLine, end: false },
  { to: "/history", label: "History", icon: HistoryIcon, end: false },
];

export default function Layout() {
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

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
        ? "bg-linear-to-r from-sky-500/20 to-indigo-500/10 text-sky-700 ring-1 ring-sky-500/30 dark:text-white dark:ring-sky-400/30"
        : "text-muted hover:bg-raised hover:text-ink"
    }`;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-line bg-surface p-4 md:border-b-0 md:border-r dark:bg-linear-to-b dark:from-slate-900 dark:to-slate-950 md:sticky md:top-0 md:h-screen md:w-60">
        <div className="flex items-center gap-2.5 px-1">
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-lg shadow-lg shadow-sky-500/20" />
          <div>
            <div className="text-sm font-bold leading-tight text-ink">Eagle-Eye</div>
            <div className="text-[11px] text-muted">Expected vs actual</div>
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
