// The three.js scene (loaded lazily): a procedural electrical cabinet built from the layout.
// Everything is simple geometry - no downloaded models, textures or HDR files.
import { CameraControls, ContactShadows, Edges, Environment, Lightformer, RoundedBox, useCursor } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CABINET, type CabinetLayout, type Device3D, type DeviceStatus } from "./layout";

export interface SceneApi {
  reset: () => void;
  focus: (id: string) => void;
  focusRegion: (id: string) => void;
}

interface Props {
  layout: CabinetLayout;
  selected: string | null;
  onSelect: (id: string | null) => void;
  showRegions: boolean;
  doorOpen: boolean;
  scanning: boolean;
  dark: boolean;
  apiRef: MutableRefObject<SceneApi | null>;
}

const PLATE_Z = CABINET.plateZ;
const HOME = { pos: [0.55, 0.16, 3.0] as const, target: [0.06, -0.04, -0.12] as const };
const CABINET_BOX = new THREE.Box3(
  new THREE.Vector3(-CABINET.width / 2 - 0.03, -CABINET.height / 2 - 0.12, -CABINET.depth / 2),
  new THREE.Vector3(CABINET.width / 2 + 0.03, CABINET.height / 2 + 0.03, CABINET.depth / 2),
);
export const STATUS_COLOR: Record<DeviceStatus, string> = {
  pass: "#10b981",
  fail: "#ef4444",
  warn: "#f59e0b",
  missing: "#ef4444",
  unchecked: "#94a3b8",
};
const REGION_COLOR = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24"];
const SELECT_COLOR = "#38bdf8";

// ---------------------------------------------------------------- canvas textures (cached)
const textureCache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const hit = textureCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
  }
  textureCache.set(key, tex);
  return tex;
}

function labelTexture(text: string) {
  return canvasTexture(`label:${text}`, 256, 72, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, 72);
    g.strokeStyle = "#cbd5e1";
    g.lineWidth = 4;
    g.strokeRect(2, 2, 252, 68);
    g.fillStyle = "#0f172a";
    g.font = "bold 46px 'JetBrains Mono', Consolas, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 39, 236);
  });
}

function regionTexture(text: string, sub: string, color: string) {
  return canvasTexture(`region:${text}:${sub}:${color}`, 256, 128, (g) => {
    g.clearRect(0, 0, 256, 128);
    g.fillStyle = color;
    g.font = "bold 64px Inter, Arial, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillText(text, 246, 48);
    g.font = "600 26px Inter, Arial, sans-serif";
    g.fillStyle = "#e2e8f0";
    g.fillText(sub, 246, 100);
  });
}

const ductTexture = () =>
  canvasTexture(
    "duct",
    64,
    64,
    (g) => {
      g.fillStyle = "#d9dcdf";
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = "#9aa1a8";
      g.fillRect(28, 0, 8, 46); // slot between the fingers
    },
    [24, 1],
  );

const terminalTexture = () =>
  canvasTexture(
    "terminal",
    32,
    64,
    (g) => {
      g.fillStyle = "#a3a9b0";
      g.fillRect(0, 0, 32, 64);
      g.fillStyle = "#6b7178";
      g.fillRect(0, 0, 3, 64);
      g.fillStyle = "#3f4449";
      g.fillRect(10, 8, 12, 10); // screw
      g.fillRect(10, 46, 12, 10);
    },
    [1, 1],
  );

