import { instances } from './geometry';
import { connValues } from './power';
import type { Axis, Connection, Part, Teardown, Vec3 } from './types';

// The bare board, derived from the teardown: the outline of a PCB part, the
// footprint of every part mounted on it, indicative pads, mounting holes and
// the nets between on-board parts. Board coordinates are millimetres with the
// origin at the lower-left corner, looking at the top side.
//
// This is a placement reconstruction. A photo does not contain the copper, so
// there is no routing: pads are typical for the part class, not measured.

export interface Pad { x: number; y: number; w: number; h: number }

export interface Footprint {
  key: string;
  partId: string;
  ref: string;
  name: string;
  category: Part['category'];
  side: 'top' | 'bottom';
  /** Centre and size on the board plane. */
  x: number; y: number; w: number; h: number;
  round: boolean;
  pads: Pad[];
}

export interface Hole { x: number; y: number; d: number; partId: string }

export interface Net { id: string; label: string; kind: Connection['kind']; from: string; to: string; values: string }

export interface BoardModel {
  part: Part;
  width: number;
  height: number;
  thickness: number;
  normal: Axis;
  /** Indices into a 3D vector: the board normal, then the two in-plane axes (x and y on the board). */
  axes: { n: 0 | 1 | 2; u: 0 | 1 | 2; v: 0 | 1 | 2 };
  footprints: Footprint[];
  holes: Hole[];
  nets: Net[];
}

const AX: Axis[] = ['x', 'y', 'z'];

/** Index of the thinnest axis (the board normal) and the two in-plane axes. */
function planeOf(size: Vec3): { n: 0 | 1 | 2; u: 0 | 1 | 2; v: 0 | 1 | 2 } {
  const n = size.indexOf(Math.min(...size)) as 0 | 1 | 2;
  const [a, b] = ([0, 1, 2] as const).filter((i) => i !== n);
  // Keep the longer side horizontal.
  return size[a] >= size[b] ? { n, u: a, v: b } : { n, u: b, v: a };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function padsFor(category: Part['category'], w: number, h: number, round: boolean): Pad[] {
  const pads: Pad[] = [];
  if (round) {
    // Through-hole style: two pads across the diameter.
    const d = Math.max(1.2, Math.min(2.2, w * 0.25));
    return [{ x: -w * 0.25, y: 0, w: d, h: d }, { x: w * 0.25, y: 0, w: d, h: d }];
  }
  const long = Math.max(w, h);
  const horizontal = w >= h;
  const row = (count: number, along: number, across: number, padAlong: number, padAcross: number) => {
    const pitch = count > 1 ? (long - padAlong * 1.6) / (count - 1) : 0;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? -((count - 1) * pitch) / 2 + i * pitch : 0;
      pads.push(horizontal
        ? { x: t + along, y: across, w: padAlong, h: padAcross }
        : { x: across, y: t + along, w: padAcross, h: padAlong });
    }
  };
  const short = Math.min(w, h);
  if (category === 'ic' || category === 'power' || category === 'sensor') {
    const count = Math.max(2, Math.min(16, Math.floor(long / 1.27)));
    const padAlong = Math.min(0.6, (long / count) * 0.55);
    const padAcross = Math.max(0.6, Math.min(1.5, short * 0.22));
    row(count, 0, short / 2 - padAcross / 2 + 0.3, padAlong, padAcross);
    row(count, 0, -(short / 2 - padAcross / 2 + 0.3), padAlong, padAcross);
    return pads;
  }
  if (category === 'connector') {
    const count = Math.max(2, Math.min(24, Math.floor(long / 1.25)));
    const padAlong = Math.min(0.7, (long / count) * 0.55);
    row(count, 0, -(short / 2 - 0.5), padAlong, 1.2);
    return pads;
  }
  // Two-terminal parts: a pad at each end of the long side.
  const padLen = Math.max(0.4, Math.min(2.5, long * 0.28));
  const padWid = Math.max(0.4, short * 0.9);
  for (const s of [-1, 1]) {
    const c = s * (long / 2 - padLen / 2);
    pads.push(horizontal ? { x: c, y: 0, w: padLen, h: padWid } : { x: 0, y: c, w: padWid, h: padLen });
  }
  return pads;
}

export function boards(td: Teardown): BoardModel[] {
  return td.parts.filter((p) => p.category === 'pcb').map((board) => {
    const { n, u, v } = planeOf(board.size);
    const width = board.size[u];
    const height = board.size[v];
    const toBoard = (c: Vec3) => ({
      x: round2(c[u] - board.position[u] + width / 2),
      y: round2(c[v] - board.position[v] + height / 2),
    });

    const footprints: Footprint[] = [];
    for (const p of td.parts) {
      if (p.parentId !== board.id) continue;
      const round = p.shape === 'cylinder' && (p.axis ?? 'z') === AX[n];
      instances(p).forEach((c, i) => {
        const w = round2(Math.max(0.4, p.size[u]));
        const h = round2(Math.max(0.4, p.size[v]));
        footprints.push({
          key: `${p.id}#${i}`,
          partId: p.id,
          ref: i === 0 ? (p.refDes ?? p.id) : `${p.refDes ?? p.id}.${i + 1}`,
          name: p.name,
          category: p.category,
          side: c[n] >= board.position[n] ? 'top' : 'bottom',
          ...toBoard(c),
          w, h, round,
          pads: p.pads ?? (p.category === 'antenna' ? [] : padsFor(p.category, w, h, round)),
        });
      });
    }

    // A fastener makes a hole when it crosses the board inside its outline.
    const holes: Hole[] = [];
    for (const p of td.parts) {
      if (p.category !== 'fastener') continue;
      const dia = Math.min(p.size[u], p.size[v]);
      for (const c of instances(p)) {
        const { x, y } = toBoard(c);
        const crosses = Math.abs(c[n] - board.position[n]) <= p.size[n] / 2 + board.size[n];
        if (crosses && x > 0 && x < width && y > 0 && y < height) {
          holes.push({ x, y, d: round2(Math.max(1, dia) + 0.4), partId: p.id });
        }
      }
    }

    for (const d of board.drills ?? []) holes.push({ x: d.x, y: d.y, d: d.d, partId: board.id });

    const onBoard = new Set([board.id, ...footprints.map((f) => f.partId)]);
    const nets: Net[] = td.connections
      .filter((c) => c.kind !== 'mechanical' && onBoard.has(c.from) && onBoard.has(c.to))
      .map((c) => ({ id: c.id, label: c.label, kind: c.kind, from: c.from, to: c.to, values: connValues(c) }));

    return { part: board, width: round2(width), height: round2(height), thickness: board.size[n], normal: AX[n], axes: { n, u, v }, footprints, holes, nets };
  });
}
