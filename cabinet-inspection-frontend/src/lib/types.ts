// TypeScript shapes of the JSON the Flask backend returns.
// If you add a field in the backend, add it here too.

export type Verdict = "PASS" | "FAIL";
export type Severity = "critical" | "major" | "minor";
export type BBox = [number, number, number, number]; // x1, y1, x2, y2 in image pixels

export interface Defect {
  code: string;
  severity: Severity;
  item: string | null;
  expected: string | null;
  actual: string | null;
  message: string;
}

export interface ComponentCheck {
  tag: string;
  type: string;
  description: string;
  status: string; // ok | missing | label_mismatch | label_missing | type_mismatch
  read_as: string | null;
  bbox: BBox | null;
  detected_type: string | null;
}

export interface WireCheck {
  label: string;
  status: string; // ok | missing | mismatch
  read_as: string | null;
  bbox: BBox | null;
}

export interface Detection {
  type: string;
  class_name: string;
  confidence: number;
  bbox: BBox;
}

export interface OcrText {
  text: string;
  raw: string;
  confidence: number;
  bbox: BBox;
}

export interface InspectionResult {
  verdict: Verdict;
  score: number;
  summary: {
    critical: number;
    major: number;
    minor: number;
    checks_total: number;
    checks_passed: number;
    expected_components: number;
    expected_wire_labels: number;
    detected_components: number;
    ocr_labels_read: number;
  };
  components: ComponentCheck[];
  wire_labels: WireCheck[];
  defects: Defect[];
  engines: { vision: string; ocr: string };
  actual: { detections: Detection[]; ocr_texts: OcrText[] };
  timings_ms: Record<string, number>;
}

export interface InspectionSummary {
  id: string;
  created_at: string;
  status: "processing" | "completed" | "failed";
  verdict: Verdict | null;
  score: number | null;
  cabinet_name: string | null;
  error: string | null;
}

export interface Inspection extends InspectionSummary {
  result?: InspectionResult;
}

export interface InspectionList {
  items: InspectionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface Stats {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  errored: number;
  pass_rate: number;
  avg_score: number;
  defects_by_code: { code: string; severity: Severity; count: number }[];
  defects_by_severity: Record<Severity, number>;
  recent: InspectionSummary[];
}

export interface Health {
  status: "ok" | "degraded";
  services: {
    ocr: { available: boolean; engine: string; message?: string };
    vision: { available: boolean; backend: string; note?: string };
    database: { available: boolean };
    pdf: { available: boolean };
    excel: { available: boolean };
  };
}
