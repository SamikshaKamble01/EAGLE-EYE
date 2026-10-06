// Fix -> re-photo -> re-check: upload a new photo of the same cabinet.
// The drawing and wire list of the earlier inspection are reused by the backend.
import { Image as ImageIcon, LoaderCircle, RefreshCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ApiError, recheckInspection } from "../lib/api";
import { useFeedback } from "./Feedback";
import FileDrop from "./FileDrop";

interface Props {
  id: string;
  cabinetName: string;
  openIssues: number;
  onClose: () => void;
}

export default function RecheckDialog({ id, cabinetName, openIssues, onClose }: Props) {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function run() {
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      const next = await recheckInspection(id, image, setPct);
      const re = next.result?.recheck;
      toast(
        re ? `Re-check done: ${re.closed.length} closed, ${re.still_open.length} still open, ${re.new.length} new` : "Re-check done",
        next.verdict === "PASS" ? "success" : "info",
      );
      onClose();
      navigate(`/inspections/${next.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Re-check" className="card anim-scale-in w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">Re-check after the fix</h2>
            <p className="mt-1 text-sm text-muted">
              Upload a new photo of <b className="text-ink">{cabinetName}</b>. The same drawing and wire list are used, and the
              {openIssues > 0 ? ` ${openIssues} open issue${openIssues === 1 ? " is" : "s are"}` : " checks are"} tested again.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        <FileDrop
          label="New cabinet photo"
          hint="JPG or PNG taken after the fix"
          accept=".jpg,.jpeg,.png,.bmp,.webp"
          icon={ImageIcon}
          file={image}
          onChange={setImage}
          showPreview
          disabled={busy}
        />

        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {busy && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>{pct < 100 ? "Uploading…" : "Checking the new photo…"}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div className={`h-full rounded-full bg-linear-to-r from-sky-500 to-indigo-500 transition-all ${pct >= 100 ? "animate-pulse" : ""}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={run} disabled={!image || busy}>
            {busy ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCcw size={17} />}
            {busy ? "Re-checking…" : "Run re-check"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
