// Turns an inspection result into a 3D cabinet layout. Pure data (no three.js), so it stays in the light chunk.
//
// Two modes:
//  * DRAWING-BASED - the layout sheet of the drawing says on which inside view (left / front / right /
//    rear) every device is, and where along the height its tag stands. The device goes on that mounting
//    plate at that height. Cabinet size comes from the drawing's dimension sheet when it is known.
//    NOT from the drawing: left-right place inside a row, device sizes (generic models), wire paths.
//  * ILLUSTRATIVE - no layout data (older inspections, other drawings): devices are grouped by family
//    on DIN rails of the front plate; nothing about the place is claimed.
// Statuses always come from the real check sheet - nothing is invented.
import type { ChecklistItem, Impact, InspectionResult } from "../../lib/types";

/** outline of devices affected by a fault elsewhere (from the documented drawings, not measured) */
export const IMPACT_COLOR: Record<string, string> = { lost: "#f97316", degraded: "#eab308", uncertain: "#a855f7", documentation: "#0ea5e9" };

export type DeviceKind = "breaker" | "contactor" | "relay" | "terminal" | "psu" | "controller" | "fuse" | "module" | "generic";
export type DeviceStatus = "pass" | "fail" | "warn" | "missing" | "unseen" | "unchecked";
export type PanelId = "front" | "left" | "right" | "rear";

export interface Device3D {
  id: string; // tag, e.g. CB11
  label: string;
  kind: DeviceKind;
  type: string; // e.g. circuit_breaker
  description: string;
  family: string; // letters of the tag
  status: DeviceStatus;
  rows: ChecklistItem[]; // check-sheet rows about this device
  impact: string | null; // consequence of a fault elsewhere (lost / degraded / uncertain) or a label defect
  region: string; // R1..R4 (illustrative mode) or the panel id
  rail: number;
  panel: PanelId; // which mounting plate the device is on
  rotZ: number; // 0 upright, PI/2 lying on a vertical rail
  placement: "drawing" | "illustrative";
  where: string; // plain-words place, for the detail panel
  // centre position and size in metres, in the PANEL frame: x along the plate, y up, z away from the plate
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
}

export interface Rail3D {
  index: number;
  y: number; // rail centre
  region: string;
  top: number; // highest device top on the rail
  bottom: number;
}

export interface VRail3D {
  panel: PanelId;
  x: number;
  top: number;
  bottom: number;
}

export interface Region3D {
  id: string;
  top: number;
  bottom: number;
  devices: number;
  problems: number;
}

export interface PanelInfo {
  id: PanelId;
  label: string;
  width: number; // mounting plate width (m)
  devices: number;
  problems: number;
}

export interface CabinetSpec {
  width: number; // metres
  depth: number;
  height: number;
  plinth: number;
  verified: boolean; // size read from the drawing's dimension sheet
  source: string | null;
  note: string | null;
}

export interface CabinetLayout {
  devices: Device3D[];
  rails: Rail3D[]; // horizontal DIN rails (illustrative mode)
  vrails: VRail3D[]; // vertical rails behind the device columns (drawing mode)
  regions: Region3D[];
  panels: PanelInfo[]; // plates that carry devices
  cabinet: CabinetSpec;
  drawingBased: boolean;
  unplaced: string[]; // devices with no position on the layout sheet (not drawn in drawing mode)
  fromInspection: boolean;
  scale: number; // < 1 when many devices had to be shrunk to fit
}

/** default interior (metres): a 800 x 2000 x 500 cabinet; only used when the drawing gives no size */
export const CABINET = { width: 0.8, height: 2.0, depth: 0.5, plateZ: -0.2 };
export const DEFAULT_SPEC: CabinetSpec = { width: 0.8, depth: 0.5, height: 2.0, plinth: 0.1, verified: false, source: null, note: null };

/** the plate plane in the panel frame (kept from the single-plate scene) and its distance from the wall */
export const PLATE_Z = CABINET.plateZ;
export const PLATE_OFFSET = 0.05;
const TOP_MARGIN = 0.08;
const BOTTOM_MARGIN = 0.12;
const DUCT_GAP = 0.075; // wiring duct between two rails (illustrative mode)

