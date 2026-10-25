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
  photo?: number | null; // which uploaded photo the box is on (0-based)
  detected_type: string | null;
}

export interface WireCheck {
  label: string;
  status: string; // ok | missing | mismatch
  read_as: string | null;
  bbox: BBox | null;
  photo?: number | null;
}

export interface Detection {
  type: string;
  class_name: string;
  confidence: number;
  bbox: BBox;
  photo?: number;
}

export interface OcrText {
  text: string;
  raw: string;
  confidence: number;
  bbox: BBox;
  photo?: number;
}

export interface YoloStatus {
  active: boolean;
  state: "active" | "not_configured" | "weights_missing" | "ultralytics_missing" | "load_failed" | "no_component_classes";
  note: string;
  model?: string;
  classes?: string[];
  component_classes?: Record<string, string>;
}

export interface VisionReport {
  backend: "yolo" | "opencv";
  yolo: YoloStatus | null;
  by_class: Record<string, number>;
  photos: { photo: number; tiles: number; total: number; by_class: Record<string, number>; regions: { id: string; y1: number; y2: number; total: number }[] }[];
  note: string;
}

/** One row of the QC check sheet (made by a plug-in in the backend's app/checks/). */
export interface ChecklistItem {
  no: number;
  key: string; // stable id, e.g. "ga:K2" - used to match rows between re-checks
  check: string; // ga | label | ferrule | extras | ...
  check_title: string;
  item: string;
  description: string;
  expected: string;
  found: string;
  result: "PASS" | "FAIL" | "WARN";
  severity: Severity | null;
  code: string | null;
  message: string;
  fix?: string; // how it should be assembled (empty for PASS; absent on older inspections)
  bbox: BBox | null;
  photo?: number | null;
  bbox_estimated: boolean; // true = "the place where it was expected" (item is missing)
  snippet: string | null; // file name of the zoomed proof picture
  change: "closed" | "open" | "new" | null; // only set on a re-check
}

export interface CheckSummary {
  id: string;
  title: string;
  kind: string;
  passed: number;
  failed: number;
  warnings: number;
}

export interface RecheckRow {
  key: string;
  no: number | null;
  check_title: string;
  item: string;
  description: string;
  expected: string;
  found: string;
}

/** Before vs after, present when the inspection is a re-check of an earlier one. */
export interface Recheck {
  round: number;
  closed: RecheckRow[];
  still_open: RecheckRow[];
  new: RecheckRow[];
  before: { verdict: Verdict; score: number; failed: number };
  after: { verdict: Verdict; score: number; failed: number };
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
  /** detector report (inspections from before the YOLO integration don't have it) */
  vision?: VisionReport;
  actual: { detections: Detection[]; ocr_texts: OcrText[]; label_detections?: Detection[] };
  timings_ms: Record<string, number>;
  // absent on inspections saved before the check sheet existed
  checklist?: ChecklistItem[];
  photos?: { index: number; name: string; width: number; height: number }[];
  checks?: CheckSummary[];
  recheck?: Recheck;
  impact?: Impact; // fault-impact analysis (absent only if it could not be computed)
  /** what the drawing says should be there; `view` and `pos` (0..1 down the enclosure outline) come from the layout sheet */
  expected?: { components: { tag: string | null; description: string; view?: string | null; pos?: { u: number; v: number } }[]; wiring: unknown[] };
  observations?: Record<string, Observation>;
}

export interface InspectionSummary {
  id: string;
  created_at: string;
  status: "processing" | "completed" | "failed";
  verdict: Verdict | null;
  score: number | null;
  cabinet_name: string | null;
  error: string | null;
  parent_id: string | null; // the inspection this one re-checks
  round: number; // 1 = first inspection, 2+ = re-check after a fix
}

export interface HistoryEntry extends InspectionSummary {
  open_issues: number;
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

// ---- fault-impact (root-cause) analysis: result.impact -------------------------------------
export type Disposition = "PASS" | "PASS_WITH_DOCUMENTATION_DEFECTS" | "FAIL" | "HOLD_FOR_ENGINEERING_REVIEW";
export type NodeState = "fault" | "lost" | "uncertain" | "degraded" | "documentation" | "unverified" | "ok" | "not_inspected";
export type ImpactConfidence = "confirmed" | "probable" | "unknown";

export interface ImpactDefect {
  id: string;
  tag: string;
  kind: string; // component_missing | component_incorrectly_installed | label_missing | label_incorrect | label_unreadable | label_present_component_missing | wire_label_missing | wire_label_incorrect
  expected: { tag: string; description: string; function: string };
  observed: string;
  label_observed: string;
  evidence: { source: string; detail: string; confidence: string; photo?: number | null };
  reference: string;
  circuit: string | null;
  subsystem: string | null;
  consequences: { lost: string[]; degraded: string[]; uncertain: string[] };
  impact_confidence: ImpactConfidence;
  severity: string;
  rationale: string;
  redundancy: { mitigated: boolean; note: string } | null;
  classification: string[];
  corrective_action: string;
  retest: string;
  final_status: "FAIL" | "HOLD" | "DOCUMENTATION_DEFECT" | "UNVERIFIED";
  approval_required: boolean;
  safety_related?: boolean;
  missing_information?: string | null;
}

export interface ImpactComponent {
  tag: string;
  description: string;
  function: string;
  component_status: string;
  label_status: string;
  location: string | null;
  circuit: string | null;
  subsystem: string | null;
  in_topology: boolean;
  evidence: { source: string; detail: string; confidence: string };
  safety: boolean;
}

export interface RollupStatus {
  name: string;
  status: string;
  reason: string[];
  parts: number;
  inspected: number;
}

export interface ImpactGraph {
  nodes: { id: string; label: string; kind: string; circuit: string | null; state: NodeState; members: string[]; function: string }[];
  edges: { from: string; to: string; type: string; sheet: string }[];
}

export interface Impact {
  cabinet: string | null;
  topology: { found: boolean; document?: string | null; provenance?: string | null };
  policy: { approved: boolean; note: string };
  disposition: Disposition;
  disposition_label: string;
  engineering_approval_required: boolean;
  statuses: {
    component: Record<string, number>;
    label: Record<string, number>;
    circuit: RollupStatus[];
    subsystem: RollupStatus[];
    cabinet_functional: string;
    identification: string;
    safety_review: string;
  };
  summary: { electrical_defects: number; labeling_defects: number; unresolved: number; components: number };
  defects: ImpactDefect[];
  components: ImpactComponent[];
  graph: ImpactGraph;
  node_states: Record<string, NodeState>;
  /** overall size of the cabinet as read from the drawing's dimension sheet (mm); absent when not documented */
  geometry?: { width_mm: number; depth_mm: number; height_mm: number; plinth_mm?: number; source?: string; note?: string } | null;
  /** every documented connection between parts of this cabinet (for the 3D wires) */
  wires?: { from: string; to: string; type: string; sheet: string; via?: string }[];
  missing_information: { about: string; reason: string; needed: string }[];
  assumptions: string[];
}

export interface Observation {
  component?: "present" | "missing" | "unknown";
  label?: "ok" | "missing" | "incorrect" | "unreadable" | "present" | "unknown";
  note?: string;
}
