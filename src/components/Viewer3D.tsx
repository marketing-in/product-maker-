import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Motion } from '../lib/abilities';
import { boards, type BoardModel } from '../lib/board';
import { routeBoard } from '../lib/route';

import { add, instances, partPrims, scale, sceneRadius } from '../lib/geometry';
import { connPower, connValues } from '../lib/power';
import type { Connection, ConnectionKind, Part, Teardown, Vec3 } from '../lib/types';

export const KIND_COLOR: Record<ConnectionKind, string> = {
  power: '#c4421c',
  ground: '#3a3f45',
  signal: '#2a5fb0',
  rf: '#12827a',
  mechanical: '#8f8a7f',
};

const SELECT_COLOR = 0xf0a400;
const EDGE_COLOR = 0x1d2126;

/** How a surface takes the light, from the part's material note, else its category. */
function surface(part: Part): { metalness: number; roughness: number; clearcoat: number } {
  const t = `${part.material ?? ''}`.toLowerCase();
  const has = (...k: string[]) => k.some((x) => t.includes(x));
  if (has('steel', 'stainless', 'nickel', 'zinc', 'chrome', 'tin', 'alumin', 'copper', 'brass', 'gold')) return { metalness: 1, roughness: 0.34, clearcoat: 0 };
  if (has('rubber', 'silicone', 'tpe', 'tpu', 'foam', 'paper', 'fabric')) return { metalness: 0, roughness: 0.92, clearcoat: 0 };
  if (has('gloss', 'polished', 'glass', 'acrylic')) return { metalness: 0, roughness: 0.12, clearcoat: 0.6 };
  switch (part.category) {
    case 'pcb': return { metalness: 0, roughness: 0.6, clearcoat: 0.15 };
    case 'fastener': case 'connector': case 'thermal': return { metalness: 0.9, roughness: 0.36, clearcoat: 0 };
    case 'ic': case 'power': return { metalness: 0, roughness: 0.55, clearcoat: 0 };
    case 'battery': return { metalness: 0.2, roughness: 0.38, clearcoat: 0.3 };
    case 'display': return { metalness: 0, roughness: 0.15, clearcoat: 0.7 };
    default: return { metalness: 0, roughness: 0.5, clearcoat: 0 };
  }
}