export const PANEL_LABEL: Record<PanelId, string> = { front: "Front inside view", left: "Left inside view", right: "Right inside view", rear: "Rear inside view" };

/** where a panel frame sits in the cabinet: position of its group, rotation about Y, direction the devices face */
export function panelFrame(id: PanelId, c: CabinetSpec): { pos: [number, number, number]; rotY: number; normal: [number, number, number] } {
  const o = PLATE_OFFSET;
  const plate: [number, number, number] =
    id === "front" ? [0, 0, -c.depth / 2 + o] : id === "rear" ? [0, 0, c.depth / 2 - o] : id === "left" ? [-c.width / 2 + o, 0, 0] : [c.width / 2 - o, 0, 0];
  const rotY = id === "front" ? 0 : id === "rear" ? Math.PI : id === "left" ? Math.PI / 2 : -Math.PI / 2;
  const normal: [number, number, number] = [Math.sin(rotY), 0, Math.cos(rotY)];
  // the group's local point (0, 0, PLATE_Z) must land on the plate
  const pos: [number, number, number] = [plate[0] - PLATE_Z * Math.sin(rotY), 0, plate[2] - PLATE_Z * Math.cos(rotY)];
  return { pos, rotY, normal };
}

/** panel-frame point -> world */
export function toWorld(id: PanelId, c: CabinetSpec, p: [number, number, number]): [number, number, number] {
  const f = panelFrame(id, c);
  const s = Math.sin(f.rotY), k = Math.cos(f.rotY);
  return [f.pos[0] + p[0] * k + p[2] * s, f.pos[1] + p[1], f.pos[2] - p[0] * s + p[2] * k];
}

const plateWidth = (id: PanelId, c: CabinetSpec) => (id === "front" || id === "rear" ? c.width - 0.08 : c.depth - 0.16);

const SIZES: Record<DeviceKind, [number, number, number]> = {
  breaker: [0.036, 0.09, 0.075],
  contactor: [0.045, 0.085, 0.09],
  relay: [0.022, 0.08, 0.075],
  terminal: [0.07, 0.06, 0.05],
  psu: [0.125, 0.125, 0.12],
  controller: [0.09, 0.14, 0.09],
  fuse: [0.018, 0.08, 0.07],
  module: [0.045, 0.11, 0.11],
  generic: [0.05, 0.07, 0.06],
};

export function kindOf(type: string, tag: string): DeviceKind {
  const t = (type || "").toLowerCase();
  const p = (tag.match(/^[A-Z]+/)?.[0] ?? "").toUpperCase();
  if (t.includes("breaker") || t.includes("disconnector") || t.includes("surge") || ["CB", "Q", "QF", "DS", "RCCB", "SPD", "MCB"].includes(p)) return "breaker";
  if (t.includes("contactor") || p === "K" || p === "KM") return "contactor";
  if (t.includes("relay") || t.includes("timer") || ["KA", "KT"].includes(p)) return "relay";
  if (t.includes("terminal") || p.startsWith("X")) return "terminal";
  if (t.includes("power_supply") || ["PS", "G", "GS"].includes(p)) return "psu";
  if (t.includes("plc") || t.includes("controller") || ["A", "CSLS"].includes(p)) return "controller";
  if (t.includes("fuse") || p === "F" || p === "FU") return "fuse";
  if (t.includes("diode") || t.includes("terminator") || ["D", "TERM", "U"].includes(p)) return "module";
  return "generic";
}

function statusOf(rows: ChecklistItem[], componentStatus?: string): DeviceStatus {
  if (rows.some((r) => r.code === "NOT_PHOTOGRAPHED")) return "unseen"; // its side of the cabinet was not photographed
  if (rows.some((r) => r.result === "FAIL" && r.found === "Missing") || componentStatus === "missing") return "missing";
  if (rows.some((r) => r.result === "FAIL")) return "fail";
  if (rows.some((r) => r.result === "WARN")) return "warn";
  if (rows.some((r) => r.result === "PASS")) return "pass";
  return "unchecked";
}

