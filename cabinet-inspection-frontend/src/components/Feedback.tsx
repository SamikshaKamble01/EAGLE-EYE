// App-wide feedback: toast messages (bottom right) and a confirm dialog.
//   const { toast, confirm } = useFeedback();
//   if (await confirm({ title: "Delete?", danger: true })) { ...; toast("Deleted"); }
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return ctx;
}

const toastStyle: Record<ToastKind, { icon: typeof Info; color: string }> = {
  success: { icon: CircleCheck, color: "text-emerald-500" },
  error: { icon: TriangleAlert, color: "text-red-500" },
  info: { icon: Info, color: "text-sky-500" },
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "success") => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, resolve })),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      dialog?.resolve(ok);
      setDialog(null);
    },
    [dialog],
  );

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, close]);

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => {
          const { icon: Icon, color } = toastStyle[t.kind];
          return (
            <div key={t.id} role="status" className="card anim-fade-up pointer-events-auto flex items-start gap-3 p-3.5 shadow-xl">
              <Icon size={18} className={`mt-0.5 shrink-0 ${color}`} />
              <p className="flex-1 text-sm">{t.message}</p>
              <button onClick={() => dismiss(t.id)} title="Dismiss" className="cursor-pointer text-faint hover:text-ink">
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {dialog && (
        <div
          className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onClick={() => close(false)}
        >
          <div role="alertdialog" aria-modal="true" className="card anim-scale-in w-full max-w-sm p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-3">
              {dialog.danger && (
                <div className="h-fit rounded-full bg-red-500/10 p-2 text-red-500">
                  <TriangleAlert size={20} />
                </div>
              )}
              <div>
                <h2 className="font-bold">{dialog.title}</h2>
                {dialog.message && <p className="mt-1 text-sm text-muted">{dialog.message}</p>}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                autoFocus
                className={`btn ${dialog.danger ? "bg-red-600 text-white hover:bg-red-700" : "btn-primary"}`}
                onClick={() => close(true)}
              >
                {dialog.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}
