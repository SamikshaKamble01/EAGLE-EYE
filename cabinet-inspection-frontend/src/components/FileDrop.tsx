// Drag & drop (or click) file picker for one file - or several with `multiple` (photos).
import { CircleCheck, Upload, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../lib/format";

interface Props {
  label: string;
  hint: string;
  accept: string; // e.g. ".pdf"
  icon: LucideIcon;
  file?: File | null;
  onChange?: (file: File | null) => void;
  /** several files: `files` / `onFilesChange` are used instead of `file` / `onChange` */
  multiple?: boolean;
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  maxFiles?: number;
  optional?: boolean;
  showPreview?: boolean;
  disabled?: boolean;
  step?: number; // small number shown in the corner
}

export default function FileDrop({
  label,
  hint,
  accept,
  icon: Icon,
  file: single = null,
  onChange,
  multiple,
  files = [],
  onFilesChange,
  maxFiles = 10,
  optional,
  showPreview,
  disabled,
  step,
}: Props) {
  const list = multiple ? files : single ? [single] : [];
  const file = list[0] ?? null;
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
  const pick = (picked: File[]) => {
    if (!picked.length) return;
    const ok = picked.filter((f) => accepted.includes("." + (f.name.split(".").pop() ?? "").toLowerCase()));
    const bad = picked.filter((f) => !ok.includes(f));
    setTypeError(bad.length ? `${bad.map((f) => f.name).join(", ")} ${bad.length === 1 ? "is" : "are"} not ${accept}` : null);
    if (!ok.length) return;
    if (multiple) {
      const next = [...files, ...ok.filter((f) => !files.some((g) => g.name === f.name && g.size === f.size))];
      if (next.length > maxFiles) setTypeError(`At most ${maxFiles} photos - the first ${maxFiles} are kept.`);
      onFilesChange?.(next.slice(0, maxFiles));
    } else {
      onChange?.(ok[0]);
    }
  };
  const clear = () => (multiple ? onFilesChange?.([]) : onChange?.(null));
  const totalSize = list.reduce((sum, f) => sum + f.size, 0);

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
        if (!disabled) pick(Array.from(e.dataTransfer.files));
      }}
      className={`group relative flex min-h-56 cursor-pointer flex-col overflow-hidden rounded-xl border-2 transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
        file
          ? "border-emerald-500/50 bg-emerald-50/40 dark:bg-emerald-500/5"
          : dragging
            ? "border-dashed border-sky-500 bg-sky-50 dark:bg-sky-500/10"
            : "border-dashed border-slate-300 bg-surface hover:border-sky-400 hover:bg-sky-50/50 dark:border-line dark:hover:border-sky-500/60 dark:hover:bg-sky-500/5"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          pick(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* header: step number, title, required / ready */}
      <div className={`flex items-center gap-2.5 border-b px-4 py-3 ${file ? "border-emerald-500/20" : "border-line"}`}>
        {step !== undefined && (
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              file ? "bg-emerald-500 text-white" : "bg-sky-600 text-white dark:bg-sky-500"
            }`}
          >
            {file ? "✓" : step}
          </span>
        )}
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className={`ml-auto pr-6 text-[11px] font-semibold uppercase tracking-wide ${file ? "text-emerald-600 dark:text-emerald-400" : "text-faint"}`}>
          {file ? (list.length > 1 ? `${list.length} ready` : "Ready") : optional ? "Optional" : "Required"}
        </span>
      </div>

      {preview ? (
        <img src={preview} alt="preview" className="anim-fade-in h-32 w-full border-b border-line object-cover" />
      ) : (
        <div className="flex flex-1 items-center justify-center pt-5">
          <div
            className={`rounded-xl p-3.5 transition duration-150 ${
              file ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-raised text-muted group-hover:bg-sky-500/10 group-hover:text-sky-600"
            }`}
          >
            <Icon size={26} />
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5 px-4 pb-4 pt-3 text-center">
        {file && list.length > 1 ? (
          <div className="flex max-w-full items-center gap-1.5 text-sm font-medium text-ink">
            <CircleCheck size={15} className="shrink-0 text-emerald-500" />
            <span className="truncate">{list.length} photos</span>
            <span className="shrink-0 text-xs font-normal text-faint">{formatBytes(totalSize)}</span>
          </div>
        ) : file ? (
          <div className="flex max-w-full items-center gap-1.5 text-sm font-medium text-ink">
            <CircleCheck size={15} className="shrink-0 text-emerald-500" />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-xs font-normal text-faint">{formatBytes(file.size)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Upload size={14} className="text-sky-600 dark:text-sky-400" /> {dragging ? "Drop the file here" : "Click to browse or drag a file here"}
          </div>
        )}
        {multiple && list.length > 1 && (
          <div className="max-w-full truncate text-[11px] text-faint" title={list.map((f) => f.name).join("\n")}>
            {list.map((f) => f.name).join(", ")}
          </div>
        )}
        <div className="text-xs leading-relaxed text-muted">{multiple && file ? "Click or drop to add more photos" : hint}</div>
        <div className="mt-0.5 rounded-md bg-raised px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-muted">
          {accept.split(",").map((e) => e.trim().replace(".", "").toUpperCase()).join(" · ")}
        </div>
        {typeError && <div className="text-xs font-medium text-red-500">{typeError}</div>}
      </div>

      {file && !disabled && (
        <button
          type="button"
          title={list.length > 1 ? "Remove all" : "Remove"}
          onClick={(e) => {
            e.stopPropagation();
            clear();
          }}
          className="absolute right-2 top-2 z-10 cursor-pointer rounded-full bg-surface/90 p-1 text-muted shadow hover:text-red-500"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