interface Input {
  id: string;
  type: string;
  description: string;
  status: DeviceStatus;
  rows: ChecklistItem[];
  impact: string | null;
  view: PanelId | null;
  v: number | null; // 0 = top of the enclosure outline on the sheet, 1 = bottom
}

/** Example devices when no inspection exists yet (no statuses - nothing was checked). */
const EXAMPLE: [string, string][] = [
  ["Q1", "circuit_breaker"], ["Q2", "circuit_breaker"], ["Q3", "circuit_breaker"], ["Q4", "circuit_breaker"],
  ["F1", "fuse"], ["F2", "fuse"], ["F3", "fuse"], ["K1", "contactor"], ["K2", "contactor"], ["K3", "contactor"],
  ["KA1", "relay"], ["KA2", "relay"], ["KA3", "relay"], ["KA4", "relay"], ["G1", "power_supply"], ["G2", "power_supply"],
  ["A1", "plc"], ["X1", "terminal_block"], ["X2", "terminal_block"], ["X3", "terminal_block"], ["X4", "terminal_block"],
];

const DRAWING_LAYOUT_ENABLED = false;
const VIEWS: PanelId[] = ["front", "left", "right", "rear"];
const base = { devices: [], rails: [], vrails: [], regions: [], panels: [], unplaced: [], scale: 1 };

export function cabinetSpec(impact?: Impact | null): CabinetSpec {
  const g = impact?.geometry;
  if (!g || !(g.width_mm > 0 && g.depth_mm > 0 && g.height_mm > 0)) return DEFAULT_SPEC;
  return { width: g.width_mm / 1000, depth: g.depth_mm / 1000, height: g.height_mm / 1000, plinth: (g.plinth_mm ?? 100) / 1000,
           verified: true, source: g.source ?? null, note: g.note ?? null };
}

export function buildLayout(result?: InspectionResult | null, impact?: Impact | null): CabinetLayout {
  const cabinet = cabinetSpec(impact ?? result?.impact);
  const fromInspection = !!result?.components?.length;
  let inputs: Input[];
  if (result && fromInspection) {
    const sheet = result.checklist ?? [];
    const states = (impact ?? result.impact)?.node_states ?? {};
    const expected = new Map((result.expected?.components ?? []).map((c) => [c.tag, c]));
    inputs = result.components.map((c) => {
      const rows = sheet.filter((r) => r.item === c.tag);
      const st = states[c.tag];
      const e = expected.get(c.tag);
      const view = VIEWS.includes(e?.view as PanelId) ? (e?.view as PanelId) : null;
      return { id: c.tag, type: c.type, description: c.description, status: statusOf(rows, c.status), rows,
               impact: st && st !== "fault" && st !== "unverified" ? st : null, view, v: view && e?.pos ? e.pos.v : null };
    });
  } else {
    inputs = EXAMPLE.map(([id, type]) => ({ id, type, description: "", status: "unchecked" as DeviceStatus, rows: [], impact: null, view: null, v: null }));
  }
  const positioned = inputs.filter((i) => i.view && i.v !== null);
  // The drawing-based layout needs the multi-panel scene (not finished yet): until then every result
  // is drawn with the single-plate illustrative layout, exactly as before.
  return DRAWING_LAYOUT_ENABLED && positioned.length >= Math.max(3, inputs.length / 2)
    ? drawingLayout(inputs, cabinet, fromInspection)
    : illustrativeLayout(inputs, cabinet, fromInspection);
}