// ---------------------------------------------------------------- materials (shared)
const M = {
  cabinet: new THREE.MeshStandardMaterial({ color: "#cfd3d0", metalness: 0.35, roughness: 0.55 }), // RAL 7035
  cabinetInner: new THREE.MeshStandardMaterial({ color: "#c3c8c5", metalness: 0.3, roughness: 0.65 }),
  plinth: new THREE.MeshStandardMaterial({ color: "#1b1d1f", metalness: 0.2, roughness: 0.7 }), // RAL 9005
  plate: new THREE.MeshStandardMaterial({ color: "#b9bec3", metalness: 0.75, roughness: 0.38 }), // galvanised
  rail: new THREE.MeshStandardMaterial({ color: "#dfe3e6", metalness: 0.9, roughness: 0.28 }),
  dark: new THREE.MeshStandardMaterial({ color: "#2b2f33", metalness: 0.3, roughness: 0.6 }),
  screw: new THREE.MeshStandardMaterial({ color: "#8a9096", metalness: 0.9, roughness: 0.3 }),
  copper: new THREE.MeshStandardMaterial({ color: "#c47a3a", metalness: 0.95, roughness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: "#f3f4f2", metalness: 0.05, roughness: 0.5 }),
  yellow: new THREE.MeshStandardMaterial({ color: "#facc15", metalness: 0.1, roughness: 0.45 }),
  greenLed: new THREE.MeshStandardMaterial({ color: "#22c55e", emissive: "#22c55e", emissiveIntensity: 1.4 }),
  amberLed: new THREE.MeshStandardMaterial({ color: "#f59e0b", emissive: "#f59e0b", emissiveIntensity: 1.2 }),
};

const BODY_COLOR: Record<Device3D["kind"], string> = {
  breaker: "#f2f2ef",
  contactor: "#5c6268",
  relay: "#d7dadd",
  terminal: "#a3a9b0",
  psu: "#3e5266",
  controller: "#2a2e33",
  fuse: "#e6e7e4",
  module: "#6b737c",
  generic: "#9aa3ab",
};

