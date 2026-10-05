// Small reusable building blocks: badges, states, cards.
import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Severity, Verdict } from "../lib/types";

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict | null; size?: "sm" | "md" | "lg" }) {
  if (!verdict) {
    return <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">ERROR</span>;
  }
  const pass = verdict === "PASS";
  const Icon = pass ? CircleCheck : CircleX;
  const sizes = {
    sm: "px-2 py-0.5 text-xs gap-1",
    md: "px-3 py-1 text-sm gap-1.5",
    lg: "px-5 py-2.5 text-2xl gap-2.5 tracking-wide",
  };
  const icon = { sm: 13, md: 16, lg: 28 }[size];
  return (
    <span
      className={`inline-flex items-center rounded-lg font-extrabold ${sizes[size]} ${
        pass ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
      }`}
    >
      <Icon size={icon} strokeWidth={2.5} />
      {verdict}
    </span>
  );
}

export const severityStyle: Record<Severity, { pill: string; bar: string; text: string; stroke: string }> = {
  critical: { pill: "bg-red-100 text-red-700 ring-red-200", bar: "bg-red-500", text: "text-red-600", stroke: "#dc2626" },
  major: { pill: "bg-amber-100 text-amber-800 ring-amber-200", bar: "bg-amber-500", text: "text-amber-600", stroke: "#d97706" },
  minor: { pill: "bg-slate-100 text-slate-600 ring-slate-200", bar: "bg-slate-400", text: "text-slate-500", stroke: "#64748b" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ${severityStyle[severity].pill}`}>
      {severity}
    </span>
  );
}

export function StatusText({ status }: { status: string }) {
  const ok = status === "ok";
  return (
    <span className={`text-sm font-semibold ${ok ? "text-emerald-600" : "text-red-600"}`}>
      {ok ? "OK" : status.replace(/_/g, " ")}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
      <LoaderCircle className="animate-spin" size={20} />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <TriangleAlert className="text-red-500" size={32} />
      <p className="max-w-md text-sm text-slate-600">{message}</p>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, accent = "text-slate-900" }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Circular score gauge, 0-100 */
export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 100 ? "#059669" : score >= 75 ? "#d97706" : "#dc2626";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(Math.max(score, 0), 100) / 100)}
          style={{ transition: "stroke-dashoffset .8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums">{Math.round(score)}%</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">score</span>
      </div>
    </div>
  );
}