// ---------------------------------------------------------------- drawing-based
function drawingLayout(inputs: Input[], cabinet: CabinetSpec, fromInspection: boolean): CabinetLayout {
  const usable = cabinet.height - TOP_MARGIN - BOTTOM_MARGIN;
  const outline = cabinet.height + cabinet.plinth; // the drawing's enclosure outline includes the plinth
  const devices: Device3D[] = [];
  const vrails: VRail3D[] = [];
  const unplaced = inputs.filter((i) => !(i.view && i.v !== null)).map((i) => i.id);

  for (const id of VIEWS) {
    const here = inputs.filter((i) => i.view === id && i.v !== null);
    if (!here.length) continue;
    const lying = (k: DeviceKind) => !["psu", "controller", "module"].includes(k);
    const items = here
      .map((i) => {
        const kind = kindOf(i.type, i.id);
        const [w, h, d] = SIZES[kind];
        const rot = lying(kind);
        const y = Math.min(cabinet.height / 2 - TOP_MARGIN, Math.max(-cabinet.height / 2 + BOTTOM_MARGIN, cabinet.height / 2 - (i.v as number) * outline));
        return { i, kind, w, h, d, rot, fv: rot ? w : h, fh: rot ? h : w, y };
      })
      .sort((a, b) => b.y - a.y); // top first
    // columns: a device goes into the first column where it does not touch the one above
    const colBottom: number[] = [];
    const placed = items.map((it) => {
      let col = colBottom.findIndex((bottom) => bottom >= it.y + it.fv / 2 + 0.004);
      if (col < 0) col = colBottom.length;
      colBottom[col] = it.y - it.fv / 2;
      return { ...it, col };
    });
    const pw = plateWidth(id, cabinet);
    const maxFh = Math.max(...placed.map((p) => p.fh));
    const cols = colBottom.length;
    const offsets = (n: number) => (n === 0 ? 0 : n % 2 === 1 ? (n + 1) / 2 : -n / 2); // 0, +1, -1, +2, -2 ...
    const pitch = Math.min(maxFh + 0.015, cols > 1 ? (pw - maxFh - 0.02) / (Math.ceil((cols - 1) / 2) * 2) : 1);
    for (const p of placed) {
      const x = offsets(p.col) * pitch;
      devices.push({
        id: p.i.id, label: p.i.id, kind: p.kind, type: p.i.type, description: p.i.description,
        family: p.i.id.match(/^[A-Z]+/)?.[0] ?? p.i.id, status: p.i.status, rows: p.i.rows, impact: p.i.impact,
        region: id, rail: p.col, panel: id, rotZ: p.rot ? Math.PI / 2 : 0, placement: "drawing",
        where: `${PANEL_LABEL[id]}, ${Math.round((p.i.v as number) * 100)}% down the enclosure outline (measured on the layout sheet)`,
        x, y: p.y, w: p.w, h: p.h, d: p.d,
      });
    }
    for (let c = 0; c < cols; c++) {
      const col = placed.filter((p) => p.col === c);
      vrails.push({ panel: id, x: offsets(c) * pitch, top: Math.max(...col.map((p) => p.y + p.fv / 2)) + 0.03, bottom: Math.min(...col.map((p) => p.y - p.fv / 2)) - 0.03 });
    }
  }

  const panels: PanelInfo[] = VIEWS.filter((id) => devices.some((d) => d.panel === id)).map((id) => {
    const ds = devices.filter((d) => d.panel === id);
    return { id, label: PANEL_LABEL[id], width: plateWidth(id, cabinet), devices: ds.length,
             problems: ds.filter((d) => d.status === "fail" || d.status === "missing").length };
  });
  void usable;
  return { ...base, devices, vrails, panels, cabinet, drawingBased: true, unplaced, fromInspection, scale: 1 };
}

