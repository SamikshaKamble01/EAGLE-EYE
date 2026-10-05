// Every call to the backend lives in this one file.
// "/api" is forwarded to http://127.0.0.1:5000 by vite.config.ts.
import type { Health, Inspection, InspectionList, Stats, Verdict } from "./types";

const BASE: string = import.meta.env.VITE_API_URL ?? "/api";

interface ErrorBody {
  error?: string;
  message?: string;
  details?: { inspection_id?: string };
}

export class ApiError extends Error {
  status: number;
  code: string;
  inspectionId?: string;

  constructor(status: number, code: string, message: string, inspectionId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.inspectionId = inspectionId;
  }
}

const OFFLINE_MESSAGE = "Cannot reach the backend. Start it with: python run.py";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError(0, "network", OFFLINE_MESSAGE);
  }
  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response (e.g. Vite proxy error page when Flask is down)
  }
  if (!res.ok) {
    const err = (body ?? {}) as ErrorBody;
    if (res.status >= 500 && !err.message) throw new ApiError(res.status, "network", OFFLINE_MESSAGE);
    throw new ApiError(res.status, err.error ?? "http_error", err.message ?? res.statusText, err.details?.inspection_id);
  }
  return body as T;
}

// ---- endpoints -------------------------------------------------------------

export function getHealth(): Promise<Health> {
  // /health answers 503 with a normal body when a service is degraded - still useful
  return fetch(`${BASE}/health`)
    .then((r) => r.json() as Promise<Health>)
    .catch(() => {
      throw new ApiError(0, "network", OFFLINE_MESSAGE);
    });
}

export const getStats = () => request<Stats>("/stats");

export const getInspection = (id: string) => request<Inspection>(`/inspections/${id}`);

export function listInspections(params: { limit?: number; offset?: number; verdict?: Verdict | "" }) {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  if (params.verdict) q.set("verdict", params.verdict);
  return request<InspectionList>(`/inspections?${q.toString()}`);
}

export const deleteInspection = (id: string) => request<void>(`/inspections/${id}`, { method: "DELETE" });

export interface NewInspection {
  image: File;
  pdf: File;
  excel: File;
  cabinetName?: string;
}

/**
 * Uploads the three files. Uses XMLHttpRequest (not fetch) because only XHR
 * reports upload progress. onUploadProgress gets 0-100.
 */
export function createInspection(data: NewInspection, onUploadProgress?: (pct: number) => void): Promise<Inspection> {
  const form = new FormData();
  form.append("image", data.image);
  form.append("pdf", data.pdf);
  form.append("excel", data.excel);
  if (data.cabinetName) form.append("cabinet_name", data.cabinetName);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/inspections`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onUploadProgress) onUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", OFFLINE_MESSAGE));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as Inspection);
      } else {
        const err = (body ?? {}) as ErrorBody;
        if (xhr.status >= 500 && !err.message) {
          reject(new ApiError(xhr.status, "network", OFFLINE_MESSAGE));
          return;
        }
        reject(new ApiError(xhr.status, err.error ?? "http_error", err.message ?? xhr.statusText, err.details?.inspection_id));
      }
    };
    xhr.send(form);
  });
}

// ---- file URLs (used directly in <img src> / <a href>) ----------------------

export const reportUrl = (id: string, download = false) =>
  `${BASE}/inspections/${id}/report${download ? "?download=1" : ""}`;
export const annotatedImageUrl = (id: string) => `${BASE}/inspections/${id}/annotated-image`;
export const originalImageUrl = (id: string) => `${BASE}/inspections/${id}/image`;
