// Small reusable building blocks: badges, states, cards.
import { CircleCheck, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Severity, Verdict } from "../lib/types";
import { CountUp, useCountUp } from "./charts";

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict | null; size?: "sm" | "md" | "lg" }) {
  if (!verdict) {
    return <span className="rounded-md bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-muted">ERROR</span>;
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
      className={`inline-flex items-center rounded-lg font-extrabold text-white ${sizes[size]} ${
        pass ? "bg-emerald-600 shadow-emerald-500/30" : "bg-red-600 shadow-red-500/30"
      } ${size === "lg" ? "shadow-lg" : ""}`}
    >
      <Icon size={icon} strokeWidth={2.5} />
      {verdict}
    </span>
  );
}

export const severityStyle: Record<Severity, { pill: string; bar: string; text: string; stroke: string }> = {
  critical: { pill: "bg-red-500/10 text-red-600 ring-red-500/25 dark:text-red-400", bar: "bg-red-500", text: "text-red-500", stroke: "#dc2626" },
  major: { pill: "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400", bar: "bg-amber-500", text: "text-amber-500", stroke: "#d97706" },
  minor: { pill: "bg-slate-500/10 text-slate-600 ring-slate-500/25 dark:text-slate-300", bar: "bg-slate-400", text: "text-slate-400", stroke: "#64748b" },
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
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${ok ? "text-emerald-500" : "text-red-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
      {ok ? "OK" : status.replace(/_/g, " ")}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <LoaderCircle className="animate-spin" size={20} />
      {label}
    </div>
  );
}

/** Grey placeholder block shown while data loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card anim-fade-up flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="rounded-full bg-red-500/10 p-3">
        <TriangleAlert className="text-red-500" size={28} />
      </div>
      <p className="max-w-md text-sm text-muted">{message}</p>
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
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  sky: "bg-sky-500/10 text-sky-500",
  emerald: "bg-emerald-500/10 text-emerald-500",
  red: "bg-red-500/10 text-red-500",
  amber: "bg-amber-500/10 text-amber-500",
  slate: "bg-slate-500/10 text-muted",
};

export function StatCard({
  label,
  value,
  decimals = 0,
  suffix = "",
  hint,
  icon: Icon,
  tone = "sky",
  accent = "",
  onClick,
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof tones;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <div className={`card card-hover h-full p-5 ${onClick ? "cursor-pointer" : ""}`} onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
        <div className={`rounded-lg p-2 ${tones[tone]}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${accent}`}>
        <CountUp value={value} decimals={decimals} suffix={suffix} />
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export const scoreColor = (score: number) => (score >= 100 ? "#10b981" : score >= 75 ? "#f59e0b" : "#ef4444");

/** Thin horizontal score bar used in lists and tables. */
export function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-faint">–</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-raised sm:block">
        <div className="anim-grow-x h-full rounded-full" style={{ width: `${score}%`, background: scoreColor(score) }} />
      </div>
      <span className="w-12 text-right text-sm font-semibold tabular-nums">{score}%</span>
    </div>
  );
}

/** Circular score gauge, 0-100. Fills up and counts up when it appears. */
export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const stroke = Math.max(8, size / 11);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [ready, setReady] = useState(false);
  const shown = useCountUp(score, 1100);
  useEffect(() => {
    const f = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(f);
  }, []);
  const clamped = Math.min(Math.max(score, 0), 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={ready ? c * (1 - clamped / 100) : c}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold tabular-nums" style={{ fontSize: size / 4.4 }}>
          {Math.round(shown)}%
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">score</span>
      </div>
    </div>
  );
}
