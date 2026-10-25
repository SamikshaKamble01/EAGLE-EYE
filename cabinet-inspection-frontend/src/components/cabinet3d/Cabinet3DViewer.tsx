// Interactive 3D cabinet visualization with upload / camera inspection.
//  - built from the inspection's real device list; statuses come from the real check sheet
//  - positions are ILLUSTRATIVE (grouped by family on DIN rails), not a 3D scan
//  - "Upload" / "Camera" send photos into a normal inspection: photos only = re-check this
//    cabinet with its drawing, photos + drawing PDF = a new cabinet
import {
  Box,
  Camera,
  DoorOpen,
  Expand,
  FileText,
  Image as ImageIcon,
  Layers,
  LoaderCircle,
  Minimize,
  RotateCcw,
  ScanLine,
  Upload,
  Wrench,
  X,
  ZoomIn,
} from "lucide-react";
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createInspection, recheckInspection, snippetUrl } from "../../lib/api";
import { humanize } from "../../lib/format";
import type { Impact, InspectionResult } from "../../lib/types";
import CameraCapture from "../CameraCapture";
import { useFeedback } from "../Feedback";
import FileDrop from "../FileDrop";
import { buildLayout, IMPACT_COLOR, type Device3D, type DeviceStatus } from "./layout";
import type { SceneApi } from "./CabinetScene";

const CabinetScene = lazy(() => import("./CabinetScene"));

interface Props {
  result?: InspectionResult | null; // real inspection result; null = example cabinet
  impact?: Impact | null; // fault-impact analysis (newer than result.impact after an inspector observation)
  inspectionId?: string | null; // enables proof pictures and "photos only" re-checks
  cabinetName?: string;
  title?: string;
  height?: string; // tailwind height class of the 3D area
}

