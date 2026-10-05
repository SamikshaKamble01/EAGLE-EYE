// Dependency-free animated charts (plain SVG): count-up numbers, donut, score trend.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Verdict } from "../lib/types";

/** Animates from the previous value to `value`. */
export function useCountUp(value: number, duration = 900): number {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const from = current.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = from + (value - from) * eased;
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const shown = useCountUp(value);
  return (
    <>
      {shown.toFixed(decimals)}
      {suffix}
    </>
  );
}

// ---- donut ------------------------------------------------------------------

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  size = 168,
  center,
  onSelect,
}: {
  segments: DonutSegment[];
  size?: number;
  center: ReactNode;
  onSelect?: (key: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const f = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(f);
  }, []);

  const stroke = 18;
  const r = (size - stroke) / 2 - 3;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const hovered = segments.find((s) => s.key === hover);
  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {segments.map((s) => {
          const len = (s.value / total) * c;
          const dashOffset = -offset;
          offset += len;
          if (!s.value) return null;
          return (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.key ? stroke + 5 : stroke}
              strokeDasharray={ready ? `${len} ${c - len}` : `0 ${c}`}
              strokeDashoffset={dashOffset}
              opacity={hover && hover !== s.key ? 0.35 : 1}
              style={{ transition: "stroke-dasharray .9s cubic-bezier(.2,.7,.2,1), stroke-width .15s, opacity .15s", cursor: onSelect ? "pointer" : "default" }}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(s.key)}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {hovered ? (
          <>
            <span className="text-3xl font-bold tabular-nums" style={{ color: hovered.color }}>
              {hovered.value}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{hovered.label}</span>
          </>
        ) : (
          center
        )}
      </div>
    </div>
  );
}

// ---- score trend --------------------------------------------------------------

export interface TrendPoint {
  id: string;
  label: string;
  date: string;
  score: number;
  verdict: Verdict | null;
}

/** Area chart of scores (oldest left, newest right). Hover a dot for details, click to open. */
export function TrendChart({ points, onSelect }: { points: TrendPoint[]; onSelect: (id: string) => void }) {
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);

  const n = points.length;
  const x = (i: number) => (n === 1 ? 50 : 3 + (i / (n - 1)) * 94);
  const y = (score: number) => 92 - (Math.min(Math.max(score, 0), 100) / 100) * 84;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.score).toFixed(2)}`).join(" ");
  const area = n > 1 ? `${line} L${x(n - 1)},100 L${x(0)},100 Z` : "";
  const active = hover !== null ? points[hover] : null;

  return (
    <div className="relative h-48 w-full select-none">
      {/* horizontal guides */}
      {[100, 50, 0].map((v) => (
        <div key={v} className="absolute inset-x-0 flex items-center gap-2" style={{ top: `${y(v)}%`, transform: "translateY(-50%)" }}>
          <span className="w-7 text-right text-[10px] tabular-nums text-faint">{v}</span>
          <span className="h-px flex-1 border-t border-dashed border-line" />
        </div>
      ))}

      <div className="absolute inset-y-0 left-9 right-1">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <path d={area} fill={`url(#${gradient})`} className="anim-fade-in" />}
          {n > 1 && (
            <path d={line} fill="none" stroke="#38bdf8" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {hover !== null && <div className="absolute inset-y-0 w-px bg-sky-400/50" style={{ left: `${x(hover)}%` }} />}

        {points.map((p, i) => (
          <button
            key={p.id}
            type="button"
            aria-label={`${p.label}: ${p.score}%`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(p.id)}
            className="absolute cursor-pointer p-2"
            style={{ left: `${x(i)}%`, top: `${y(p.score)}%`, transform: "translate(-50%, -50%)" }}
          >
            <span
              className={`block rounded-full border-2 border-surface transition-all ${hover === i ? "h-4 w-4" : "h-2.5 w-2.5"} ${
                p.verdict === "PASS" ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
          </button>
        ))}

        {active && hover !== null && (
          <div
            className="card anim-scale-in pointer-events-none absolute z-10 w-max max-w-52 px-3 py-2 text-xs shadow-xl"
            style={{
              left: `${x(hover)}%`,
              top: `${y(active.score)}%`,
              transform: `translate(${x(hover) < 20 ? "0%" : x(hover) > 80 ? "-100%" : "-50%"}, ${y(active.score) < 40 ? "16px" : "calc(-100% - 14px)"})`,
            }}
          >
            <div className="truncate font-semibold">{active.label}</div>
            <div className="mt-0.5 flex items-center gap-2 text-muted">
              <span className={`font-bold ${active.verdict === "PASS" ? "text-emerald-500" : "text-red-500"}`}>{active.verdict}</span>
              <span className="tabular-nums">{active.score}%</span>
              <span>· {active.date}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
