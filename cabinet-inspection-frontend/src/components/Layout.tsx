// App shell: sidebar navigation + live backend status.
import { Cpu, Database, History as HistoryIcon, LayoutDashboard, ScanLine, ScanText } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { getHealth } from "../lib/api";
import { useApi } from "../lib/useApi";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inspect", label: "New inspection", icon: ScanLine, end: false },
  { to: "/history", label: "History", icon: HistoryIcon, end: false },
];

function HealthPanel() {
  const { data, error } = useApi(() => getHealth(), []);
  const rows = [
    { label: "OCR", icon: ScanText, ok: data?.services.ocr.available, detail: data?.services.ocr.engine },
    { label: "Vision", icon: Cpu, ok: data?.services.vision.available, detail: data?.services.vision.backend },
    { label: "Database", icon: Database, ok: data?.services.database.available, detail: "sqlite" },
  ];
  return (
    <div className="rounded-lg bg-slate-800/60 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Backend services</div>
      {error ? (
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

export default function Layout() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? "bg-sky-500/15 text-sky-300" : "text-slate-300 hover:bg-slate-800 hover:text-white"
    }`;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 bg-slate-900 p-4 md:sticky md:top-0 md:h-screen md:w-60">
        <div className="flex items-center gap-2.5 px-1">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
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
          <HealthPanel />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