// ---------------------------------------------------------------- enclosure
function Enclosure({ doorOpen }: { doorOpen: boolean }) {
  const { width: W, height: H, depth: D } = CABINET;
  const t = 0.018;
  const door = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const target = doorOpen ? -2.9 : 0; // ~165 degrees: folded back, out of the way

  useEffect(() => invalidate(), [doorOpen, invalidate]);
  useFrame(() => {
    const g = door.current;
    if (!g) return;
    const diff = target - g.rotation.y;
    if (Math.abs(diff) > 0.002) {
      g.rotation.y += diff * 0.12;
      invalidate();
    }
  });

  return (
    <group>
      {/* back, sides, roof, floor */}
      <mesh position={[0, 0, -D / 2]} material={M.cabinetInner} receiveShadow>
        <boxGeometry args={[W, H, t]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (W + t)) / 2, 0, 0]} material={M.cabinet} castShadow receiveShadow>
          <boxGeometry args={[t, H, D]} />
        </mesh>
      ))}
      <mesh position={[0, H / 2 + t / 2, 0]} material={M.cabinet} castShadow>
        <boxGeometry args={[W + 2 * t, t, D + 0.01]} />
      </mesh>
      <mesh position={[0, -H / 2 - t / 2, 0]} material={M.cabinet} receiveShadow>
        <boxGeometry args={[W + 2 * t, t, D]} />
      </mesh>
      {/* plinth */}
      <mesh position={[0, -H / 2 - t - 0.05, 0]} material={M.plinth} castShadow receiveShadow>
        <boxGeometry args={[W + 2 * t, 0.1, D]} />
      </mesh>
      {/* front frame profiles */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W / 2 - 0.012), 0, D / 2 - 0.012]} material={M.cabinet}>
          <boxGeometry args={[0.024, H, 0.024]} />
        </mesh>
      ))}
      {/* cabinet lamp */}
      <mesh position={[0, H / 2 - 0.035, D / 2 - 0.08]}>
        <boxGeometry args={[0.32, 0.02, 0.04]} />
        <meshStandardMaterial color="#f8fafc" emissive="#fff7e6" emissiveIntensity={0.9} />
      </mesh>
      {/* door, hinged on the left front edge */}
      <group ref={door} position={[-W / 2 - t, 0, D / 2 + 0.014]} rotation={[0, target, 0]}>
        <mesh position={[(W + 2 * t) / 2, 0, 0]} material={M.cabinet} castShadow receiveShadow>
          <boxGeometry args={[W + 2 * t, H + 0.01, 0.022]} />
        </mesh>
        {/* handle (outside) */}
        <mesh position={[W - 0.02, 0.05, 0.03]} material={M.dark} castShadow>
          <boxGeometry args={[0.025, 0.16, 0.025]} />
        </mesh>
        {/* door fan with grille (inside face) */}
        <group position={[W * 0.55, H * 0.32, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={M.dark}>
            <boxGeometry args={[0.2, 0.03, 0.2]} />
          </mesh>
          <mesh position={[0, -0.016, 0]} material={M.screw}>
            <cylinderGeometry args={[0.075, 0.075, 0.004, 32]} />
          </mesh>
        </group>
        {/* drawing pocket */}
        <mesh position={[W * 0.5, -H * 0.18, -0.03]} material={M.white}>
          <boxGeometry args={[0.36, 0.28, 0.02]} />
        </mesh>
        {/* gasket: a thin black border on the inside face */}
        {[
          [(W + 2 * t) / 2, H / 2 - 0.02, W - 0.04, 0.012],
          [(W + 2 * t) / 2, -H / 2 + 0.02, W - 0.04, 0.012],
          [0.03, 0, 0.012, H - 0.04],
          [W + 2 * t - 0.03, 0, 0.012, H - 0.04],
        ].map(([x, y, w, h], i) => (
          <mesh key={i} position={[x, y, -0.012]} material={M.dark}>
            <boxGeometry args={[w, h, 0.003]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- plate, rails, ducts, earth bar
function Interior({ layout }: { layout: CabinetLayout }) {
  const plateW = CABINET.width - 0.08;
  const ducts = useMemo(() => {
    const ys: number[] = [];
    layout.rails.forEach((r, i) => {
      const next = layout.rails[i + 1];
      ys.push(next ? (r.bottom + next.top) / 2 : r.bottom - 0.05);
    });
    if (layout.rails[0]) ys.unshift(layout.rails[0].top + 0.045);
    return ys;
  }, [layout]);
  const top = (layout.rails[0]?.top ?? 0.8) + 0.07;
  const bottom = ducts.length ? ducts[ducts.length - 1] - 0.03 : -0.85;
  const ductMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, metalness: 0.05, map: ductTexture() });
    return m;
  }, []);

  return (
    <group>
      <mesh position={[0, 0, PLATE_Z - 0.003]} material={M.plate} receiveShadow>
        <boxGeometry args={[plateW, CABINET.height - 0.1, 0.006]} />
      </mesh>
      {/* DIN rails */}
      {layout.rails.map((r) => (
        <mesh key={r.index} position={[0, r.y, PLATE_Z + 0.004]} material={M.rail} castShadow receiveShadow>
          <boxGeometry args={[plateW - 0.13, 0.035, 0.0075]} />
        </mesh>
      ))}
      {/* horizontal wiring ducts between the rails */}
      {ducts.map((y, i) => (
        <mesh key={i} position={[0, y, PLATE_Z + 0.03]} material={ductMat} castShadow receiveShadow>
          <boxGeometry args={[plateW - 0.13, 0.045, 0.06]} />
        </mesh>
      ))}
      {/* vertical ducts left and right */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (plateW / 2 - 0.035), (top + bottom) / 2, PLATE_Z + 0.03]} material={ductMat} castShadow receiveShadow>
          <boxGeometry args={[0.05, top - bottom, 0.06]} />
        </mesh>
      ))}
      {/* earth bar with green-yellow conductors */}
      <mesh position={[0, -CABINET.height / 2 + 0.07, PLATE_Z + 0.02]} material={M.copper} castShadow>
        <boxGeometry args={[0.4, 0.012, 0.012]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- devices
interface DeviceProps {
  d: Device3D;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}

const Device = memo(function Device({ d, selected, dimmed, onSelect }: DeviceProps) {
  const [hover, setHover] = useState(false);
  useCursor(hover);
  const ghost = d.status === "missing";
  const z = PLATE_Z + 0.008 + d.d / 2;

  const body = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: ghost ? "#ef4444" : BODY_COLOR[d.kind],
        map: d.kind === "terminal" ? terminalTexture().clone() : null,
        metalness: d.kind === "psu" ? 0.45 : 0.08,
        roughness: d.kind === "psu" ? 0.42 : 0.55,
        transparent: ghost,
        opacity: ghost ? 0.22 : 1,
        depthWrite: !ghost,
      }),
    [d.kind, ghost],
  );
  useEffect(() => {
    if (d.kind === "terminal" && body.map) {
      body.map.repeat.set(Math.max(4, Math.round(d.w / 0.0062)), 1);
      body.map.needsUpdate = true;
    }
  }, [body, d.kind, d.w]);
  useEffect(() => {
    body.emissive.set(selected ? SELECT_COLOR : hover ? SELECT_COLOR : d.status === "fail" ? "#ef4444" : "#000000");
    body.emissiveIntensity = selected ? 0.35 : hover ? 0.18 : d.status === "fail" ? 0.22 : 0;
    body.opacity = ghost ? (selected || hover ? 0.38 : 0.22) : dimmed ? 0.35 : 1;
    body.transparent = ghost || dimmed;
    body.needsUpdate = true;
  }, [body, selected, hover, d.status, ghost, dimmed]);
  useEffect(() => () => body.dispose(), [body]);

  const label = labelTexture(d.label);
  const labelW = Math.min(d.w * 0.9, 0.07);
  const statusColor = STATUS_COLOR[d.status];

  const events = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(true);
    },
    onPointerOut: () => setHover(false),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onSelect(d.id);
    },
  };

  return (
    <group position={[d.x, d.y, z]} {...events}>
      <RoundedBox args={[d.w, d.h, d.d]} radius={Math.min(0.004, d.w / 6)} smoothness={2} material={body} castShadow={!ghost} receiveShadow>
        {(selected || ghost || d.status === "fail") && (
          <Edges color={selected ? SELECT_COLOR : "#ef4444"} threshold={20} />
        )}
      </RoundedBox>
      {!ghost && <DeviceDetails d={d} />}
      {/* tag label on the front */}
      <mesh position={[0, d.h / 2 - 0.016 - (d.kind === "psu" ? 0.01 : 0), d.d / 2 + 0.0012]}>
        <planeGeometry args={[labelW, labelW * 0.28]} />
        <meshBasicMaterial map={label} transparent={ghost} opacity={ghost ? 0.6 : 1} toneMapped={false} />
      </mesh>
      {/* status strip along the bottom front edge */}
      {d.status !== "unchecked" && (
        <mesh position={[0, -d.h / 2 + 0.004, d.d / 2 + 0.0012]}>
          <planeGeometry args={[d.w * 0.8, 0.005]} />
          <meshBasicMaterial color={statusColor} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
});

/** Small recognisable parts per device kind (toggle, terminals, LEDs, yellow stripes). */
function DeviceDetails({ d }: { d: Device3D }) {
  const front = d.d / 2;
  switch (d.kind) {
    case "breaker": {
      const poles = Math.max(1, Math.round(d.w / 0.018));
      return (
        <group>
          {Array.from({ length: poles }, (_, i) => {
            const x = -d.w / 2 + (d.w / poles) * (i + 0.5);
            return (
              <group key={i} position={[x, 0, 0]}>
                <mesh position={[0, -0.004, front + 0.008]} material={M.dark}>
                  <boxGeometry args={[0.009, 0.022, 0.016]} />
                </mesh>
                {[1, -1].map((s) => (
                  <mesh key={s} position={[0, s * (d.h / 2 - 0.009), front - 0.012]} rotation={[Math.PI / 2, 0, 0]} material={M.screw}>
                    <cylinderGeometry args={[0.003, 0.003, 0.004, 10]} />
                  </mesh>
                ))}
              </group>
            );
          })}
          <mesh position={[0, -0.028, front + 0.0008]}>
            <planeGeometry args={[d.w * 0.85, 0.003]} />
            <meshBasicMaterial color="#16a34a" />
          </mesh>
        </group>
      );
    }
    case "contactor":
    case "relay":
      return (
        <group>
          <mesh position={[0, 0.006, front + 0.004]} material={M.white}>
            <boxGeometry args={[d.w * 0.7, d.h * 0.32, 0.008]} />
          </mesh>
          <mesh position={[d.w * 0.3, -d.h * 0.28, front + 0.002]} material={M.amberLed}>
            <sphereGeometry args={[0.002, 8, 8]} />
          </mesh>
        </group>
      );
    case "psu":
      return (
        <group>
          {/* light upper cover, terminal row at the bottom, status LEDs */}
          <mesh position={[0, d.h * 0.16, front + 0.0015]}>
            <boxGeometry args={[d.w * 0.98, d.h * 0.62, 0.003]} />
            <meshStandardMaterial color="#9aa6b2" metalness={0.4} roughness={0.45} />
          </mesh>
          <mesh position={[d.w * 0.15, -d.h * 0.38, front + 0.006]} material={M.dark}>
            <boxGeometry args={[d.w * 0.55, 0.018, 0.012]} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[d.w * 0.4, d.h * 0.4 - i * 0.008, front + 0.003]} material={i === 0 ? M.greenLed : M.screw}>
              <sphereGeometry args={[0.0018, 8, 8]} />
            </mesh>
          ))}
        </group>
      );
    case "controller":
      return (
        <group>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * d.w * 0.2, 0.01, front + 0.004]} material={M.yellow}>
              <boxGeometry args={[d.w * 0.22, d.h * 0.7, 0.008]} />
            </mesh>
          ))}
        </group>
      );
    case "module":
      return (
        <group>
          {[0, 1].map((i) => (
            <mesh key={i} position={[-d.w * 0.25 + i * 0.01, d.h * 0.3, front + 0.002]} material={M.greenLed}>
              <sphereGeometry args={[0.0018, 8, 8]} />
            </mesh>
          ))}
        </group>
      );
    case "fuse":
      return (
        <mesh position={[0, 0, front + 0.006]} material={M.dark}>
          <boxGeometry args={[d.w * 0.6, d.h * 0.45, 0.012]} />
        </mesh>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------- wiring (merged per colour)
const WIRE_COLORS: Record<string, [string, string]> = {
  psu: ["#dc2626", "#1d4ed8"], // +24 V red, 0 V blue
  breaker: ["#1f2937", "#7c3a12"], // black, brown
  contactor: ["#1d4ed8", "#1d4ed8"],
  relay: ["#1d4ed8", "#f8fafc"],
  module: ["#dc2626", "#1d4ed8"],
  controller: ["#f97316", "#1d4ed8"],
  fuse: ["#7c3a12", "#1f2937"],
  generic: ["#1d4ed8", "#9ca3af"],
};

function Wiring({ layout }: { layout: CabinetLayout }) {
  const meshes = useMemo(() => {
    const byColor = new Map<string, THREE.BufferGeometry[]>();
    const add = (color: string, pts: THREE.Vector3[], r = 0.0022) => {
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 6, false);
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color)!.push(geo);
    };
    for (const d of layout.devices) {
      if (d.kind === "terminal" || d.status === "missing") continue;
      const rail = layout.rails[d.rail];
      const next = layout.rails[d.rail + 1];
      const ductY = next ? (rail.bottom + next.top) / 2 : rail.bottom - 0.05;
      const colors = WIRE_COLORS[d.kind] ?? WIRE_COLORS.generic;
      const zFront = PLATE_Z + 0.008 + d.d * 0.55;
      [-1, 1].forEach((s, i) => {
        const x = d.x + s * d.w * 0.22;
        const y0 = d.y - d.h / 2 + 0.006;
        add(colors[i], [
          new THREE.Vector3(x, y0, zFront),
          new THREE.Vector3(x, y0 - 0.012, zFront),
          new THREE.Vector3(x + s * 0.002, ductY + 0.03, PLATE_Z + 0.055),
          new THREE.Vector3(x + s * 0.002, ductY + 0.012, PLATE_Z + 0.045),
        ]);
      });
    }
    // green-yellow earth conductors to the earth bar
    const ey = -CABINET.height / 2 + 0.07;
    for (let i = 0; i < 6; i++) {
      const x = -0.17 + i * 0.068;
      add("#a3e635", [
        new THREE.Vector3(x, ey, PLATE_Z + 0.025),
        new THREE.Vector3(x, ey + 0.05, PLATE_Z + 0.06),
        new THREE.Vector3(x * 1.4, ey + 0.16, PLATE_Z + 0.045),
      ], 0.003);
    }
    return [...byColor.entries()].map(([color, geos]) => {
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      return { color, geometry: merged };
    });
  }, [layout]);

  useEffect(() => () => meshes.forEach((m) => m.geometry?.dispose()), [meshes]);

  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.color} geometry={m.geometry ?? undefined} castShadow>
          <meshStandardMaterial color={m.color} roughness={0.5} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- region overlays