// ---------------------------------------------------------------- illustrative (no layout data)
function illustrativeLayout(inputs: Input[], cabinet: CabinetSpec, fromInspection: boolean): CabinetLayout {
  const USABLE_W = Math.min(0.66, cabinet.width - 0.14);
  const TOP_Y = cabinet.height / 2 - 0.08;
  const BOTTOM_Y = -cabinet.height / 2 + 0.1;
  // keep families together, families in order of first appearance
  const familyOrder: string[] = [];
  for (const i of inputs) {
    const f = i.id.match(/^[A-Z]+/)?.[0] ?? i.id;
    if (!familyOrder.includes(f)) familyOrder.push(f);
  }
  // big devices first (power supplies and controllers at the top, as in most cabinets)
  const rank = (k: DeviceKind) => (k === "psu" ? 0 : k === "module" ? 1 : k === "controller" ? 2 : k === "terminal" ? 9 : 5);
  const families = familyOrder
    .map((f) => {
      const members = inputs.filter((i) => (i.id.match(/^[A-Z]+/)?.[0] ?? i.id) === f);
      return { family: f, members, kind: kindOf(members[0].type, members[0].id) };
    })
    .sort((a, b) => rank(a.kind) - rank(b.kind));

  const place = (scale: number) => {
    const rails: { devices: Omit<Device3D, "y" | "region" | "rail">[]; height: number }[] = [];
    let current: (typeof rails)[number] | null = null;
    let x = 0;
    for (const fam of families) {
      // big families start on a fresh rail so rows stay tidy
      if (current && (fam.kind === "psu" || fam.kind === "terminal" || fam.kind === "controller") && x > 0) current = null;
      for (const m of fam.members) {
        const kind = kindOf(m.type, m.id);
        const [w0, h0, d0] = SIZES[kind];
        const [w, h, d] = [w0 * scale, h0 * scale, d0 * scale];
        if (!current || x + w > USABLE_W) {
          current = { devices: [], height: 0 };
          rails.push(current);
          x = 0;
        }
        current.devices.push({
          id: m.id, label: m.id, kind, type: m.type, description: m.description, family: fam.family,
          status: m.status, rows: m.rows, impact: m.impact, panel: "front", rotZ: 0, placement: "illustrative",
          where: "Illustrative place on the front plate - the drawing gave no position for this device",
          x: -USABLE_W / 2 + x + w / 2, w, h, d,
        });
        current.height = Math.max(current.height, h);
        x += w + 0.004 * scale;
      }
    }
    const total = rails.reduce((sum, r) => sum + r.height + DUCT_GAP, 0);
    return { rails, total };
  };
  let scale = 1;
  let placed = place(scale);
  while (placed.total > TOP_Y - BOTTOM_Y && scale > 0.35) {
    scale *= 0.9;
    placed = place(scale);
  }

  // vertical positions, top down; regions = 4 bands of rails
  const nRails = placed.rails.length;
  const regionCount = Math.min(4, Math.max(1, nRails));
  const regionOf = (railIndex: number) => `R${Math.min(regionCount, Math.floor((railIndex * regionCount) / nRails) + 1)}`;
  const spare = Math.max(0, TOP_Y - BOTTOM_Y - placed.total);
  let y = TOP_Y - Math.min(spare / 2, 0.12);
  const devices: Device3D[] = [];
  const rails: Rail3D[] = [];
  placed.rails.forEach((r, index) => {
    const centre = y - r.height / 2;
    const region = regionOf(index);
    rails.push({ index, y: centre, region, top: centre + r.height / 2, bottom: centre - r.height / 2 });
    for (const d of r.devices) devices.push({ ...d, y: centre, region, rail: index });
    y -= r.height + DUCT_GAP;
  });

  const regions: Region3D[] = Array.from({ length: regionCount }, (_, i) => {
    const id = `R${i + 1}`;
    const rs = rails.filter((r) => r.region === id);
    const ds = devices.filter((d) => d.region === id);
    return {
      id,
      top: Math.max(...rs.map((r) => r.top)) + DUCT_GAP / 2,
      bottom: Math.min(...rs.map((r) => r.bottom)) - DUCT_GAP / 2,
      devices: ds.length,
      problems: ds.filter((d) => d.status === "fail" || d.status === "missing").length,
    };
  });
  const panels: PanelInfo[] = [{ id: "front", label: PANEL_LABEL.front, width: plateWidth("front", cabinet), devices: devices.length,
                                 problems: devices.filter((d) => d.status === "fail" || d.status === "missing").length }];
  return { ...base, devices, rails, regions, panels, cabinet, drawingBased: false, unplaced: [], fromInspection, scale };
}