const STATUS_TEXT: Record<DeviceStatus, string> = {
  pass: "Passed",
  fail: "Failed",
  warn: "Note",
  missing: "Not found in the photos",
  unseen: "Not photographed",
  unchecked: "Not checked",
};
const STATUS_CLASS: Record<DeviceStatus, string> = {
  pass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  fail: "bg-red-500/15 text-red-600 dark:text-red-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  missing: "bg-red-500/15 text-red-600 dark:text-red-300",
  unseen: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  unchecked: "bg-slate-500/15 text-muted",
};
const DOT: Record<DeviceStatus, string> = {
  pass: "bg-emerald-500",
  fail: "bg-red-500",
  warn: "bg-amber-500",
  missing: "bg-red-500/40 ring-1 ring-red-500",
  unseen: "bg-slate-400/40 ring-1 ring-slate-400",
  unchecked: "bg-slate-400",
};
const IMPACT_TEXT: Record<string, string> = {
  lost: "Supply lost (probable, from drawing)",
  degraded: "Redundancy lost (probable)",
  uncertain: "Impact unknown",
  documentation: "Label / documentation defect",
};
const MAX_PHOTOS = 10;

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export default function Cabinet3DViewer({ result, impact, inspectionId, cabinetName, title = "3D cabinet view", height = "h-[560px]" }: Props) {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const dark = useDarkMode();
  const layout = useMemo(() => buildLayout(result, impact), [result, impact]);
  const api = useRef<SceneApi | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [webgl] = useState(hasWebGL);
  const [selected, setSelected] = useState<string | null>(null);
  const [showRegions, setShowRegions] = useState(true);
  const [doorOpen, setDoorOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  // upload / camera inspection
  const [panel, setPanel] = useState(false);
  const [camera, setCamera] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing">("idle");
  const [pct, setPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";
  const canRecheck = !!inspectionId && !!layout.fromInspection;
  const canRun = photos.length > 0 && (!!pdf || canRecheck) && !busy;

  const device = layout.devices.find((d) => d.id === selected) ?? null;
  const counts = useMemo(() => {
    const c: Record<DeviceStatus, number> = { pass: 0, fail: 0, warn: 0, missing: 0, unseen: 0, unchecked: 0 };
    layout.devices.forEach((d) => c[d.status]++);
    return c;
  }, [layout]);

  const select = useCallback((id: string | null) => setSelected(id), []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (phase !== "processing") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const addPhotos = (files: File[]) => {
    setPhotos((prev) => [...prev, ...files.filter((f) => !prev.some((g) => g.name === f.name && g.size === f.size))].slice(0, MAX_PHOTOS));
    setPanel(true);
  };

  async function run() {
    if (!canRun) return;
    setError(null);
    setPct(0);
    setPhase("uploading");
    setPanel(false); // show the scan running over the 3D cabinet
    const progress = (p: number) => {
      setPct(p);
      if (p >= 100) setPhase("processing");
    };
    try {
      const next = pdf
        ? await createInspection({ images: photos, pdf, cabinetName: cabinetName || undefined }, progress)
        : await recheckInspection(inspectionId as string, photos, progress);
      const re = next.result?.recheck;
      toast(
        re
          ? `Re-check done: ${re.closed.length} closed, ${re.still_open.length} still open, ${re.new.length} new`
          : next.verdict === "PASS"
            ? "Inspection passed"
            : "Inspection finished — defects found",
        next.verdict === "PASS" ? "success" : "info",
      );
      setPhotos([]);
      setPdf(null);
      setPanel(false);
      setPhase("idle");
      navigate(`/inspections/${next.id}#cabinet-3d`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setPhase("idle");
      setPanel(true);
    }
  }

  const btn = "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition";
  const glass = "bg-slate-900/75 text-slate-100 ring-1 ring-white/10 backdrop-blur hover:bg-slate-800/90";

  return (
    <div id="cabinet-3d" className="card scroll-mt-20 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Box size={17} className="text-sky-500" />
        <div className="mr-auto">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted">
            {layout.fromInspection
              ? `${layout.devices.length} devices from the drawing · statuses from this inspection's check sheet`
              : "Example cabinet - run an inspection to see your own devices and results"}
          </p>
        </div>
        <CameraLauncher onClick={() => setCamera(true)} disabled={busy} />
        <button className="btn btn-primary px-3 py-2" onClick={() => setPanel((v) => !v)} disabled={busy}>
          <Upload size={16} /> Upload photos
        </button>
      </div>

      <div ref={frame} className={`relative ${fullscreen ? "h-screen" : height} bg-slate-950`}>
        {webgl ? (
          <SceneBoundary fallback={<NoWebGL reason="The 3D view stopped because the graphics driver reported an error." />}>
            <Suspense fallback={<SceneLoading />}>
              <CabinetScene
                layout={layout}
                selected={selected}
                onSelect={select}
                showRegions={showRegions}
                doorOpen={doorOpen}
                scanning={busy}
                dark={dark}
                apiRef={api}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          <NoWebGL reason="This browser or device has WebGL turned off, so the 3D view cannot be drawn." />
        )}

        {/* toolbar */}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <button className={`${btn} ${glass} ${showRegions ? "ring-sky-400/60" : ""}`} onClick={() => setShowRegions((v) => !v)} aria-pressed={showRegions} title="Show / hide regions R1-R4">
            <Layers size={14} /> Regions
          </button>
          <button className={`${btn} ${glass}`} onClick={() => setDoorOpen((v) => !v)} title={doorOpen ? "Close the door" : "Open the door"}>
            <DoorOpen size={14} /> {doorOpen ? "Close door" : "Open door"}
          </button>
          <button className={`${btn} ${glass}`} onClick={() => api.current?.reset()} title="Reset camera">
            <RotateCcw size={14} /> Reset view
          </button>
          <button
            className={`${btn} ${glass}`}
            onClick={() => (fullscreen ? void document.exitFullscreen() : void frame.current?.requestFullscreen())}
            title={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? <Minimize size={14} /> : <Expand size={14} />}
          </button>
        </div>

        {/* honesty note */}
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] rounded-md bg-slate-900/70 px-2.5 py-1.5 text-[11px] leading-snug text-slate-300 ring-1 ring-white/10 backdrop-blur">
          3D cabinet visualization, not a verified 3D scan. Device positions and regions are illustrative.
          <span className="hidden sm:inline"> Drag to rotate · right-drag to pan · scroll to zoom · click a device.</span>
        </div>

        {/* legend */}
        {layout.fromInspection && (
          <div className="pointer-events-none absolute bottom-3 right-3 hidden flex-col gap-1 rounded-md bg-slate-900/70 px-2.5 py-2 text-[11px] text-slate-200 ring-1 ring-white/10 backdrop-blur md:flex">
            {(["pass", "fail", "missing", "unseen", "unchecked"] as DeviceStatus[]).filter((s) => s !== "unseen" || counts.unseen > 0).map((s) => (
              <span key={s} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-sm ${DOT[s]}`} />
                {STATUS_TEXT[s]} <b className="ml-auto pl-3 tabular-nums">{counts[s]}</b>
              </span>
            ))}
          </div>
        )}

        {/* right side: selected device, or region summary */}
        <div className="absolute right-3 top-3 w-72 max-w-[calc(100%-1.5rem)]">
          {device ? (
            <DevicePanel
              d={device}
              inspectionId={inspectionId}
              fromInspection={layout.fromInspection}
              onClose={() => setSelected(null)}
              onZoom={() => api.current?.focus(device.id)}
            />
          ) : (
            layout.fromInspection &&
            showRegions && (
              <div className="rounded-xl bg-slate-900/80 p-3 text-slate-100 ring-1 ring-white/10 backdrop-blur">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Regions (illustrative)</div>
                <ul className="space-y-1">
                  {layout.regions.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => api.current?.focusRegion(r.id)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-white/10"
                      >
                        <b className="w-6">{r.id}</b>
                        <span className="text-slate-300">{r.devices} devices</span>
                        {r.problems > 0 ? (
                          <span className="ml-auto rounded-full bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-300">{r.problems} problems</span>
                        ) : (
                          <span className="ml-auto text-[10px] text-emerald-300">ok</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-slate-400">Click a region to zoom, or a device for its result.</p>
              </div>
            )
          )}
        </div>

        {/* analysing overlay */}
        {busy && (
          <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center px-3">
            <div className="flex items-center gap-2 rounded-full bg-slate-900/85 px-4 py-2 text-sm text-slate-100 ring-1 ring-sky-400/40 backdrop-blur">
              <LoaderCircle size={16} className="animate-spin text-sky-400" />
              {phase === "uploading"
                ? `Uploading ${photos.length} photo${photos.length === 1 ? "" : "s"}… ${pct}%`
                : `Analysing ${photos.length} photo${photos.length === 1 ? "" : "s"}… ${elapsed}s`}
            </div>
          </div>
        )}

        {/* upload panel */}
        {panel && (
          <div className="anim-fade-in absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l border-line bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <ScanLine size={17} className="text-sky-500" />
              <h3 className="mr-auto font-semibold">Inspect from photos</h3>
              <button onClick={() => setPanel(false)} disabled={busy} aria-label="Close" className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink disabled:opacity-40">
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <FileDrop
                step={1}
                label="Cabinet photos"
                hint="One or more photos - front, rear, close-ups"
                accept=".jpg,.jpeg,.png,.bmp,.webp"
                icon={ImageIcon}
                multiple
                maxFiles={MAX_PHOTOS}
                files={photos}
                onFilesChange={setPhotos}
                showPreview
                disabled={busy}
              />
              <button type="button" className="btn btn-ghost w-full" onClick={() => setCamera(true)} disabled={busy}>
                <Camera size={16} /> Take photos with the camera
              </button>
              <FileDrop
                step={2}
                label={canRecheck ? "New drawing (optional)" : "Drawing PDF"}
                optional={canRecheck}
                hint={canRecheck ? "Leave empty to re-check this cabinet with its own drawing" : "Needed for a new cabinet"}
                accept=".pdf"
                icon={FileText}
                file={pdf}
                onChange={setPdf}
                disabled={busy}
              />
              <p className="text-xs text-muted">
                {pdf
                  ? "A new inspection is created from these photos and this drawing."
                  : canRecheck
                    ? "The photos are checked against this cabinet's drawing. Fixed items close, the rest stay open - then the result is shown here in 3D."
                    : "Add the drawing PDF to start an inspection."}
              </p>
              {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <div className="border-t border-line p-4">
              <button className="btn btn-primary w-full" disabled={!canRun} onClick={() => void run()}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ScanLine size={16} />}
                {busy ? (phase === "uploading" ? `Uploading… ${pct}%` : `Analysing… ${elapsed}s`) : pdf || !canRecheck ? "Run inspection" : "Run re-check"}
              </button>
            </div>
          </div>
        )}
      </div>

      {camera && <CameraCapture onCapture={addPhotos} onClose={() => setCamera(false)} />}
    </div>
  );
}

function CameraLauncher({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn btn-ghost px-3 py-2" onClick={onClick} disabled={disabled} title="Take photos with the camera">
      <Camera size={16} /> <span className="hidden sm:inline">Camera</span>
    </button>
  );
}

function DevicePanel({
  d,
  inspectionId,
  fromInspection,
  onClose,
  onZoom,
}: {
  d: Device3D;
  inspectionId?: string | null;
  fromInspection: boolean;
  onClose: () => void;
  onZoom: () => void;
}) {
  const proof = d.rows.find((r) => r.snippet && r.result !== "PASS");
  const fix = d.rows.find((r) => r.result === "FAIL" && r.fix)?.fix;
  return (
    <div className="anim-scale-in max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-xl bg-surface p-3.5 shadow-2xl ring-1 ring-line">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="tag text-lg leading-tight">{d.id}</div>
          <div className="text-xs text-muted">
            {humanize(d.type || d.kind)}
            {d.description && letters(d.description) !== letters(humanize(d.type)) && ` · ${d.description}`}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1 text-muted hover:bg-raised hover:text-ink">
          <X size={15} />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded-md px-2 py-0.5 font-bold ${STATUS_CLASS[d.status]}`}>{STATUS_TEXT[d.status]}</span>
        {d.impact && (
          <span className="rounded-md px-2 py-0.5 font-bold" style={{ background: `${IMPACT_COLOR[d.impact] ?? "#64748b"}26`, color: IMPACT_COLOR[d.impact] }}>
            {IMPACT_TEXT[d.impact] ?? d.impact}
          </span>
        )}
        <span className="rounded-md bg-raised px-2 py-0.5 font-semibold text-muted">Region {d.region}</span>
        <span className="rounded-md bg-raised px-2 py-0.5 font-semibold text-muted">Rail {d.rail + 1}</span>
      </div>

      {fromInspection ? (
        d.rows.length ? (
          <ul className="mt-3 space-y-2 border-t border-line pt-2.5">
            {d.rows.map((r) => (
              <li key={r.key} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.check_title}</span>
                  <span
                    className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                      r.result === "PASS" ? STATUS_CLASS.pass : r.result === "FAIL" ? STATUS_CLASS.fail : STATUS_CLASS.warn
                    }`}
                  >
                    {r.result}
                  </span>
                </div>
                <div className="mt-0.5 text-muted">
                  expected <b className="tag text-ink">{r.expected}</b> · found <b className={`tag ${r.result === "FAIL" ? "text-red-500" : "text-ink"}`}>{r.found}</b>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">No check-sheet row for this device in this inspection.</p>
        )
      ) : (
        <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">Example device - no inspection data. Upload photos to inspect a real cabinet.</p>
      )}

      {fix && (
        <div className="mt-2.5 flex gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-xs">
          <Wrench size={13} className="mt-0.5 shrink-0 text-sky-500" />
          <span>{fix}</span>
        </div>
      )}
      {proof && inspectionId && (
        <img src={snippetUrl(inspectionId, proof.snippet as string)} alt={`Proof for ${d.id}`} className="mt-2.5 max-h-32 w-full rounded-lg border border-line object-cover" />
      )}
      <button className="btn btn-ghost mt-3 w-full py-1.5 text-xs" onClick={onZoom}>
        <ZoomIn size={14} /> Zoom to this device
      </button>
      <p className="mt-2 text-[10px] text-faint">Position in 3D is illustrative; the photo and the check sheet are the evidence.</p>
    </div>
  );
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function SceneLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-300">
      <LoaderCircle size={22} className="animate-spin text-sky-400" />
      Loading the 3D view…
    </div>
  );
}

function NoWebGL({ reason }: { reason: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-slate-300">
      <Box size={26} className="text-slate-500" />
      <p className="max-w-md">{reason}</p>
      <p className="max-w-md text-xs text-slate-400">The inspection results, photos and check sheet above work without it. Try another browser or enable hardware acceleration.</p>
    </div>
  );
}