/** The printed face of a board: solder mask, pads, part outlines and reference designators. */
function boardFace(b: BoardModel, side: 'top' | 'bottom'): THREE.Mesh | null {
  const pxPerMm = Math.max(6, Math.min(24, 2048 / Math.max(b.width, b.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(b.width * pxPerMm);
  canvas.height = Math.round(b.height * pxPerMm);
  const g = canvas.getContext('2d');
  if (!g) return null;
  const X = (x: number) => x * pxPerMm;
  const Y = (y: number) => (b.height - y) * pxPerMm;
  const mask = new THREE.Color(b.part.color);
  g.fillStyle = `#${mask.clone().multiplyScalar(0.72).getHexString()}`;
  g.fillRect(0, 0, canvas.width, canvas.height);
  // A faint copper pour pattern, so the mask does not look like flat paint.
  g.strokeStyle = `#${mask.clone().multiplyScalar(0.86).getHexString()}`;
  g.lineWidth = pxPerMm * 0.12;
  for (let i = -canvas.height; i < canvas.width; i += pxPerMm * 1.6) { g.beginPath(); g.moveTo(i, canvas.height); g.lineTo(i + canvas.height, 0); g.stroke(); }
  // Copper traces show through the solder mask as a lighter shade of it.
  const routing = routeBoard(b);
  g.strokeStyle = `#${mask.clone().multiplyScalar(1.28).getHexString()}`;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const t of routing.traces) {
    if (t.layer !== side) continue;
    g.lineWidth = Math.max(1.5, t.width * pxPerMm);
    g.beginPath();
    t.points.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
  }
  for (const v of routing.vias) {
    g.fillStyle = '#cfd2d6';
    g.beginPath(); g.arc(X(v.x), Y(v.y), (v.pad / 2) * pxPerMm, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#14171a';
    g.beginPath(); g.arc(X(v.x), Y(v.y), (v.drill / 2) * pxPerMm, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#d8b25a';
  for (const h of b.holes) { g.beginPath(); g.arc(X(h.x), Y(h.y), ((h.d + 1.6) / 2) * pxPerMm, 0, Math.PI * 2); g.fill(); }
  const shown = b.footprints.filter((f) => f.side === side);
  for (const f of shown) {
    g.fillStyle = '#cfd2d6';
    for (const p of f.pads) g.fillRect(X(f.x + p.x - p.w / 2), Y(f.y + p.y + p.h / 2), p.w * pxPerMm, p.h * pxPerMm);
  }
  g.strokeStyle = '#f2f1ec';
  g.fillStyle = '#f2f1ec';
  g.lineWidth = Math.max(1, pxPerMm * 0.12);
  g.textBaseline = 'bottom';
  for (const f of shown) {
    const grow = 0.35;
    if (f.round) { g.beginPath(); g.arc(X(f.x), Y(f.y), (f.w / 2 + grow) * pxPerMm, 0, Math.PI * 2); g.stroke(); }
    else g.strokeRect(X(f.x - f.w / 2 - grow), Y(f.y + f.h / 2 + grow), (f.w + grow * 2) * pxPerMm, (f.h + grow * 2) * pxPerMm);
    const size = Math.max(0.9, Math.min(1.6, Math.min(f.w, f.h) * 0.45)) * pxPerMm;
    g.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
    const label = f.ref.replace(/\s+/g, '');
    const tw = g.measureText(label).width;
    const lx = Math.max(2, Math.min(canvas.width - tw - 2, X(f.x - f.w / 2 - grow)));
    const above = Y(f.y + f.h / 2 + grow) - pxPerMm * 0.15;
    g.fillText(label, lx, above > size ? above : Y(f.y - f.h / 2 - grow) + size + pxPerMm * 0.15);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  // A quad just above the board face, in the board's own axes.
  const { n, u, v } = b.axes;
  const sign = side === 'top' ? 1 : -1;
  const corner = (cu: number, cv: number) => { const p = [0, 0, 0]; p[u] = cu * b.width / 2; p[v] = cv * b.height / 2; p[n] = sign * (b.thickness / 2 + 0.05); return p; };
  const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(quad.flat(), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex, roughness: 0.72, clearcoat: 0.06, clearcoatRoughness: 0.5, envMapIntensity: 0.5, side: THREE.DoubleSide,
    // Drawn in front of the board face it lies on, whatever the zoom.
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

interface Props {
  td: Teardown;
  explode: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  kinds: Record<ConnectionKind, boolean>;
  showValues: boolean;
  xray: boolean;
  resetSignal: number;
  /** Slowly turn the model until the user takes over. Off for reduced motion. */
  autoRotate?: boolean;
  /** Simulator: parts that are running, and connections carrying something. */
  activeIds?: Set<string>;
  liveWires?: Set<string> | null;
  /** Called with the part and which copy of it was clicked. */
  onPick?: (id: string, index: number) => void;
  /** Keep the camera where it is when the teardown is edited. */
  keepView?: boolean;
  /** Simulator: where the product has driven to and how its wheels and fans stand. Read every frame. */
  motion?: { current: Motion };
  /** Live build: one cursor per agent, moving over the place it is working on. */
  cursors?: AgentCursor[];
  /** Design editor: the selected part can be dragged. Called once on release, in millimetres. */
  onMovePart?: (id: string, delta: Vec3) => void;
}

export interface AgentCursor {
  id: string;
  name: string;
  color: string;
  /** work: busy inside its box. wait: parked beside it. roam: hopping between the stops. done: leaving. */
  mode: 'work' | 'wait' | 'roam' | 'done';
  /** Centre and size of the box it works in, in product coordinates. */
  center: Vec3;
  size: Vec3;
  stops?: Vec3[];
}

/** Part ids already drawn for a product, so only new arrivals pop in. */
const drawn = new Map<string, Set<string>>();

interface PartObj {
  part: Part;
  groups: THREE.Group[];
  material: THREE.MeshPhysicalMaterial;
  /** Extra materials for solids with their own colour. They follow the main one. */
  tints: THREE.MeshPhysicalMaterial[];
  edges: THREE.LineBasicMaterial;
}

interface WireObj {
  conn: Connection;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  dots: THREE.Mesh[];
  curve: THREE.QuadraticBezierCurve3;
  radius: number;
  speed: number;
  label: HTMLDivElement | null;
  bend: number;
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  parts: Map<string, PartObj>;
  wires: WireObj[];
  userMoved: boolean;
  partLabel: HTMLDivElement;
  hoverLabel: HTMLDivElement;
  // Live view settings, read by the render loop.
  explode: number;
  selectedId: string | null;
  kinds: Record<ConnectionKind, boolean>;
  showValues: boolean;
  active: Set<string>;
  live: Set<string> | null;
  cursors: AgentCursor[];
  fit: () => void;
  look: (dir: [number, number, number]) => void;
  layout: () => void;
  restyle: () => void;
}

function primGeometry(part: Part): THREE.BufferGeometry[] {
  return partPrims(part).map((prim) => {
    const tint = prim.color;
    let g: THREE.BufferGeometry;
    if (prim.kind === 'box') {
      // Real parts have eased edges. A small radius is enough to catch the light.
      const r = Math.min(0.9, Math.min(...prim.size) * 0.16);
      g = r > 0.04 && part.category !== 'pcb'
        ? new RoundedBoxGeometry(prim.size[0], prim.size[1], prim.size[2], 2, r)
        : new THREE.BoxGeometry(prim.size[0], prim.size[1], prim.size[2]);
    } else {
      g = new THREE.CylinderGeometry(prim.radius, prim.radius, prim.length, 40);
      if (prim.axis === 'x') g.rotateZ(-Math.PI / 2);
      if (prim.axis === 'z') g.rotateX(Math.PI / 2);
    }
    g.translate(prim.center[0], prim.center[1], prim.center[2]);
    g.userData.tint = tint;
    return g;
  });
}

const AXES = ['x', 'y', 'z'] as const;

function boxAt(size: Vec3, center: Vec3): THREE.BufferGeometry {
  return new THREE.BoxGeometry(size[0], size[1], size[2]).translate(center[0], center[1], center[2]);
}

function cylAt(radius: number, length: number, axis: 0 | 1 | 2, center: Vec3): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, length, 32);
  if (axis === 0) g.rotateZ(-Math.PI / 2);
  if (axis === 2) g.rotateX(Math.PI / 2);
  return g.translate(center[0], center[1], center[2]);
}

/** Small features that make a part read as what it is: leads, end caps, screw heads, cones. */
function detail(part: Part, parent: Part | undefined): { metal: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; light: THREE.BufferGeometry[] } {
  const metal: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const light: THREE.BufferGeometry[] = [];
  const v3 = (pairs: [number, number][]): Vec3 => { const o: Vec3 = [0, 0, 0]; pairs.forEach(([i, x]) => { o[i] = x; }); return o; };

  if (part.shape === 'box' && parent?.category === 'pcb') {
    const n = parent.size.indexOf(Math.min(...parent.size)) as 0 | 1 | 2;
    const [a, b] = ([0, 1, 2] as const).filter((i) => i !== n);
    const [u, v] = part.size[a] >= part.size[b] ? [a, b] : [b, a];
    const down = part.position[n] >= parent.position[n] ? -1 : 1;
    const [L, W, H] = [part.size[u], part.size[v], part.size[n]];
    if ((part.category === 'ic' || part.category === 'power' || part.category === 'sensor') && L >= 2.5) {
      const count = Math.max(2, Math.min(16, Math.floor(L / 1.27)));
      const pitch = (L * 0.86) / count;
      const lh = Math.min(0.35, H * 0.3);
      for (let i = 0; i < count; i++) {
        for (const side of [-1, 1]) {
          metal.push(boxAt(
            v3([[u, pitch * 0.5], [v, 0.6], [n, lh]]),
            v3([[u, -((count - 1) * pitch) / 2 + i * pitch], [v, side * (W / 2 + 0.25)], [n, down * (H / 2 - lh / 2)]]),
          ));
        }
      }
      const r = Math.max(0.15, Math.min(0.5, W * 0.07));
      light.push(cylAt(r, 0.06, n, v3([[u, -L / 2 + r * 2.5], [v, -W / 2 + r * 2.5], [n, -down * (H / 2 + 0.02)]])));
    } else if (part.category === 'passive' && L <= 12) {
      for (const side of [-1, 1]) {
        metal.push(boxAt(v3([[u, L * 0.22], [v, W * 1.04], [n, H * 1.04]]), v3([[u, side * (L / 2 - L * 0.11)]])));
      }
    }
  }
  if (part.shape === 'cylinder') {
    const ax = AXES.indexOf(part.axis ?? 'z') as 0 | 1 | 2;
    const others = ([0, 1, 2] as const).filter((i) => i !== ax);
    const r = Math.max(part.size[others[0]], part.size[others[1]]) / 2;
    const len = part.size[ax];
    // The outward end is the one further from the middle of the product.
    const out = part.position[ax] >= 0 ? 1 : -1;
    if (part.category === 'fastener') {
      const hl = Math.min(len * 0.22, r * 1.4);
      metal.push(cylAt(r * 1.75, hl, ax, v3([[ax, out * (len / 2 + hl / 2)]])));
      dark.push(boxAt(v3([[ax, 0.12], [others[0], r * 2.2], [others[1], r * 0.35]]), v3([[ax, out * (len / 2 + hl + 0.03)]])));
    } else if (part.category === 'electromech' && r > 8) {
      dark.push(cylAt(r * 0.8, 0.5, ax, v3([[ax, out * (len / 2 + 0.2)]])));
      dark.push(cylAt(r * 0.3, 1.6, ax, v3([[ax, out * (len / 2 + 0.6)]])));
      metal.push(cylAt(r * 0.55, len * 0.3, ax, v3([[ax, -out * (len / 2 + len * 0.12)]])));
    } else if (part.category === 'battery') {
      metal.push(cylAt(r * 0.36, 1.2, ax, v3([[ax, len / 2 + 0.6]])));
      metal.push(cylAt(r * 0.92, 0.3, ax, v3([[ax, -len / 2 - 0.1]])));
    } else if (part.category === 'passive' && parent?.category === 'pcb') {
      light.push(cylAt(r * 0.92, 0.08, ax, v3([[ax, (part.position[ax] >= parent.position[ax] ? 1 : -1) * (len / 2 + 0.03)]])));
    }
  }
  return { metal, dark, light };
}

/** Where the camera was, kept across rebuilds while a teardown is being edited. */
let savedView: { key: string; position: THREE.Vector3; target: THREE.Vector3 } | null = null;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export default function Viewer3D(props: Props) {
  const { td, explode, selectedId, onSelect, kinds, showValues, xray, resetSignal, autoRotate = false, activeIds, liveWires, keepView = false, cursors } = props;
  const motionRef = useRef(props.motion);
  motionRef.current = props.motion;
  const moves = Boolean(props.motion);
  const onPickRef = useRef(props.onPick);
  onPickRef.current = props.onPick;
  const onMoveRef = useRef(props.onMovePart);
  onMoveRef.current = props.onMovePart;
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Build the scene whenever the teardown changes.
  useEffect(() => {
    const host = hostRef.current!;
    const overlay = overlayRef.current!;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.zoomSpeed = 0.9;
    controls.autoRotate = autoRotate && !reduceMotion;
    controls.autoRotateSpeed = 0.6;

    // A soft studio: reflections from a room environment, one shadow-casting key light, a cool fill.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();
    const reachR = sceneRadius(td, 1) * 1.3;
    const key = new THREE.DirectionalLight(0xfff4e6, 1.8);
    key.position.set(0.55, 1, 0.65).multiplyScalar(reachR * 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -reachR;
    key.shadow.camera.right = key.shadow.camera.top = reachR;
    key.shadow.camera.near = reachR * 0.5;
    key.shadow.camera.far = reachR * 6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.4;
    key.shadow.radius = 5;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
    fill.position.set(-0.8, 0.35, -0.6);
    scene.add(fill);

    // The teardown is Z-up; three.js is Y-up.
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    // The rig carries the whole product across the floor when it drives.
    const rig = new THREE.Group();
    rig.add(root);
    scene.add(rig);
    scene.add(key.target);
    let floor: THREE.GridHelper | null = null;
    if (moves) {
      const span = Math.max(2000, sceneRadius(td, 0) * 40);
      floor = new THREE.GridHelper(span, Math.round(span / 50), 0x6f7785, 0x343a44);
      (floor.material as THREE.Material).transparent = true;
      (floor.material as THREE.Material).opacity = 0.55;
      scene.add(floor);
    }
    const keyBase = key.position.clone();
    const lastRig = new THREE.Vector3();

    const baseRadius = sceneRadius(td, 0);
    const wireScale = Math.min(6, Math.max(0.6, baseRadius / 90));

    const metalMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 0.85, roughness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.8 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.7 });
    const partById = new Map(td.parts.map((p) => [p.id, p]));

    const boardModels = new Map(boards(td).map((b) => [b.part.id, b]));

    const parts = new Map<string, PartObj>();
    for (const part of td.parts) {
      const look = surface(part);
      const material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(part.color),
        roughness: look.roughness,
        metalness: look.metalness,
        clearcoat: look.clearcoat,
        clearcoatRoughness: 0.25,
      });
      const edges = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0 });
      const face = boardModels.get(part.id);
      const geos = primGeometry(part);
      const extra = part.shapes?.length ? { metal: [], dark: [], light: [] } : detail(part, part.parentId ? partById.get(part.parentId) : undefined);
      const tintMats = new Map<string, THREE.MeshPhysicalMaterial>();
      const tintFor = (c: string) => {
        if (!tintMats.has(c)) { const m = material.clone(); m.color.set(c); tintMats.set(c, m); }
        return tintMats.get(c)!;
      };
      const groups = instances(part).map((_c, index) => {
        const g = new THREE.Group();
        for (const geo of geos) {
          const mesh = new THREE.Mesh(geo, geo.userData.tint ? tintFor(geo.userData.tint as string) : material);
          mesh.userData.partId = part.id;
          mesh.userData.index = index;
          mesh.castShadow = part.category !== 'enclosure';
          mesh.receiveShadow = true;
          g.add(mesh);
          const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 50), edges);
          outline.visible = false;
          outline.userData.outline = true;
          g.add(outline);
        }
        if (face) {
          for (const side of ['top', 'bottom'] as const) {
            if (side === 'bottom' && !face.footprints.some((f) => f.side === 'bottom')) continue;
            const printed = boardFace(face, side);
            if (printed) { printed.userData.partId = part.id; printed.userData.index = index; g.add(printed); }
          }
        }
        for (const [list, mat] of [[extra.metal, metalMat], [extra.dark, darkMat], [extra.light, lightMat]] as const) {
          for (const geo of list) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.userData.partId = part.id;
            mesh.userData.index = index;
            mesh.castShadow = true;
            g.add(mesh);
          }
        }
        root.add(g);
        return g;
      });
      parts.set(part.id, { part, groups, material, tints: [...tintMats.values()], edges });
    }

    const dotGeo = new THREE.SphereGeometry(1, 10, 8);
    const wires: WireObj[] = [];
    for (const conn of td.connections) {
      if (!parts.has(conn.from) || !parts.has(conn.to)) continue;
      const w = connPower(conn) ?? 0;
      const radius =
        (conn.kind === 'power' ? 0.42 + Math.min(1.0, Math.sqrt(w) * 0.3) : conn.kind === 'ground' ? 0.45 : 0.32) *
        wireScale;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(KIND_COLOR[conn.kind]),
        roughness: 0.45,
        transparent: true,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      root.add(mesh);

      const dots: THREE.Mesh[] = [];
      const flows = conn.kind === 'power' || conn.kind === 'signal' || conn.kind === 'rf';
      if (flows && !reduceMotion) {
        const dotMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(KIND_COLOR[conn.kind]).lerp(new THREE.Color(0xffffff), 0.55),
          transparent: true,
        });
        for (let i = 0; i < 2; i++) {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.scale.setScalar(radius * 1.7);
          root.add(dot);
          dots.push(dot);
        }
      }

      let label: HTMLDivElement | null = null;
      const values = connValues(conn);
      if (conn.kind !== 'mechanical') {
        label = document.createElement('div');
        label.className = `wire-label kind-${conn.kind}`;
        const name = document.createElement('span');
        name.className = 'wire-label-name';
        name.textContent = conn.label;
        label.appendChild(name);
        if (values) {
          const val = document.createElement('span');
          val.className = 'wire-label-values';
          val.textContent = values;
          label.appendChild(val);
        }
        label.dataset.hasValues = values ? '1' : '';
        overlay.appendChild(label);
      }

      wires.push({
        conn, mesh, dots, radius, label,
        curve: new THREE.QuadraticBezierCurve3(),
        speed: conn.kind === 'power' ? 0.22 + Math.min(0.45, (conn.currentA ?? 0.2) * 0.22) : 0.45,
        bend: hash(conn.id),
      });
    }

    const partLabel = document.createElement('div');
    partLabel.className = 'part-label';
    overlay.appendChild(partLabel);
    const hoverLabel = document.createElement('div');
    hoverLabel.className = 'hover-label';
    overlay.appendChild(hoverLabel);

    const centre = (id: string, t: number): Vec3 => {
      const p = parts.get(id)!.part;
      return add(p.position, scale(p.explode, t));
    };

    const stage: Stage = {
      renderer, scene, camera, controls, root, parts, wires,
      userMoved: false, partLabel, hoverLabel,
      explode: 0, selectedId: null,
      kinds: { power: true, ground: true, signal: true, rf: true, mechanical: false },
      showValues: true,
      active: new Set(),
      live: null,
      cursors: [],
      fit: () => {
        // Frame the corners of every part, so the model fills the stage.
        const t = stage.explode;
        root.updateMatrixWorld(true);
        const pts: THREE.Vector3[] = [];
        const box = new THREE.Box3();
        for (const { part } of parts.values()) {
          const [hx, hy, hz] = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2];
          for (const c of instances(part)) {
            const q = add(c, scale(part.explode, t));
            for (let i = 0; i < 8; i++) {
              const p = new THREE.Vector3(
                q[0] + (i & 1 ? hx : -hx), q[1] + (i & 2 ? hy : -hy), q[2] + (i & 4 ? hz : -hz),
              ).applyMatrix4(root.matrixWorld);
              pts.push(p);
              box.expandByPoint(p);
            }
          }
        }
        const dir = new THREE.Vector3(0.62, 0.48, 0.9).normalize();
        if (stage.userMoved) dir.copy(camera.position).sub(controls.target).normalize();
        else box.getCenter(controls.target);
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
        const up = new THREE.Vector3().crossVectors(dir, right);
        const tanV = Math.tan((camera.fov * Math.PI) / 360);
        const tanH = tanV * camera.aspect;
        const rel = new THREE.Vector3();
        let dist = 10;
        for (const p of pts) {
          rel.copy(p).sub(controls.target);
          dist = Math.max(dist, rel.dot(dir) + Math.max(Math.abs(rel.dot(right)) / tanH, Math.abs(rel.dot(up)) / tanV));
        }
        dist *= 1.14;
        camera.position.copy(controls.target).addScaledVector(dir, dist);
        camera.near = Math.max(0.5, dist / 200);
        camera.far = dist * 20;
        camera.updateProjectionMatrix();
      },
      look: (dir) => {
        stage.userMoved = false;
        stage.fit();
        const dist = camera.position.distanceTo(controls.target);
        camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(...dir).normalize(), dist);
        stage.userMoved = true;
        stage.fit();
        controls.update();
      },
      layout: () => {
        const t = stage.explode;
        for (const { part, groups } of parts.values()) {
          instances(part).forEach((c, i) => {
            const q = add(c, scale(part.explode, t));
            groups[i].position.set(q[0], q[1], q[2]);
          });
        }
        for (const w of wires) {
          const a = new THREE.Vector3(...centre(w.conn.from, t));
          const b = new THREE.Vector3(...centre(w.conn.to, t));
          const d = a.distanceTo(b);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          // Bow each wire upward and a little sideways so parallel runs separate.
          const along = b.clone().sub(a).normalize();
          const side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 0, 1));
          if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
          side.normalize();
          mid.z += d * (0.12 + 0.1 * w.bend);
          mid.addScaledVector(side, d * (w.bend - 0.5) * 0.3);
          w.curve.v0.copy(a);
          w.curve.v1.copy(mid);
          w.curve.v2.copy(b);
          w.mesh.geometry.dispose();
          w.mesh.geometry = new THREE.TubeGeometry(w.curve, 28, w.radius, 8, false);
        }
        if (!stage.userMoved) stage.fit();
      },
      restyle: () => {
        const sel = stage.selectedId;
        for (const { part, material, tints, edges } of parts.values()) {
          const isSel = part.id === sel;
          const isOn = stage.active.has(part.id);
          if (isSel) {
            material.emissive.setHex(SELECT_COLOR);
            material.emissiveIntensity = 0.45;
          } else if (isOn) {
            // Running parts glow in their own colour; lamps and screens glow hardest.
            material.emissive.set(part.color).lerp(new THREE.Color(0xffffff), 0.35);
            material.emissiveIntensity = part.category === 'display' ? 1.6 : 0.4;
          } else {
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
          }
          for (const t of tints) { t.emissive.copy(material.emissive); t.emissiveIntensity = material.emissiveIntensity; }
          edges.color.setHex(SELECT_COLOR);
          edges.opacity = isSel ? 1 : 0;
          parts.get(part.id)!.groups.forEach((g) => g.children.forEach((c) => { if (c.userData.outline) c.visible = isSel; }));
        }
        for (const w of wires) {
          const visible = stage.kinds[w.conn.kind];
          const related = stage.live ? stage.live.has(w.conn.id) : !sel || w.conn.from === sel || w.conn.to === sel;
          w.mesh.visible = visible;
          w.mesh.material.opacity = related ? 1 : 0.14;
          w.mesh.material.depthWrite = related;
          w.dots.forEach((d) => { d.visible = visible && related; });
          if (w.label) {
            const show =
              visible &&
              (sel
                ? w.conn.from === sel || w.conn.to === sel
                : stage.showValues && w.conn.kind === 'power' && w.label.dataset.hasValues === '1');
            w.label.dataset.show = show ? '1' : '';
            w.label.classList.toggle('with-name', Boolean(sel));
          }
        }
        const p = sel ? parts.get(sel)?.part : null;
        partLabel.textContent = p ? (p.refDes ? `${p.refDes} · ${p.name}` : p.name) : '';
        partLabel.dataset.show = p ? '1' : '';
      },
    };
    stageRef.current = stage;

    controls.addEventListener('start', () => {
      stage.userMoved = true;
      controls.autoRotate = false;
    });

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!stage.userMoved) stage.fit();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    if (keepView && savedView?.key === td.product.name) {
      camera.position.copy(savedView.position);
      controls.target.copy(savedView.target);
      const dist = camera.position.distanceTo(controls.target);
      camera.near = Math.max(0.5, dist / 200);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      stage.userMoved = true;
    }

    // Picking: a click that is not a drag selects the part under the pointer.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (ev: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      // Positions may have changed since the last drawn frame.
      camera.updateMatrixWorld();
      scene.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      const meshes: THREE.Object3D[] = [];
      parts.forEach((o) => o.groups.forEach((g) => g.children.forEach((c) => {
        if ((c as THREE.Mesh).isMesh) meshes.push(c);
      })));
      const hits = raycaster.intersectObjects(meshes, false);
      // See-through housings should not block the parts inside them.
      const solid = hits.find((h) => !((h.object as THREE.Mesh).material as THREE.Material).transparent);
      const hit = solid ?? hits[0];
      lastIndex = hit ? ((hit.object.userData.index as number) ?? 0) : 0;
      return hit ? (hit.object.userData.partId as string) : null;
    };
    let lastIndex = 0;

    // Design editor: drag the selected part across a plane that faces the camera.
    const descendants = (id: string): string[] => {
      const kids = td.parts.filter((p) => p.parentId === id).map((p) => p.id);
      return [id, ...kids.flatMap(descendants)];
    };
    let drag: { id: string; ids: string[]; plane: THREE.Plane; start: THREE.Vector3; delta: Vec3; lock: number } | null = null;
    const planePoint = (ev: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      return hit ? root.worldToLocal(hit) : null;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
      if (!onMoveRef.current || !stage.selectedId || !parts.has(stage.selectedId)) return;
      // The selected part can be grabbed even when another part is in front of it.
      pick(ev);
      const own: THREE.Object3D[] = [];
      parts.get(stage.selectedId)!.groups.forEach((g) => g.children.forEach((c) => { if ((c as THREE.Mesh).isMesh) own.push(c); }));
      if (raycaster.intersectObjects(own, false).length === 0) return;
      const p = parts.get(stage.selectedId)!.part;
      const c = centre(p.id, stage.explode);
      const world = root.localToWorld(new THREE.Vector3(c[0], c[1], c[2]));
      // Slide along the X, Y or Z plane that faces the camera most, so only two numbers change.
      const look = camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(root.quaternion.clone().invert());
      const lock = [Math.abs(look.x), Math.abs(look.y), Math.abs(look.z)];
      const k = lock.indexOf(Math.max(...lock));
      const normal = new THREE.Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(root.quaternion);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
      const start = planePoint(ev, plane);
      if (!start) return;
      drag = { id: p.id, ids: descendants(p.id), plane, start, delta: [0, 0, 0], lock: k };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(ev.pointerId);
    };
    const onDrag = (ev: PointerEvent) => {
      if (!drag) return;
      const now = planePoint(ev, drag.plane);
      if (!now) return;
      const snap = (n: number) => Math.round(n * 2) / 2;
      drag.delta = [snap(now.x - drag.start.x), snap(now.y - drag.start.y), snap(now.z - drag.start.z)];
      drag.delta[drag.lock] = 0;
      for (const id of drag.ids) {
        const o = parts.get(id);
        if (!o) continue;
        instances(o.part).forEach((c, i) => {
          const q = add(add(c, scale(o.part.explode, stage.explode)), drag!.delta);
          o.groups[i].position.set(q[0], q[1], q[2]);
        });
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (drag) {
        const { id, delta } = drag;
        drag = null;
        controls.enabled = true;
        down = null;
        if (delta.some((n) => n !== 0)) onMoveRef.current?.(id, delta);
        return;
      }
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) {
        const id = pick(ev);
        onSelectRef.current(id);
        if (id) onPickRef.current?.(id, lastIndex);
      }
      down = null;
    };
    let hoverQueued = false;
    const onMove = (ev: PointerEvent) => {
      if (hoverQueued || ev.buttons) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const id = pick(ev);
        const p = id ? parts.get(id)?.part : null;
        renderer.domElement.style.cursor = p ? 'pointer' : 'grab';
        if (p && id !== stage.selectedId) {
          const rect = host.getBoundingClientRect();
          hoverLabel.textContent = p.refDes ? `${p.refDes} · ${p.name}` : p.name;
          hoverLabel.style.transform = `translate(${ev.clientX - rect.left + 14}px, ${ev.clientY - rect.top + 14}px)`;
          hoverLabel.dataset.show = '1';
        } else {
          hoverLabel.dataset.show = '';
        }
      });
    };
    const onLeave = () => { hoverLabel.dataset.show = ''; };
    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointermove', onDrag);
    el.addEventListener('pointerleave', onLeave);

    // Labels are placed most-important first; one that would cover another
    // is nudged up or down, and hidden if there is still no room.
    const v = new THREE.Vector3();
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const sizes = new WeakMap<HTMLElement, { w: number; h: number; key: string }>();
    const place = (label: HTMLElement, local: THREE.Vector3, dy = 0): void => {
      v.copy(local);
      root.localToWorld(v);
      v.project(camera);
      if (v.z > 1 || v.z < -1) {
        label.style.visibility = 'hidden';
        return;
      }
      const key = `${label.className}|${label.textContent}`;
      let size = sizes.get(label);
      if (!size || size.key !== key) {
        size = { w: label.offsetWidth, h: label.offsetHeight, key };
        sizes.set(label, size);
      }
      const x = (v.x * 0.5 + 0.5) * host.clientWidth;
      const y0 = (-v.y * 0.5 + 0.5) * host.clientHeight + dy;
      for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
        const y = y0 + shift * (size.h + 3);
        const clash = taken.some(
          (r) => Math.abs(r.x - x) < (r.w + size.w) / 2 + 4 && Math.abs(r.y - y) < (r.h + size.h) / 2 + 2,
        );
        if (clash) continue;
        taken.push({ x, y, w: size.w, h: size.h });
        label.style.visibility = '';
        label.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        return;
      }
      label.style.visibility = 'hidden';
    };

    // Parts that were not here last time pop in one after another.
    const known = drawn.get(td.product.name) ?? new Set<string>();
    const fresh = known.size ? td.parts.filter((p) => !known.has(p.id) && !p.id.startsWith('ghost-')).map((p) => p.id) : [];
    drawn.set(td.product.name, new Set(td.parts.map((p) => p.id)));
    const born = performance.now();
    if (!reduceMotion) fresh.forEach((id) => parts.get(id)?.groups.forEach((g) => g.scale.setScalar(0.001)));

    // Agent cursors: an arrow and a name tag each, placed every frame over the spot being worked on.
    const cursorEls = new Map<string, HTMLDivElement>();
    const cursorEl = (c: AgentCursor) => {
      let el = cursorEls.get(c.id);
      if (!el || !el.isConnected) {
        el = document.createElement('div');
        el.className = 'cur';
        el.innerHTML = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M2 1.5l11 5.2-4.6 1.5L6.6 13z" fill="currentColor" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg><span></span><i></i>';
        overlay.appendChild(el);
        cursorEls.set(c.id, el);
      }
      el.style.setProperty('--c', c.color);
      el.dataset.mode = c.mode;
      (el.children[1] as HTMLElement).textContent = c.name;
      return el;
    };

    const labelOrder = [...wires].sort((a, b) => (connPower(b.conn) ?? 0) - (connPower(a.conn) ?? 0));
    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const time = clock.getElapsedTime();
      controls.update();
      taken.length = 0;
      if (stage.selectedId && parts.has(stage.selectedId)) {
        const p = parts.get(stage.selectedId)!.part;
        const c = centre(p.id, stage.explode);
        tmp.set(c[0], c[1], c[2] + p.size[2] / 2);
        place(partLabel, tmp, -18);
      }
      for (const w of wires) {
        w.dots.forEach((dot, i) => {
          if (!dot.visible) return;
          w.curve.getPoint((time * w.speed + i / w.dots.length) % 1, tmp);
          dot.position.copy(tmp);
        });
      }
      const m = motionRef.current?.current;
      if (m) {
        // Product X is world X, product Y is world -Z, and heading turns about the vertical.
        rig.position.set(m.x, 0, -m.y);
        rig.rotation.y = m.heading;
        if (floor) { floor.visible = Number.isFinite(m.floorZ); floor.position.y = Number.isFinite(m.floorZ) ? m.floorZ : 0; }
        // The camera and the shadow light travel with the product, so it stays in view and lit.
        tmp.copy(rig.position).sub(lastRig);
        if (tmp.lengthSq() > 0) {
          camera.position.add(tmp);
          controls.target.add(tmp);
          lastRig.copy(rig.position);
        }
        key.position.copy(keyBase).add(rig.position);
        key.target.position.copy(rig.position);
        for (const [id, turn] of Object.entries(m.spin)) {
          parts.get(id)?.groups.forEach((g) => {
            g.rotation.set(0, 0, 0);
            g.rotation[turn.axis === 0 ? 'x' : turn.axis === 1 ? 'y' : 'z'] = turn.angle;
          });
        }
      }
      if (fresh.length && !reduceMotion) {
        const age = performance.now() - born;
        fresh.forEach((id, i) => {
          // Each part grows from nothing with a small overshoot, 45 ms after the one before.
          const k = Math.min(1, Math.max(0, (age - i * 45) / 420));
          const s = k >= 1 ? 1 : Math.max(0.001, 1 + 1.6 * Math.pow(k - 1, 3) + 0.6 * Math.pow(k - 1, 2));
          parts.get(id)?.groups.forEach((g) => g.scale.setScalar(s));
        });
        if (age > fresh.length * 45 + 500) fresh.length = 0;
      }
      for (const [id, el] of cursorEls) if (!stage.cursors.some((c) => c.id === id)) { el.remove(); cursorEls.delete(id); }
      stage.cursors.forEach((c, n) => {
        const el = cursorEl(c);
        const f = hash(c.id) * 6.28;
        let p: Vec3;
        if (c.mode === 'roam' && c.stops?.length) {
          // Hop from stop to stop, easing in and out.
          const beat = time / 1.1 + f;
          const i = Math.floor(beat) % c.stops.length;
          const k = beat - Math.floor(beat);
          const e = k * k * (3 - 2 * k);
          const a = c.stops[i];
          const b = c.stops[(i + 1) % c.stops.length];
          p = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
        } else if (c.mode === 'work') {
          // Busy: wander through the box on three unrelated rhythms.
          p = [
            c.center[0] + Math.sin(time * 1.9 + f) * c.size[0] * 0.38,
            c.center[1] + Math.sin(time * 1.3 + f * 2.1) * c.size[1] * 0.38,
            c.center[2] + Math.sin(time * 2.4 + f * 0.7) * c.size[2] * 0.38,
          ];
        } else {
          p = [c.center[0] + Math.sin(time * 0.6 + f) * c.size[0] * 0.08, c.center[1], c.center[2] + c.size[2] * 0.7];
        }
        tmp.set(p[0], p[1], p[2]);
        root.localToWorld(tmp);
        tmp.project(camera);
        const x = (tmp.x * 0.5 + 0.5) * host.clientWidth + (c.mode === 'work' ? 0 : (n % 2 ? 14 : -14));
        const y = (-tmp.y * 0.5 + 0.5) * host.clientHeight;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });

      // Running speakers, motors and buzzers shake a little, so you can see them work.
      if (!reduceMotion) {
        for (const o of parts.values()) {
          if (o.part.category !== 'electromech') continue;
          if (fresh.includes(o.part.id)) continue;
          const k = stage.active.has(o.part.id) ? 1 + Math.sin(time * 38 + o.part.position[0]) * 0.012 : 1;
          o.groups.forEach((g) => g.scale.setScalar(k));
        }
      }
      for (const w of labelOrder) {
        if (w.label && w.label.dataset.show === '1') {
          w.curve.getPoint(0.5, tmp);
          place(w.label, tmp);
        }
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointermove', onDrag);
      el.removeEventListener('pointerleave', onLeave);
      savedView = { key: td.product.name, position: camera.position.clone(), target: controls.target.clone() };
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      envTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.replaceChildren();
      stageRef.current = null;
    };
  }, [td, autoRotate, keepView, moves]);

  useEffect(() => {
    const s = stageRef.current;
    if (!s) return;
    s.explode = explode;
    s.layout();
  }, [td, explode]);

  useEffect(() => {
    const s = stageRef.current;
    if (!s) return;
    s.selectedId = selectedId;
    s.kinds = kinds;
    s.showValues = showValues;
    s.active = activeIds ?? new Set();
    s.live = liveWires ?? null;
    s.cursors = cursors ?? [];
    for (const { part, material, tints } of s.parts.values()) {
      const see = xray && part.category === 'enclosure';
      for (const m of [material, ...tints]) {
        m.transparent = see;
        m.opacity = see ? 0.2 : 1;
        m.depthWrite = !see;
        m.needsUpdate = true;
      }
    }
    s.restyle();
  }, [td, selectedId, kinds, showValues, xray, activeIds, liveWires, cursors]);

  useEffect(() => {
    const s = stageRef.current;
    if (!s) return;
    s.userMoved = false;
    s.fit();
  }, [resetSignal]);

  return (
    <div className="viewer">
      <div
        ref={hostRef}
        className="viewer-canvas"
        role="img"
        aria-label={`3D exploded view of ${td.product.name}. Use the parts list to select parts with the keyboard.`}
      />
      <div ref={overlayRef} className="viewer-overlay" aria-hidden="true" />
      {!autoRotate && (
        <div className="viewcube" role="group" aria-label="View from">
          {([['3D', [0.62, 0.48, 0.9]], ['Top', [0, 1, 0.001]], ['Front', [0, 0.02, 1]], ['Side', [1, 0.02, 0]]] as const).map(([label, dir]) => (
            <button key={label} type="button" onClick={() => stageRef.current?.look([...dir])}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
