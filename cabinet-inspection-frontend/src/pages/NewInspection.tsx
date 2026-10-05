// Upload photo + PDF + Excel -> POST /api/inspections -> go to the result page.
// Files can be dropped on a card, dropped anywhere on the page (sorted by type), or pasted (photo).
import { FileSpreadsheet, FileText, Image as ImageIcon, LoaderCircle, RotateCcw, ScanLine, TriangleAlert, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFeedback } from "../components/Feedback";
import FileDrop from "../components/FileDrop";
import { PageHeader } from "../components/ui";
import { ApiError, createInspection } from "../lib/api";

type Phase = "idle" | "uploading" | "processing";

const STEPS = [
  "Reading expected components from the PDF",
  "Reading wiring labels from the Excel",
  "Detecting components in the photo",
  "Reading labels with OCR",
  "Comparing expected vs actual",
  "Writing the report",
];

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".bmp", ".webp"];
const PDF_EXT = [".pdf"];
const EXCEL_EXT = [".xlsx", ".xls", ".csv"];

const extension = (f: File) => "." + (f.name.split(".").pop() ?? "").toLowerCase();

export default function NewInspection() {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [image, setImage] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [excel, setExcel] = useState<File | null>(null);
  const [cabinetName, setCabinetName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const busy = phase !== "idle";
  const filesReady = [image, pdf, excel].filter(Boolean).length;
  const ready = filesReady === 3 && !busy;

  // seconds counter while the backend works
  useEffect(() => {
    if (phase !== "processing") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // big photo preview for the "analysing" panel
  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  /** Put each file in the right slot by its extension. */
  const sortFiles = useCallback(
    (files: File[]) => {
      let placed = 0;
      const ignored: string[] = [];
      for (const f of files) {
        const ext = extension(f);
        if (IMAGE_EXT.includes(ext)) setImage(f);
        else if (PDF_EXT.includes(ext)) setPdf(f);
        else if (EXCEL_EXT.includes(ext)) setExcel(f);
        else {
          ignored.push(f.name);
          continue;
        }
        placed++;
      }
      if (placed) toast(`Added ${placed} file${placed === 1 ? "" : "s"}`, "success");
      if (ignored.length) toast(`Not a supported file type: ${ignored.join(", ")}`, "error");
    },
    [toast],
  );

  // Ctrl+V with a screenshot / copied photo
  useEffect(() => {
    if (busy) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        sortFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy, sortFiles]);

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const endPageDrag = () => {
    dragDepth.current = 0;
    setPageDrag(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!image || !pdf || !excel) return;
    setError(null);
    setUploadPct(0);
    setPhase("uploading");
    try {
      const result = await createInspection({ image, pdf, excel, cabinetName: cabinetName.trim() || undefined }, (pct) => {
        setUploadPct(pct);
        if (pct >= 100) setPhase("processing");
      });
      toast(result.verdict === "PASS" ? "Inspection passed" : "Inspection finished — defects found", result.verdict === "PASS" ? "success" : "info");
      navigate(`/inspections/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "unknown", String(err)));
      setPhase("idle");
    }
  }

  function reset() {
    setImage(null);
    setPdf(null);
    setExcel(null);
    setCabinetName("");
    setError(null);
  }

  // the backend does not stream progress, so steps advance on a typical timing;
  // the last step stays active until the response arrives
  const activeStep = Math.min(Math.floor(elapsed / 2), STEPS.length - 1);

  return (
    <div
      onDragEnter={(e) => {
        if (busy || !hasFiles(e)) return;
        dragDepth.current++;
        setPageDrag(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setPageDrag(false);
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDropCapture={endPageDrag}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy) sortFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <PageHeader
        title="New inspection"
        subtitle="Upload the cabinet photo together with its drawing PDF and wiring list. The backend compares what should be there with what is actually there."
        actions={
          filesReady > 0 &&
          !busy && (
            <button type="button" className="btn btn-ghost" onClick={reset}>
              <RotateCcw size={16} /> Clear all
            </button>
          )
        }
      />

      {/* readiness meter */}
      <div className="mb-5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-linear-to-r from-sky-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${(filesReady / 3) * 100}%` }}
          />
        </div>
        <span className="text-xs font-semibold tabular-nums text-muted">{filesReady} of 3 files ready</span>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <div className="stagger grid gap-4 md:grid-cols-3">
          <FileDrop
            step={1}
            label="Cabinet photo"
            hint="JPG or PNG, straight-on, labels sharp"
            accept={IMAGE_EXT.join(",")}
            icon={ImageIcon}
            file={image}
            onChange={setImage}
            showPreview
            disabled={busy}
          />
          <FileDrop
            step={2}
            label="Drawing / BOM PDF"
            hint="Table with Tag + Description columns"
            accept={PDF_EXT.join(",")}
            icon={FileText}
            file={pdf}
            onChange={setPdf}
            disabled={busy}
          />
          <FileDrop
            step={3}
            label="Wiring list"
            hint="XLSX / XLS / CSV with Wire No, From, To"
            accept={EXCEL_EXT.join(",")}
            icon={FileSpreadsheet}
            file={excel}
            onChange={setExcel}
            disabled={busy}
          />
        </div>

        <p className="text-center text-xs text-muted">
          Tip: drop all three files anywhere on this page — they are sorted automatically. A copied photo can be pasted with{" "}
          <span className="kbd">Ctrl V</span>.
        </p>

        <div className="card flex flex-wrap items-end gap-4 p-5">
          <label className="flex min-w-60 flex-1 flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Cabinet name (optional)</span>
            <input
              value={cabinetName}
              onChange={(e) => setCabinetName(e.target.value)}
              maxLength={120}
              disabled={busy}
              placeholder="e.g. CC-01 Pump station"
              className="input"
            />
          </label>
          <button type="submit" className="btn btn-primary px-6 py-3" disabled={!ready}>
            {busy ? <LoaderCircle size={18} className="animate-spin" /> : <ScanLine size={18} />}
            {busy ? "Inspecting…" : "Run inspection"}
          </button>
        </div>
      </form>

      {error && (
        <div className="anim-fade-up mt-6 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
          <TriangleAlert size={20} className="shrink-0 text-red-500" />
          <div>
            <div className="font-semibold text-red-600 dark:text-red-400">
              {error.status === 400 && "Check your files"}
              {error.status === 422 && "A file could not be understood"}
              {error.status === 503 && "A backend service is not available"}
              {![400, 422, 503].includes(error.status) && "Inspection failed"}
            </div>
            <div className="mt-0.5 text-muted">{error.message}</div>
            {error.inspectionId && (
              <Link to={`/inspections/${error.inspectionId}`} className="mt-1 inline-block font-semibold underline">
                View failed inspection record
              </Link>
            )}
          </div>
        </div>
      )}

      {busy && (
        <div className="card anim-fade-up mt-6 overflow-hidden">
          {phase === "uploading" ? (
            <div className="p-6">
              <div className="mb-2 flex justify-between text-sm font-medium">
                <span>Uploading files…</span>
                <span className="tabular-nums">{uploadPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-linear-to-r from-sky-500 to-indigo-500 transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-[1fr_1.2fr]">
              {/* photo being "scanned" */}
              <div className="relative flex min-h-56 items-center justify-center overflow-hidden bg-slate-950">
                {preview && <img src={preview} alt="" className="max-h-80 w-full object-contain opacity-80" />}
                <div className="scangrid absolute inset-0" />
                <div className="scanline" />
              </div>
              <div className="p-6">
                <div className="mb-4 flex justify-between text-sm font-medium">
                  <span>Analysing — this usually takes 5–15 seconds</span>
                  <span className="tabular-nums text-muted">{elapsed}s</span>
                </div>
                <ol className="space-y-2.5">
                  {STEPS.map((step, i) => (
                    <li key={step} className="flex items-center gap-3 text-sm">
                      {i < activeStep ? (
                        <span className="anim-scale-in flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
                          ✓
                        </span>
                      ) : i === activeStep ? (
                        <LoaderCircle size={20} className="animate-spin text-sky-500" />
                      ) : (
                        <span className="h-5 w-5 rounded-full border-2 border-line" />
                      )}
                      <span className={i <= activeStep ? "" : "text-faint"}>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      )}

      {/* shown while files are dragged over the page */}
      {pageDrag && (
        <div className="anim-fade-in pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full bg-sky-500 px-5 py-3 text-sm font-semibold text-white shadow-2xl shadow-sky-500/40">
            <Upload size={18} /> Drop anywhere — files are sorted automatically
          </div>
        </div>
      )}
    </div>
  );
}
