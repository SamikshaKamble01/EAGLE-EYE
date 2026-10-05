// Save data the browser already has as a file (CSV / JSON export buttons).

export function downloadFile(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Cell = string | number | null | undefined;

export function toCsv(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export const downloadCsv = (filename: string, rows: Cell[][]) => downloadFile(filename, toCsv(rows), "text/csv;charset=utf-8");

export const downloadJson = (filename: string, data: unknown) =>
  downloadFile(filename, JSON.stringify(data, null, 2), "application/json");
