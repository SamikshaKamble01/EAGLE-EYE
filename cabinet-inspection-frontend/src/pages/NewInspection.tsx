// Upload photo + PDF + Excel -> POST /api/inspections -> go to the result page.
import { FileSpreadsheet, FileText, Image as ImageIcon, LoaderCircle, ScanLine, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
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

export default function NewInspection() {
  const navigate = useNavigate();
  const [image, setImage] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [excel, setExcel] = useState<File | null>(null);
  const [cabinetName, setCabinetName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);

  const busy = phase !== "idle";
  const ready = image && pdf && excel && !busy;

  // seconds counter while the backend works
  useEffect(() => {
    if (phase !== "processing") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

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
      navigate(`/inspections/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "unknown", String(err)));
      setPhase("idle");
    }
  }

  // the backend does not stream progress, so steps advance on a typical timing;
  // the last step stays active until the response arrives
  const activeStep = Math.min(Math.floor(elapsed / 2), STEPS.length - 1);

  return (
    <>
      <PageHeader
        title="New inspection"
        subtitle="Upload the cabinet photo together with its drawing PDF and wiring list. The backend compares what should be there with what is actually there."
      />

      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <FileDrop
            label="Cabinet photo"
            hint="JPG or PNG, straight-on, labels sharp"
            accept=".jpg,.jpeg,.png,.bmp,.webp"
            icon={ImageIcon}
            file={image}
            onChange={setImage}
            showPreview
            disabled={busy}
          />
          <FileDrop
            label="Drawing / BOM PDF"
            hint="Table with Tag + Description columns"
            accept=".pdf"
            icon={FileText}
            file={pdf}
            onChange={setPdf}
            disabled={busy}
          />
          <FileDrop
            label="Wiring list"
            hint="XLSX / XLS / CSV with Wire No, From, To"
            accept=".xlsx,.xls,.csv"
            icon={FileSpreadsheet}
            file={excel}
            onChange={setExcel}
            disabled={busy}
          />
        </div>

        <div className="card flex flex-wrap items-end gap-4 p-5">
          <label className="flex min-w-60 flex-1 flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cabinet name (optional)</span>
            <input
              value={cabinetName}
              onChange={(e) => setCabinetName(e.target.value)}
              maxLength={120}
              disabled={busy}
              placeholder="e.g. CC-01 Pump station"
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <button type="submit" className="btn btn-primary px-6 py-3" disabled={!ready}>
            {busy ? <LoaderCircle size={18} className="animate-spin" /> : <ScanLine size={18} />}
            {busy ? "Inspecting…" : "Run inspection"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <TriangleAlert size={20} className="shrink-0 text-red-500" />
          <div>
            <div className="font-semibold">
              {error.status === 400 && "Check your files"}
              {error.status === 422 && "A file could not be understood"}
              {error.status === 503 && "A backend service is not available"}
              {![400, 422, 503].includes(error.status) && "Inspection failed"}
            </div>
            <div className="mt-0.5">{error.message}</div>
            {error.inspectionId && (
              <Link to={`/inspections/${error.inspectionId}`} className="mt-1 inline-block font-semibold underline">
                View failed inspection record
              </Link>
            )}
          </div>
        </div>
      )}

      {busy && (
        <div className="card mt-6 p-6">
          {phase === "uploading" ? (
            <>
              <div className="mb-2 flex justify-between text-sm font-medium">
                <span>Uploading files…</span>
                <span className="tabular-nums">{uploadPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex justify-between text-sm font-medium">
                <span>Analysing — this usually takes 5–15 seconds</span>
                <span className="tabular-nums text-slate-500">{elapsed}s</span>
              </div>
              <ol className="space-y-2.5">
                {STEPS.map((step, i) => (
                  <li key={step} className="flex items-center gap-3 text-sm">
                    {i < activeStep ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">✓</span>
                    ) : i === activeStep ? (
                      <LoaderCircle size={20} className="animate-spin text-sky-500" />
                    ) : (
                      <span className="h-5 w-5 rounded-full border-2 border-slate-200" />
                    )}
                    <span className={i <= activeStep ? "text-slate-800" : "text-slate-400"}>{step}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </>
  );
}
