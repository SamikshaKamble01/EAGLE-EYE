// Display helpers shared by all pages.

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const ACRONYMS = new Set(["plc", "vfd", "psu", "mcb", "ocr", "spd"]);

/** "circuit_breaker" -> "Circuit breaker", "plc" -> "PLC" */
export function humanize(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase().split(" ");
  const out = words.map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w)).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** "COMPONENT_MISSING" -> "Component missing" */
export const defectTitle = humanize;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
