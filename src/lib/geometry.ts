import type { Axis, Part, Teardown, Vec3 } from './types';

// One part becomes one or more primitives, given relative to the part centre.
// The 3D viewer, the STEP writer and the Blender script all build from these,
// so the three always agree.

export type Prim =
  | { kind: 'box'; size: Vec3; center: Vec3; color?: string }
  | { kind: 'cyl'; radius: number; length: number; axis: Axis; center: Vec3; color?: string };

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export function partPrims(p: Part): Prim[] {
  const [sx, sy, sz] = p.size;
  // A part described as several solids is drawn from those.
  if (p.shapes && p.shapes.length >= 2) {
    return p.shapes.map((s): Prim => {
      if (s.shape === 'cylinder') {
        const axis = s.axis ?? 'z';
        const ai = AXIS_INDEX[axis];
        const o = [0, 1, 2].filter((i) => i !== ai) as (0 | 1 | 2)[];
        return { kind: 'cyl', radius: Math.max(s.size[o[0]], s.size[o[1]]) / 2, length: s.size[ai], axis, center: s.offset, color: s.color };
      }
      return { kind: 'box', size: s.size, center: s.offset, color: s.color };
    });
  }
  if (p.shape === 'cylinder') {
    const axis = p.axis ?? 'z';
    const ai = AXIS_INDEX[axis];
    const others = [0, 1, 2].filter((i) => i !== ai) as (0 | 1 | 2)[];
    const dia = Math.max(p.size[others[0]], p.size[others[1]]);
    return [{ kind: 'cyl', radius: dia / 2, length: p.size[ai], axis, center: [0, 0, 0] }];
  }
  if (p.shape === 'shell') {
    const open = p.open ?? '+z';
    const ai = AXIS_INDEX[open[1] as Axis];
    const sign = open[0] === '+' ? 1 : -1;
    const w = Math.max(0.4, Math.min(p.wall ?? 2, Math.min(sx, sy, sz) / 3));
    const [bi, ci] = [0, 1, 2].filter((i) => i !== ai) as (0 | 1 | 2)[];
    const prims: Prim[] = [];
    const mk = (size: Vec3, center: Vec3) => prims.push({ kind: 'box', size, center });

    // Floor: the face opposite the open one.
    const floorSize: Vec3 = [...p.size];
    floorSize[ai] = w;
    const floorCenter: Vec3 = [0, 0, 0];
    floorCenter[ai] = -sign * (p.size[ai] / 2 - w / 2);
    mk(floorSize, floorCenter);

    // Four side walls, sitting on the floor without overlapping each other.
    const wallLen = p.size[ai] - w;
    const wallShift = (sign * w) / 2;
    for (const s of [-1, 1]) {
      const size: Vec3 = [...p.size];
      size[ai] = wallLen;
      size[bi] = w;
      const center: Vec3 = [0, 0, 0];
      center[ai] = wallShift;
      center[bi] = s * (p.size[bi] / 2 - w / 2);
      mk(size, center);
    }
    for (const s of [-1, 1]) {
      const size: Vec3 = [...p.size];
      size[ai] = wallLen;
      size[bi] = p.size[bi] - 2 * w;
      size[ci] = w;
      const center: Vec3 = [0, 0, 0];
      center[ai] = wallShift;
      center[ci] = s * (p.size[ci] / 2 - w / 2);
      mk(size, center);
    }
    return prims;
  }
  return [{ kind: 'box', size: [sx, sy, sz], center: [0, 0, 0] }];
}

/** Assembled centres of every copy of a part. */
export function instances(p: Part): Vec3[] {
  return [p.position, ...(p.copies ?? [])];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Radius of a sphere that contains the product at explode amount t. */
export function sceneRadius(td: Teardown, t: number): number {
  let r = 10;
  for (const p of td.parts) {
    const half = Math.hypot(p.size[0], p.size[1], p.size[2]) / 2;
    for (const c of instances(p)) {
      const q = add(c, scale(p.explode, t));
      r = Math.max(r, Math.hypot(q[0], q[1], q[2]) + half);
    }
  }
  return r;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'teardown';
}
