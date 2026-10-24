// Take cabinet photos with the device camera (laptop webcam, phone or tablet camera).
// Uses getUserMedia for a live preview; if that is not available or not allowed, it falls
// back to the browser's own camera picker (<input capture>), which works on phones.
import { Camera, CameraOff, Check, LoaderCircle, RefreshCcw, SwitchCamera, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  onCapture: (files: File[]) => void;
  onClose: () => void;
  max?: number;
}

interface Shot {
  file: File;
  url: string;
}

export default function CameraCapture({ onCapture, onClose, max = 10 }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"starting" | "live" | "error">("starting");
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const camerasRef = useRef<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(-1); // -1 = "back camera" by facing mode
  const [shots, setShots] = useState<Shot[]>([]);
  const [flash, setFlash] = useState(false);
  const [resolution, setResolution] = useState("");

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  // (re)start the camera whenever the chosen camera changes
  useEffect(() => {
    let cancelled = false;
    async function start() {
      setState("starting");
      stop();
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot show a live camera here. Use “Phone camera” to take a photo with the device's camera app.");
        setState("error");
        return;
      }
      const chosen = cameraIndex >= 0 ? camerasRef.current[cameraIndex] : undefined;
      const video_: MediaTrackConstraints = chosen
        ? { deviceId: { exact: chosen.deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } };
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        const settings = s.getVideoTracks()[0]?.getSettings();
        setResolution(settings?.width ? `${settings.width} × ${settings.height}` : "");
        setState("live");
        // device labels are only readable after permission was given
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (!cancelled && all.length !== camerasRef.current.length) {
          camerasRef.current = all;
          setCameras(all);
        }
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site in the browser, or use “Phone camera”."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera was found on this device."
              : "The camera could not be started" + (name ? ` (${name}).` : "."),
        );
        setState("error");
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [cameraIndex, stop]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " " && state === "live") {
        e.preventDefault();
        void take();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // revoke previews on unmount
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  async function take() {
    const v = video.current;
    if (!v || !v.videoWidth || shots.length >= max) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const file = new File([blob], `camera_${stamp}_${shots.length + 1}.jpg`, { type: "image/jpeg" });
    setShots((s) => [...s, { file, url: URL.createObjectURL(blob) }]);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
  }

  function remove(i: number) {
    setShots((s) => {
      URL.revokeObjectURL(s[i].url);
      return s.filter((_, j) => j !== i);
    });
  }

  function finish(files: File[]) {
    stop();
    if (files.length) onCapture(files);
    onClose();
  }

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm" onClick={() => finish([])}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Take photos"
        className="card anim-scale-in flex max-h-[96vh] w-full max-w-3xl flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Camera size={18} className="text-sky-500" />
          <div className="mr-auto">
            <h2 className="font-semibold">Take cabinet photos</h2>
            <p className="text-xs text-muted">Straight-on, labels sharp, one section of the cabinet per photo{resolution && ` · ${resolution}`}</p>
          </div>
          <button onClick={() => finish([])} aria-label="Close" className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="relative flex min-h-64 flex-1 items-center justify-center bg-slate-950">
          <video ref={video} playsInline muted className={`max-h-[62vh] w-full object-contain ${state === "live" ? "" : "hidden"}`} />
          {flash && <div className="pointer-events-none absolute inset-0 bg-white/70" />}
          {state === "starting" && (
            <div className="flex items-center gap-2 py-24 text-sm text-slate-300">
              <LoaderCircle size={18} className="animate-spin" /> Starting the camera…
            </div>
          )}
          {state === "error" && (
            <div className="flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center text-sm text-slate-300">
              <CameraOff size={28} className="text-slate-400" />
              <p>{error}</p>
              <button className="btn btn-ghost" onClick={() => fallback.current?.click()}>
                <Camera size={16} /> Phone camera
              </button>
            </div>
          )}
          {state === "live" && (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3">
              {cameras.length > 1 && (
                <button
                  onClick={() => setCameraIndex((i) => (i + 1) % cameras.length)}
                  title="Switch camera"
                  aria-label="Switch camera"
                  className="cursor-pointer rounded-full bg-slate-900/80 p-3 text-white ring-1 ring-white/20 hover:bg-slate-800"
                >
                  <SwitchCamera size={18} />
                </button>
              )}
              <button
                onClick={() => void take()}
                disabled={shots.length >= max}
                title="Take photo (Space)"
                aria-label="Take photo"
                className="h-16 w-16 cursor-pointer rounded-full border-4 border-white bg-white/25 shadow-lg transition hover:bg-white/40 active:scale-95 disabled:opacity-40"
              />
              <button
                onClick={() => setCameraIndex(-1)}
                title="Restart camera"
                aria-label="Restart camera"
                className="cursor-pointer rounded-full bg-slate-900/80 p-3 text-white ring-1 ring-white/20 hover:bg-slate-800"
              >
                <RefreshCcw size={18} />
              </button>
            </div>
          )}
        </div>

        {/* taken photos */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
            {shots.length === 0 ? (
              <span className="text-xs text-muted">{state === "live" ? "No photos yet - press the round button or Space." : "No photos yet."}</span>
            ) : (
              shots.map((s, i) => (
                <div key={s.url} className="group relative shrink-0">
                  <img src={s.url} alt={`Photo ${i + 1}`} className="h-14 w-20 rounded-md border border-line object-cover" />
                  <button
                    onClick={() => remove(i)}
                    title="Remove"
                    className="absolute -right-1.5 -top-1.5 hidden cursor-pointer rounded-full bg-surface p-1 text-red-500 shadow group-hover:block"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
          <button className="btn btn-primary shrink-0" disabled={!shots.length} onClick={() => finish(shots.map((s) => s.file))}>
            <Check size={16} /> Use {shots.length || ""} photo{shots.length === 1 ? "" : "s"}
          </button>
        </div>

        <input
          ref={fallback}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => finish(Array.from(e.target.files ?? []))}
        />
      </div>
    </div>,
    document.body,
  );
}

/** Small button that opens the camera; captured photos go to onCapture. */
export function CameraButton({
  onCapture,
  disabled,
  className = "btn btn-ghost",
  label = "Take photos",
}: {
  onCapture: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Camera size={16} /> {label}
      </button>
      {open && <CameraCapture onCapture={onCapture} onClose={() => setOpen(false)} />}
    </>
  );
}
