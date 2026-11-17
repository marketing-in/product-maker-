import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { boardFace } from '../components/Viewer3D';
import { boards } from './board';
import { add, instances, partPrims, scale } from './geometry';
import type { Part, Teardown } from './types';

// Still pictures of the 3D model, for the product report and the full download.
// Drawn off screen with the same geometry and printed boards as the 3D view.

export interface SnapshotOptions {
  /** 0 assembled, 1 fully exploded. */
  explode?: number;
  /** Draw the housing see-through. */
  xray?: boolean;
  /** Paint chosen parts in another colour (the fit view). */
  colors?: Map<string, string>;
  width?: number;
  height?: number;
  /** Direction the camera looks from, in view space. */
  from?: [number, number, number];
  background?: string;
}

function surface(p: Part): { metalness: number; roughness: number } {
  const t = (p.material ?? '').toLowerCase();
  if (/steel|stainless|nickel|zinc|chrome|alumin|copper|brass|gold/.test(t) || ['fastener', 'connector', 'thermal'].includes(p.category)) return { metalness: 0.9, roughness: 0.35 };
  if (/rubber|silicone|foam|fabric/.test(t)) return { metalness: 0, roughness: 0.9 };
  return { metalness: 0, roughness: 0.5 };
}

/** A JPEG data URL of the product, or null if the browser cannot draw 3D. */
export function snapshot(td: Teardown, o: SnapshotOptions = {}): string | null {
  const width = o.width ?? 1600;
  const height = o.height ?? 1000;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(new THREE.Color(o.background ?? '#171a1f'));

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.65;
  const key = new THREE.DirectionalLight(0xfff4e6, 1.7);
  key.position.set(0.55, 1, 0.65);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(-0.8, 0.35, -0.6);
  scene.add(fill);
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  scene.add(root);

  const faces = new Map(boards(td).map((b) => [b.part.id, b]));
  const t = o.explode ?? 0;
  const mats: THREE.Material[] = [];
  for (const p of td.parts) {
    const color = o.colors?.get(p.id);
    const see = Boolean(o.xray) && p.category === 'enclosure';
    const make = (c: string) => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c), ...surface(p), transparent: see, opacity: see ? 0.18 : 1, depthWrite: !see });
      mats.push(m);
      return m;
    };
    const base = make(color ?? p.color);
    const geos = partPrims(p).map((prim) => {
      let g: THREE.BufferGeometry;
      if (prim.kind === 'box') g = new THREE.BoxGeometry(prim.size[0], prim.size[1], prim.size[2]);
      else {
        g = new THREE.CylinderGeometry(prim.radius, prim.radius, prim.length, 40);
        if (prim.axis === 'x') g.rotateZ(-Math.PI / 2);
        if (prim.axis === 'z') g.rotateX(Math.PI / 2);
      }
      g.translate(prim.center[0], prim.center[1], prim.center[2]);
      return { g, mat: prim.color && !color ? make(prim.color) : base };
    });
    for (const c of instances(p)) {
      const group = new THREE.Group();
      geos.forEach(({ g, mat }) => group.add(new THREE.Mesh(g, mat)));
      const b = faces.get(p.id);
      if (b && !color) {
        for (const side of ['top', 'bottom'] as const) {
          if (side === 'bottom' && !b.footprints.some((f) => f.side === 'bottom')) continue;
          const face = boardFace(b, side);
          if (face) group.add(face);
        }
      }
      const q = add(c, scale(p.explode, t));
      group.position.set(q[0], q[1], q[2]);
      root.add(group);
    }
  }

  // Frame the model.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(10, box.getBoundingSphere(new THREE.Sphere()).radius);
  const camera = new THREE.PerspectiveCamera(30, width / height, radius / 50, radius * 20);
  const dir = new THREE.Vector3(...(o.from ?? [0.62, 0.48, 0.9])).normalize();
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fov / 2)) * (width < height ? height / width : 1) * 0.92;
  camera.position.copy(centre).addScaledVector(dir, dist);
  camera.lookAt(centre);
  key.position.copy(centre).add(new THREE.Vector3(0.55, 1, 0.65).multiplyScalar(radius * 3));

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.9);

  scene.traverse((obj) => {
    const m = obj as THREE.Mesh;
    m.geometry?.dispose();
    const mm = m.material as THREE.Material | undefined;
    if (mm && 'map' in mm && (mm as THREE.MeshPhysicalMaterial).map) (mm as THREE.MeshPhysicalMaterial).map!.dispose();
  });
  mats.forEach((m) => m.dispose());
  env.dispose();
  pmrem.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
