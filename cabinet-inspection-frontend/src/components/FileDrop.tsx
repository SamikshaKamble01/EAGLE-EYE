// Drag & drop (or click) file picker for one file.
import { CircleCheck, Upload, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../lib/format";

interface Props {
  label: string;
  hint: string;
  accept: string; // e.g. ".pdf"
  icon: LucideIcon;
  file: File | null;
  onChange: (file: File | null) => void;
  showPreview?: boolean;
  disabled?: boolean;
  step?: number; // small number shown in the corner
}

export default function FileDrop({ label, hint, accept, icon: Icon, file, onChange, showPreview, disabled, step }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !showPreview) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, showPreview]);

  const accepted = accept.split(",").map((a) => a.trim().toLowerCase());
  const pick = (f: File | undefined) => {
    if (!f) return;
    const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
    if (!accepted.includes(ext)) {
      setTypeError(`${f.name} is not ${accept}`);
      return;
    }
    setTypeError(null);
    onChange(f);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && !disabled && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation(); // this card takes the file; the page-wide drop handler must not also sort it
        setDragging(false);
        if (!disabled) pick(e.dataTransfer.files[0]);
      }}
      className={`group relative flex min-h-52 cursor-pointer flex-col overflow-hidden rounded-2xl border-2 bg-surface transition duration-200 ${
        file
          ? "border-emerald-500/60 shadow-lg shadow-emerald-500/10"
          : dragging
            ? "scale-[1.02] border-sky-500 bg-sky-500/10 shadow-lg shadow-sky-500/20"
            : "border-dashed border-line hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-lg hover:shadow-sky-500/10"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {step !== undefined && (
        <span
          className={`absolute left-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            file ? "bg-emerald-500 text-white" : "bg-raised text-muted"
          }`}
        >
          {file ? "✓" : step}
        </span>
      )}

      {preview ? (
        <img src={preview} alt="preview" className="anim-fade-in h-36 w-full border-b border-line object-cover" />
      ) : (
        <div className="flex flex-1 items-center justify-center pt-6">
          <div
            className={`rounded-2xl p-4 transition duration-200 group-hover:scale-110 ${
              file ? "bg-emerald-500/15 text-emerald-500" : "bg-raised text-muted group-hover:bg-sky-500/15 group-hover:text-sky-500"
            }`}
          >
            <Icon size={28} />
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-1 px-4 py-4 text-center">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {file && <CircleCheck size={15} className="text-emerald-500" />}
          {label}
        </div>
        {file ? (
          <div className="flex max-w-full items-center gap-1 text-xs text-muted">
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-faint">· {formatBytes(file.size)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted">
            <Upload size={12} /> {dragging ? "Drop it here" : hint}
          </div>
        )}
        {typeError && <div className="text-xs font-medium text-red-500">{typeError}</div>}
      </div>

      {file && !disabled && (
        <button
          type="button"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
          }}
          className="absolute right-2 top-2 z-10 cursor-pointer rounded-full bg-surface/90 p-1 text-muted shadow hover:text-red-500"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