function Regions({ layout }: { layout: CabinetLayout }) {
  const width = CABINET.width - 0.12;
  return (
    <group>
      {layout.regions.map((r, i) => {
        const color = REGION_COLOR[i % REGION_COLOR.length];
        const h = r.top - r.bottom;
        const sub = r.problems ? `${r.problems} problem${r.problems === 1 ? "" : "s"}` : `${r.devices} devices`;
        return (
          <group key={r.id} position={[0, (r.top + r.bottom) / 2, PLATE_Z + 0.07]}>
            <mesh renderOrder={2}>
              <boxGeometry args={[width, h - 0.008, 0.14]} />
              <meshBasicMaterial color={color} transparent opacity={0.07} depthWrite={false} />
              <Edges color={color} />
            </mesh>
            <mesh position={[-width / 2 - 0.09, h / 2 - 0.05, 0.07]}>
              <planeGeometry args={[0.16, 0.08]} />
              <meshBasicMaterial map={regionTexture(r.id, sub, color)} transparent depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------- scan sweep while analysing
function ScanSweep({ layout }: { layout: CabinetLayout }) {
  const g = useRef<THREE.Group>(null);
  const top = (layout.rails[0]?.top ?? 0.85) + 0.06;
  const bottom = (layout.rails[layout.rails.length - 1]?.bottom ?? -0.85) - 0.06;
  const invalidate = useThree((s) => s.invalidate);
  // ~15 frames per second is smooth enough for a sweep and leaves the CPU / GPU to the
  // inspection that is running on the same computer
  useEffect(() => {
    const timer = setInterval(() => invalidate(), 66);
    return () => clearInterval(timer);
  }, [invalidate]);
  useFrame((state) => {
    if (!g.current) return;
    const t = (state.clock.elapsedTime * 0.32) % 1;
    g.current.position.y = top - t * (top - bottom);
  });
  return (
    <group ref={g} position={[0, top, PLATE_Z + 0.1]}>
      <mesh>
        <planeGeometry args={[CABINET.width - 0.1, 0.006]} />
        <meshBasicMaterial color="#7dd3fc" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.04, -0.001]}>
        <planeGeometry args={[CABINET.width - 0.1, 0.08]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- camera
function Controls({ layout, apiRef }: { layout: CabinetLayout; apiRef: MutableRefObject<SceneApi | null> }) {
  const ref = useRef<CameraControls>(null);
  const size = useThree((s) => s.size);
  // home view: fixed viewing angle, distance fitted to the cabinet for any aspect ratio
  const home = useCallback(
    async (smooth: boolean) => {
      const c = ref.current;
      if (!c) return;
      await c.setLookAt(...HOME.pos, ...HOME.target, false);
      await c.fitToBox(CABINET_BOX, smooth, { paddingTop: 0.06, paddingBottom: 0.06, paddingLeft: 0.12, paddingRight: 0.12 });
    },
    [],
  );
  useEffect(() => {
    void home(false);
  }, [home, size.width, size.height]);
  useEffect(() => {
    apiRef.current = {
      reset: () => void home(true),
      focus: (id) => {
        const d = layout.devices.find((x) => x.id === id);
        const c = ref.current;
        if (!d || !c) return;
        const z = PLATE_Z + d.d;
        void c.setLookAt(d.x + 0.12, d.y + 0.06, z + 0.5, d.x, d.y, z, true);
      },
      focusRegion: (id) => {
        const r = layout.regions.find((x) => x.id === id);
        const c = ref.current;
        if (!r || !c) return;
        const y = (r.top + r.bottom) / 2;
        const dist = Math.max(0.9, (r.top - r.bottom) * 2.4);
        void c.setLookAt(0.25, y + 0.05, PLATE_Z + dist, 0, y, PLATE_Z, true);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, layout]);
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={0.25}
      maxDistance={6}
      smoothTime={0.35}
      dollyToCursor
      maxPolarAngle={Math.PI * 0.62}
    />
  );
}

// ---------------------------------------------------------------- scene root
export default function CabinetScene({ layout, selected, onSelect, showRegions, doorOpen, scanning, dark, apiRef }: Props) {
  const selectedDevice = layout.devices.find((d) => d.id === selected);
  return (
    <Canvas
      shadows
      dpr={scanning ? 1 : [1, 1.75]}
      frameloop="demand"
      camera={{ position: [...HOME.pos], fov: 38, near: 0.03, far: 40 }}
      gl={{ antialias: true }}
      onCreated={({ camera }) => camera.lookAt(...HOME.target)}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[dark ? "#0a1120" : "#e8edf3"]} />
      <fog attach="fog" args={[dark ? "#0a1120" : "#e8edf3", 6, 14]} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#e0f2fe", "#1e293b", 0.55]} />
      <directionalLight
        position={[2.2, 3.5, 3]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-1.4}
        shadow-camera-right={1.4}
        shadow-camera-top={1.4}
        shadow-camera-bottom={-1.4}
        shadow-bias={-0.0004}
      />
      <pointLight position={[0, 0.9, 0.15]} intensity={0.5} distance={2.2} color="#fff4e0" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 3, 2]} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[-3, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={0.6} position={[3, 0, 2]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
      </Environment>

      <Enclosure doorOpen={doorOpen} />
      <Interior layout={layout} />
      <Wiring layout={layout} />
      {layout.devices.map((d) => (
        <Device key={d.id} d={d} selected={d.id === selected} dimmed={false} onSelect={onSelect} />
      ))}
      {showRegions && <Regions layout={layout} />}
      {scanning && <ScanSweep layout={layout} />}
      {selectedDevice && <SelectionMarker d={selectedDevice} />}

      <ContactShadows position={[0, -CABINET.height / 2 - 0.118, 0]} opacity={dark ? 0.6 : 0.4} scale={4} blur={2.4} far={2.5} resolution={512} frames={1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -CABINET.height / 2 - 0.12, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color={dark ? "#0d1628" : "#dfe5ec"} roughness={0.95} />
      </mesh>
      <Controls layout={layout} apiRef={apiRef} />
    </Canvas>
  );
}

/** Thin bracket in front of the selected device. */
function SelectionMarker({ d }: { d: Device3D }) {
  const z = PLATE_Z + 0.008 + d.d + 0.006;
  return (
    <mesh position={[d.x, d.y, z]}>
      <planeGeometry args={[d.w + 0.012, d.h + 0.012]} />
      <meshBasicMaterial color={SELECT_COLOR} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
