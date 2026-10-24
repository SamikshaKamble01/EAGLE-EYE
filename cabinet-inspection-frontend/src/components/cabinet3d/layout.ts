// Turns an inspection result into a 3D cabinet layout: devices placed on DIN rails,
// rails grouped into regions R1..R4. Pure data (no three.js), so it stays in the light chunk.
//
// The layout is ILLUSTRATIVE: devices are grouped by family in drawing order, not placed at
// measured positions. Statuses come only from the real check sheet - nothing is invented.
import type { ChecklistItem, InspectionResult } from "../../lib/types";

export type DeviceKind = "breaker" | "contactor" | "relay" | "terminal" | "psu" | "controller" | "fuse" | "module" | "generic";
export type DeviceStatus = "pass" | "fail" | "warn" | "missing" | "unchecked";

export interface Device3D {
  id: string; // tag, e.g. CB11
  label: string;
  kind: DeviceKind;
  type: string; // e.g. circuit_breaker
  description: string;
  family: string; // letters of the tag
  status: DeviceStatus;
  rows: ChecklistItem[]; // check-sheet rows about this device
  region: string; // R1..R4
  rail: number;
  // centre position and size in metres (cabinet coordinates: x right, y up, z towards the viewer)
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

export interface Region3D {
  id: string;
  top: number;
  bottom: number;
  devices: number;
  problems: number;
}

export interface CabinetLayout {
  devices: Device3D[];
  rails: Rail3D[];
  regions: Region3D[];
  fromInspection: boolean;
  scale: number; // < 1 when many devices had to be shrunk to fit
}

// cabinet interior (metres) - a Rittal TS 800 x 2000 is the reference size
export const CABINET = { width: 0.8, height: 2.0, depth: 0.5, plateZ: -0.2 };
const USABLE_W = 0.66;
const TOP_Y = 0.92; // below the roof (cabinet centre is y = 0)
const BOTTOM_Y = -0.9;
const DUCT_GAP = 0.075; // wiring duct between two rails

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
}

/** Example devices when no inspection exists yet (no statuses - nothing was checked). */
const EXAMPLE: [string, string][] = [
  ["Q1", "circuit_breaker"], ["Q2", "circuit_breaker"], ["Q3", "circuit_breaker"], ["Q4", "circuit_breaker"],
  ["F1", "fuse"], ["F2", "fuse"], ["F3", "fuse"], ["K1", "contactor"], ["K2", "contactor"], ["K3", "contactor"],
  ["KA1", "relay"], ["KA2", "relay"], ["KA3", "relay"], ["KA4", "relay"], ["G1", "power_supply"], ["G2", "power_supply"],
  ["A1", "plc"], ["X1", "terminal_block"], ["X2", "terminal_block"], ["X3", "terminal_block"], ["X4", "terminal_block"],
];

export function buildLayout(result?: InspectionResult | null): CabinetLayout {
  let inputs: Input[];
  const fromInspection = !!result?.components?.length;
  if (result && fromInspection) {
    const sheet = result.checklist ?? [];
    inputs = result.components.map((c) => {
      const rows = sheet.filter((r) => r.item === c.tag);
      return { id: c.tag, type: c.type, description: c.description, status: statusOf(rows, c.status), rows };
    });
  } else {
    inputs = EXAMPLE.map(([id, type]) => ({ id, type, description: "", status: "unchecked" as DeviceStatus, rows: [] }));
  }

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

  // place on rails; shrink everything if it would not fit the cabinet height
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
          status: m.status, rows: m.rows, x: -USABLE_W / 2 + x + w / 2, w, h, d,
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

  return { devices, rails, regions, fromInspection, scale };
}
