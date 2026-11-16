import { instances } from './geometry';
import type { Part, Teardown, Vec3 } from './types';

// Edits for the design tab. Each returns a new teardown, so every view, check
// and export follows the change, and undo is a matter of keeping the old one.

const r1 = (n: number) => Math.round(n * 10) / 10;
const shift = (v: Vec3, d: Vec3): Vec3 => [r1(v[0] + d[0]), r1(v[1] + d[1]), r1(v[2] + d[2])];

/** A part and everything mounted on it, at any depth. */
export function family(td: Teardown, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of td.parts) {
      if (p.parentId && out.has(p.parentId) && !out.has(p.id)) { out.add(p.id); grew = true; }
    }
  }
  return out;
}

function mapParts(td: Teardown, fn: (p: Part) => Part): Teardown {
  return { ...td, parts: td.parts.map(fn) };
}

/** Move a part. Parts mounted on it come along unless told otherwise. */
export function movePart(td: Teardown, id: string, delta: Vec3, withMounted = true): Teardown {
  const ids = withMounted ? family(td, id) : new Set([id]);
  return mapParts(td, (p) => (ids.has(p.id)
    ? { ...p, position: shift(p.position, delta), copies: p.copies?.map((c) => shift(c, delta)) }
    : p));
}

export function setPosition(td: Teardown, id: string, axis: 0 | 1 | 2, value: number, withMounted = true): Teardown {
  const p = td.parts.find((x) => x.id === id);
  if (!p || !Number.isFinite(value)) return td;
  const delta: Vec3 = [0, 0, 0];
  delta[axis] = value - p.position[axis];
  return movePart(td, id, delta, withMounted);
}

export function setSize(td: Teardown, id: string, axis: 0 | 1 | 2, value: number): Teardown {
  if (!Number.isFinite(value) || value <= 0) return td;
  return mapParts(td, (p) => {
    if (p.id !== id) return p;
    const size: Vec3 = [...p.size];
    size[axis] = r1(Math.max(0.2, value));
    // A part built from several solids stretches with its bounding box.
    const k = size[axis] / p.size[axis];
    const shapes = p.shapes?.map((s) => {
      const ss: Vec3 = [...s.size];
      const so: Vec3 = [...s.offset];
      ss[axis] = r1(ss[axis] * k);
      so[axis] = r1(so[axis] * k);
      return { ...s, size: ss, offset: so };
    });
    return { ...p, size, shapes };
  });
}

export function setWall(td: Teardown, id: string, value: number): Teardown {
  if (!Number.isFinite(value) || value <= 0) return td;
  return mapParts(td, (p) => (p.id === id ? { ...p, wall: r1(Math.max(0.4, Math.min(value, Math.min(...p.size) / 3))) } : p));
}

/** Put a part in the middle of the housing along one axis. */
export function centreInHousing(td: Teardown, id: string, axis: 0 | 1 | 2): Teardown {
  const housing = td.parts.filter((p) => p.category === 'enclosure' && p.id !== id);
  if (!housing.length) return td;
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of housing) {
    for (const c of instances(h)) { lo = Math.min(lo, c[axis] - h.size[axis] / 2); hi = Math.max(hi, c[axis] + h.size[axis] / 2); }
  }
  return setPosition(td, id, axis, r1((lo + hi) / 2));
}

/** Grow or shrink every housing part about the centre, so the case stays in one piece. */
export function scaleHousing(td: Teardown, axis: 0 | 1 | 2, deltaMm: number): Teardown {
  const housing = td.parts.filter((p) => p.category === 'enclosure');
  if (!housing.length || !deltaMm) return td;
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of housing) { lo = Math.min(lo, h.position[axis] - h.size[axis] / 2); hi = Math.max(hi, h.position[axis] + h.size[axis] / 2); }
  const span = hi - lo;
  const mid = (lo + hi) / 2;
  if (span + deltaMm < 5) return td;
  const k = (span + deltaMm) / span;
  const next = mapParts(td, (p) => {
    if (p.category !== 'enclosure') return p;
    const size: Vec3 = [...p.size];
    const position: Vec3 = [...p.position];
    // Thin panels (a grille, a lid) keep their thickness and only move.
    const thin = p.shape !== 'shell' && p.size[axis] < span * 0.15;
    if (!thin) size[axis] = r1(p.size[axis] * k);
    position[axis] = r1(mid + (p.position[axis] - mid) * k);
    return { ...p, size, position };
  });
  const dims: Vec3 = [...td.product.dimensionsMm];
  dims[axis] = r1(span + deltaMm);
  return { ...next, product: { ...next.product, dimensionsMm: dims } };
}
