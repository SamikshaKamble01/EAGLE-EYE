// Shows the cabinet photo with boxes drawn in the browser (SVG overlay).
//   hover a box / defect  -> highlight it
//   click                 -> pin it (stays highlighted, photo zooms to it)
//   double-click / Ctrl+scroll / buttons -> zoom, drag -> pan
// "Server image" shows the annotated PNG the backend generated instead.
import { Expand, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { annotatedImageUrl, originalImageUrl } from "../lib/api";
import { humanize } from "../lib/format";
import type { BBox, InspectionResult } from "../lib/types";

interface Props {
  id: string;
  result: InspectionResult;
  highlight: string | null; // hovered tag / wire label
  pinned: string | null; // clicked tag / wire label
  onHover: (item: string | null) => void;
  onPin: (item: string | null) => void;
}

type Kind = "ok" | "problem" | "unexpected";

interface Box {
  key: string;
  item: string;
  bbox: BBox;
  label: string;
  kind: Kind;
}

interface View {
  s: number; // scale
  x: number; // translate, in screen pixels
  y: number;
}

const COLORS: Record<Kind, string> = { ok: "#10b981", problem: "#f59e0b", unexpected: "#ef4444" };
const MAX_ZOOM = 8;
const HOME: View = { s: 1, x: 0, y: 0 };

export default function InspectionViewer({ id, result, highlight, pinned, onHover, onPin }: Props) {
  const [mode, setMode] = useState<"interactive" | "server">("interactive");
  const [layers, setLayers] = useState({ ok: true, problem: true, unexpected: true, detections: true });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>(HOME);
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const card = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const pinnedHere = useRef(false); // pin came from a click on the photo -> do not jump

  const boxes = useMemo<Box[]>(() => {
    const list: Box[] = [
      ...result.components
        .filter((c) => c.bbox)
        .map((c) => ({
          key: `c-${c.tag}`,
          item: c.tag,
          bbox: c.bbox as BBox,
          label: c.status === "ok" ? c.tag : `${c.tag} ≠ ${c.read_as ?? "?"}`,
          kind: (c.status === "ok" ? "ok" : "problem") as Kind,
        })),
      ...result.wire_labels
        .filter((w) => w.bbox)
        .map((w) => ({
          key: `w-${w.label}`,
          item: w.label,
          bbox: w.bbox as BBox,
          label: w.status === "ok" ? w.label : `${w.label} ≠ ${w.read_as ?? "?"}`,
          kind: (w.status === "ok" ? "ok" : "problem") as Kind,
        })),
    ];
    // labels nobody expected (UNEXPECTED_LABEL defects) - show them in red
    const unexpected = new Set(result.defects.filter((d) => d.code === "UNEXPECTED_LABEL").map((d) => d.item));
    for (const t of result.actual.ocr_texts) {
      if (unexpected.has(t.text) && !list.some((b) => b.item === t.text)) {
        list.push({ key: `u-${t.text}`, item: t.text, bbox: t.bbox, label: `${t.text} ?`, kind: "unexpected" });
      }
    }
    return list;
  }, [result]);

  /** Keep the photo inside the frame. */
  const clamp = useCallback((v: View): View => {
    const el = stage.current;
    if (!el) return v;
    const s = Math.min(Math.max(v.s, 1), MAX_ZOOM);
    const w = el.clientWidth;
    const h = el.clientHeight;
    return { s, x: Math.min(0, Math.max(w - w * s, v.x)), y: Math.min(0, Math.max(h - h * s, v.y)) };
  }, []);

  /** Zoom by `factor` keeping the point (cx, cy) of the frame under the cursor. */
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) =>
      setView((v) => {
        const s = Math.min(Math.max(v.s * factor, 1), MAX_ZOOM);
        const k = s / v.s;
        return clamp({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
      }),
    [clamp],
  );

  const zoomCenter = (factor: number) => {
    const el = stage.current;
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  };

  // Ctrl + scroll zooms (plain scroll keeps scrolling the page)
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.25 : 0.8);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, mode, size]);

  // pinned from the defect list / tables -> fly to that box
  useEffect(() => {
    if (pinnedHere.current) {
      pinnedHere.current = false;
      return;
    }
    const el = stage.current;
    const box = boxes.find((b) => b.item === pinned);
    if (!pinned || !box || !el || !size) return;
    const k = el.clientWidth / size.w; // image pixel -> screen pixel
    const [x1, y1, x2, y2] = box.bbox;
    const s = Math.min(Math.max(Math.min(el.clientWidth / ((x2 - x1) * k * 4), el.clientHeight / ((y2 - y1) * k * 4)), 1.6), 4);
    setView(clamp({ s, x: el.clientWidth / 2 - ((x1 + x2) / 2) * k * s, y: el.clientHeight / 2 - ((y1 + y2) / 2) * k * s }));
  }, [pinned, boxes, size, clamp]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === card.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => setView(HOME), [mode, fullscreen]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setView((v) => clamp({ s: v.s, x: d.x + dx, y: d.y + dy }));
  };
  const onPointerUp = () => {
    // keep `moved` readable for the click handler that fires right after
    setTimeout(() => (drag.current = null), 0);
    setDragging(false);
  };
  const wasDrag = () => drag.current?.moved === true;

  const pin = (item: string | null) => {
    if (wasDrag()) return;
    pinnedHere.current = true;
    onPin(item !== null && item === pinned ? null : item);
  };

  const active = highlight ?? pinned;
  const visible = boxes.filter((b) => layers[b.kind]);
  const toggleLayer = (key: keyof typeof layers) => () => setLayers((l) => ({ ...l, [key]: !l[key] }));
  const fs = size ? Math.max(12, size.w / 70) : 14; // font size in image pixels
  const sw = size ? Math.max(2, size.w / 450) : 2; // stroke width
  const imgMax = fullscreen ? "max-h-[84vh]" : "max-h-[70vh]";

  return (
    <div ref={card} className="card flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="mr-auto font-semibold">Cabinet photo</h2>
        <div className="flex rounded-lg bg-raised p-0.5 text-xs font-semibold">
          {(["interactive", "server"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`cursor-pointer rounded-md px-2.5 py-1 transition ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
            >
              {m === "interactive" ? "Interactive" : "Server image"}
            </button>
          ))}
        </div>
        <button
          onClick={() => (fullscreen ? void document.exitFullscreen() : void card.current?.requestFullscreen())}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
        >
          <Expand size={16} />
        </button>
        <a
          href={mode === "server" ? annotatedImageUrl(id) : originalImageUrl(id)}
          target="_blank"
          rel="noreferrer"
          title="Open image in a new tab"
          className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
        >
          <Maximize2 size={16} />
        </a>
      </div>

      <div className="relative flex flex-1 items-center bg-slate-950 p-3">
        {mode === "server" ? (
          <img src={annotatedImageUrl(id)} alt="annotated cabinet" className={`mx-auto rounded ${imgMax}`} />
        ) : (
          <>
            <div
              ref={stage}
              className={`relative mx-auto w-fit touch-none overflow-hidden rounded ${view.s > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                if (view.s > 1.01) setView(HOME);
                else zoomAt(e.clientX - rect.left, e.clientY - rect.top, 2.5);
              }}
              onClick={() => !wasDrag() && pinned && onPin(null)}
            >
              <div
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
                  transformOrigin: "0 0",
                  transition: dragging ? "none" : "transform .35s cubic-bezier(.2,.7,.2,1)",
                }}
              >
                <img
                  src={originalImageUrl(id)}
                  alt="cabinet"
                  draggable={false}
                  className={`block select-none ${imgMax}`}
                  onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                {size && (
                  <svg
                    viewBox={`0 0 ${size.w} ${size.h}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full"
                    onMouseLeave={() => onHover(null)}
                  >
                    {layers.detections &&
                      result.actual.detections.map((d, i) => (
                        <rect
                          key={`d-${i}`}
                          x={d.bbox[0]}
                          y={d.bbox[1]}
                          width={d.bbox[2] - d.bbox[0]}
                          height={d.bbox[3] - d.bbox[1]}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth={sw * 0.75}
                          strokeDasharray={`${sw * 4} ${sw * 3}`}
                          opacity={active ? 0.25 : 0.7}
                        >
                          <title>{`${humanize(d.type)} · ${Math.round(d.confidence * 100)}% confidence`}</title>
                        </rect>
                      ))}
                    {visible.map((b) => {
                      const isActive = active === b.item;
                      const dim = active !== null && !isActive;
                      const color = COLORS[b.kind];
                      const [x1, y1, x2, y2] = b.bbox;
                      const labelW = b.label.length * fs * 0.62 + fs * 0.8;
                      return (
                        <g
                          key={b.key}
                          opacity={dim ? 0.25 : 1}
                          onMouseEnter={() => onHover(b.item)}
                          onClick={(e) => {
                            e.stopPropagation();
                            pin(b.item);
                          }}
                          style={{ cursor: "pointer", transition: "opacity .15s" }}
                        >
                          <rect
                            x={x1 - sw * 2}
                            y={y1 - sw * 2}
                            width={x2 - x1 + sw * 4}
                            height={y2 - y1 + sw * 4}
                            fill={isActive ? `${color}33` : "transparent"}
                            stroke={color}
                            strokeWidth={isActive ? sw * 2.2 : sw}
                            rx={sw * 2}
                          />
                          {pinned === b.item && (
                            <rect
                              x={x1 - sw * 5}
                              y={y1 - sw * 5}
                              width={x2 - x1 + sw * 10}
                              height={y2 - y1 + sw * 10}
                              fill="none"
                              stroke="#fff"
                              strokeWidth={sw * 0.8}
                              strokeDasharray={`${sw * 3} ${sw * 2}`}
                              rx={sw * 3}
                            />
                          )}
                          <rect x={x1 - sw * 2} y={y2 + sw * 3} width={labelW} height={fs * 1.45} fill={color} rx={sw * 1.5} />
                          <text
                            x={x1 - sw * 2 + fs * 0.4}
                            y={y2 + sw * 3 + fs * 1.08}
                            fontSize={fs}
                            fontFamily="JetBrains Mono, monospace"
                            fontWeight={700}
                            fill="#fff"
                          >
                            {b.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>
            </div>

            {/* zoom controls */}
            <div className="absolute bottom-5 right-5 flex items-center overflow-hidden rounded-lg border border-white/10 bg-slate-900/90 text-slate-200 shadow-lg backdrop-blur">
              <button onClick={() => zoomCenter(0.7)} disabled={view.s <= 1} title="Zoom out" className="cursor-pointer p-2 hover:bg-white/10 disabled:opacity-30">
                <Minus size={15} />
              </button>
              <span className="w-12 text-center text-xs font-semibold tabular-nums">{Math.round(view.s * 100)}%</span>
              <button onClick={() => zoomCenter(1.4)} disabled={view.s >= MAX_ZOOM} title="Zoom in" className="cursor-pointer p-2 hover:bg-white/10 disabled:opacity-30">
                <Plus size={15} />
              </button>
              <button onClick={() => setView(HOME)} disabled={view.s === 1} title="Reset view" className="cursor-pointer border-l border-white/10 p-2 hover:bg-white/10 disabled:opacity-30">
                <RotateCcw size={15} />
              </button>
            </div>
          </>
        )}
      </div>

      {mode === "interactive" && <InfoStrip result={result} item={active} pinned={pinned !== null && active === pinned} />}

      {/* the legend doubles as layer switches */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted">
        <Legend color={COLORS.ok} text="Label matches" on={layers.ok} onToggle={toggleLayer("ok")} />
        <Legend color={COLORS.problem} text="Wrong label" on={layers.problem} onToggle={toggleLayer("problem")} />
        <Legend color={COLORS.unexpected} text="Not in documents" on={layers.unexpected} onToggle={toggleLayer("unexpected")} />
        <Legend color="#38bdf8" text="Detected component" dashed on={layers.detections} onToggle={toggleLayer("detections")} />
        {mode === "interactive" && <span className="ml-auto hidden text-faint sm:inline">click to show / hide</span>}
      </div>
    </div>
  );
}

/** One line describing the hovered / pinned item. */
function InfoStrip({ result, item, pinned }: { result: InspectionResult; item: string | null; pinned: boolean }) {
  if (!item) {
    return (
      <div className="border-t border-line bg-raised px-4 py-2 text-xs text-muted">
        Hover a box to inspect it · click to pin · double-click or <span className="kbd">Ctrl</span> + scroll to zoom · drag to pan
      </div>
    );
  }
  const comp = result.components.find((c) => c.tag === item);
  const wire = result.wire_labels.find((w) => w.label === item);
  const readAs = comp?.read_as ?? wire?.read_as ?? item;
  const ocr = result.actual.ocr_texts.find((t) => t.text === readAs);
  const status = comp?.status ?? wire?.status;
  const located = !!(comp?.bbox ?? wire?.bbox ?? ocr);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-raised px-4 py-2 text-xs">
      <span className="tag rounded bg-surface px-1.5 py-0.5 text-sm">{item}</span>
      <span className="text-muted">{comp ? humanize(comp.type) : wire ? "Wire label" : "Label not in the documents"}</span>
      {status && (
        <span className={`font-semibold ${status === "ok" ? "text-emerald-500" : "text-amber-500"}`}>
          {status === "ok" ? "Matches the documents" : humanize(status)}
        </span>
      )}
      {comp?.read_as && comp.read_as !== item && (
        <span className="text-muted">
          read as <b className="tag text-ink">{comp.read_as}</b>
        </span>
      )}
      {ocr && <span className="text-muted">OCR confidence {Math.round(ocr.confidence)}%</span>}
      {!located && <span className="text-red-500">Not found in the photo</span>}
      {pinned && <span className="ml-auto text-faint">pinned · click the photo to release</span>}
    </div>
  );
}

function Legend({ color, text, dashed, on, onToggle }: { color: string; text: string; dashed?: boolean; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-raised hover:text-ink ${on ? "" : "line-through opacity-45"}`}
    >
      <span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      {text}
    </button>
  );
}
