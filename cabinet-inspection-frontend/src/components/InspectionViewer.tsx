// Shows the cabinet photo with boxes drawn in the browser (SVG overlay),
// so hovering a defect highlights its exact location on the photo.
// "Server image" shows the annotated PNG the backend generated instead.
import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { annotatedImageUrl, originalImageUrl } from "../lib/api";
import type { BBox, InspectionResult } from "../lib/types";

interface Props {
  id: string;
  result: InspectionResult;
  highlight: string | null; // tag / wire label to emphasise
  onSelect: (item: string | null) => void;
}

interface Box {
  key: string;
  item: string;
  bbox: BBox;
  label: string;
  color: string;
}

export default function InspectionViewer({ id, result, highlight, onSelect }: Props) {
  const [mode, setMode] = useState<"interactive" | "server">("interactive");
  const [showDetections, setShowDetections] = useState(true);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const boxes: Box[] = [
    ...result.components
      .filter((c) => c.bbox)
      .map((c) => ({
        key: `c-${c.tag}`,
        item: c.tag,
        bbox: c.bbox as BBox,
        label: c.status === "ok" ? c.tag : `${c.tag} ≠ ${c.read_as ?? "?"}`,
        color: c.status === "ok" ? "#059669" : "#d97706",
      })),
    ...result.wire_labels
      .filter((w) => w.bbox)
      .map((w) => ({
        key: `w-${w.label}`,
        item: w.label,
        bbox: w.bbox as BBox,
        label: w.status === "ok" ? w.label : `${w.label} ≠ ${w.read_as ?? "?"}`,
        color: w.status === "ok" ? "#059669" : "#d97706",
      })),
  ];
  // labels nobody expected (UNEXPECTED_LABEL defects) - show them in red
  const unexpected = new Set(result.defects.filter((d) => d.code === "UNEXPECTED_LABEL").map((d) => d.item));
  for (const t of result.actual.ocr_texts) {
    if (unexpected.has(t.text) && !boxes.some((b) => b.item === t.text)) {
      boxes.push({ key: `u-${t.text}`, item: t.text, bbox: t.bbox, label: `${t.text} ?`, color: "#dc2626" });
    }
  }

  const fs = size ? Math.max(12, size.w / 70) : 14; // font size in image pixels
  const sw = size ? Math.max(2, size.w / 450) : 2; // stroke width

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="mr-auto font-semibold">Cabinet photo</h2>
        {mode === "interactive" && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showDetections} onChange={(e) => setShowDetections(e.target.checked)} />
            Detected components
          </label>
        )}
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
          {(["interactive", "server"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              {m === "interactive" ? "Interactive" : "Server image"}
            </button>
          ))}
        </div>
        <a
          href={mode === "server" ? annotatedImageUrl(id) : originalImageUrl(id)}
          target="_blank"
          rel="noreferrer"
          title="Open full size"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <Maximize2 size={16} />
        </a>
      </div>

      <div className="bg-slate-900/95 p-3">
        {mode === "server" ? (
          <img src={annotatedImageUrl(id)} alt="annotated cabinet" className="mx-auto max-h-[70vh] rounded" />
        ) : (
          <div className="relative mx-auto w-fit">
            <img
              src={originalImageUrl(id)}
              alt="cabinet"
              className="block max-h-[70vh] rounded"
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
            {size && (
              <svg
                viewBox={`0 0 ${size.w} ${size.h}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                onMouseLeave={() => onSelect(null)}
              >
                {showDetections &&
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
                      opacity={highlight ? 0.25 : 0.7}
                    />
                  ))}
                {boxes.map((b) => {
                  const active = highlight === b.item;
                  const dim = highlight !== null && !active;
                  const [x1, y1, x2, y2] = b.bbox;
                  const labelW = b.label.length * fs * 0.62 + fs * 0.8;
                  return (
                    <g
                      key={b.key}
                      opacity={dim ? 0.3 : 1}
                      onMouseEnter={() => onSelect(b.item)}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        x={x1 - sw * 2}
                        y={y1 - sw * 2}
                        width={x2 - x1 + sw * 4}
                        height={y2 - y1 + sw * 4}
                        fill={active ? `${b.color}22` : "transparent"}
                        stroke={b.color}
                        strokeWidth={active ? sw * 2 : sw}
                        rx={sw * 2}
                      />
                      <rect x={x1 - sw * 2} y={y2 + sw * 3} width={labelW} height={fs * 1.45} fill={b.color} rx={sw * 1.5} />
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
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-slate-500">
        <Legend color="#059669" text="Label matches" />
        <Legend color="#d97706" text="Wrong label" />
        <Legend color="#dc2626" text="Not in documents" />
        <Legend color="#38bdf8" text="Detected component" dashed />
      </div>
    </div>
  );
}

function Legend({ color, text, dashed }: { color: string; text: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      {text}
    </span>
  );
}
