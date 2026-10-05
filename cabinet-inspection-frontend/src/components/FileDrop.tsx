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
}

export default function FileDrop({ label, hint, accept, icon: Icon, file, onChange, showPreview, disabled }: Props) {
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
        setDragging(false);
        if (!disabled) pick(e.dataTransfer.files[0]);
      }}
      className={`group relative flex min-h-48 cursor-pointer flex-col overflow-hidden rounded-xl border-2 transition ${
        file
          ? "border-emerald-400 bg-emerald-50/40"
          : dragging
            ? "border-sky-500 bg-sky-50"
            : "border-dashed border-slate-300 bg-white hover:border-sky-400 hover:bg-sky-50/40"
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

      {preview ? (
        <img src={preview} alt="preview" className="h-32 w-full border-b border-emerald-200 object-cover" />
      ) : (
        <div className="flex flex-1 items-center justify-center pt-6">
          <div
            className={`rounded-xl p-3 ${file ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500 group-hover:bg-sky-100 group-hover:text-sky-600"}`}
          >
            <Icon size={26} />
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-1 px-4 py-4 text-center">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          {file && <CircleCheck size={15} className="text-emerald-600" />}
          {label}
        </div>
        {file ? (
          <div className="flex max-w-full items-center gap-1 text-xs text-slate-600">
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-slate-400">· {formatBytes(file.size)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Upload size={12} /> {hint}
          </div>
        )}
        {typeError && <div className="text-xs font-medium text-red-600">{typeError}</div>}
      </div>

      {file && !disabled && (
        <button
          type="button"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
          }}
          className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-500 shadow hover:text-red-600"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
