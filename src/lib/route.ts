import type { BoardModel, Footprint } from './board';
import type { ConnectionKind } from './types';

// A small autorouter: draws copper traces between the pads of connected parts.
//
// The board is cut into a grid on two copper layers. Each net is routed in turn with a
// shortest-path search that may run straight or at 45 degrees, may change layer through a
// via, and keeps clear of pads, holes and traces that belong to other nets. Power nets go
// first and get wider traces.
//
// This is a first-pass route that shows how the board can be connected. For a product
// that was photographed, it is NOT the routing of the original board, which a photo does
// not show. It is not checked for current capacity, impedance or noise.

export interface Trace { net: string; kind: ConnectionKind; layer: 'top' | 'bottom'; width: number; points: [number, number][] }
export interface Via { net: string; x: number; y: number; drill: number; pad: number }
export interface PadRef { partId: string; ref: string; pad: number; x: number; y: number; side: 'top' | 'bottom' }

export interface Routing {
  traces: Trace[];
  vias: Via[];
  /** Which pad each end of each net uses. */
  ends: Map<string, [PadRef, PadRef]>;
  routed: number;
  failed: string[];
  /** Total trace length, mm. */
  length: number;
}

const PITCH = 0.5; // mm per grid cell
const VIA_COST = 14;
const cache = new WeakMap<BoardModel, Routing>();

/** Each net takes the next unused pad on the two parts it joins. The KiCad export uses the same choice. */
export function netEnds(b: BoardModel): Map<string, [PadRef, PadRef]> {
  const first = new Map<string, Footprint>();
  b.footprints.forEach((f) => { if (!first.has(f.partId)) first.set(f.partId, f); });
  const used = new Map<string, number>();
  const take = (partId: string): PadRef | null => {
    const f = first.get(partId);
    if (!f) return null;
    const i = used.get(partId) ?? 0;
    used.set(partId, i + 1);
    const p = f.pads.length ? f.pads[i % f.pads.length] : { x: 0, y: 0 };
    return { partId, ref: f.ref, pad: f.pads.length ? (i % f.pads.length) + 1 : 0, x: f.x + p.x, y: f.y + p.y, side: f.side };
  };
  const ends = new Map<string, [PadRef, PadRef]>();
  for (const n of b.nets) {
    const a = take(n.from);
    const c = take(n.to);
    if (a && c) ends.set(n.id, [a, c]);
  }
  return ends;
}

export function routeBoard(b: BoardModel): Routing {
  const hit = cache.get(b);
  if (hit) return hit;

  const W = Math.max(2, Math.ceil(b.width / PITCH) + 1);
  const H = Math.max(2, Math.ceil(b.height / PITCH) + 1);
  const N = W * H;
  // owner[layer * N + cell]: 0 free, -1 blocked for everyone, otherwise the net number that owns the copper.
  const owner = new Int16Array(N * 2);
  const cell = (x: number, y: number) => Math.round(y / PITCH) * W + Math.round(x / PITCH);
  const mark = (layer: number, x0: number, y0: number, x1: number, y1: number, who: number) => {
    // Only the grid points that lie inside the rectangle: rounding outwards would close the gaps between pins.
    const cx0 = Math.max(0, Math.ceil(x0 / PITCH - 0.01));
    const cx1 = Math.min(W - 1, Math.floor(x1 / PITCH + 0.01));
    const cy0 = Math.max(0, Math.ceil(y0 / PITCH - 0.01));
    const cy1 = Math.min(H - 1, Math.floor(y1 / PITCH + 0.01));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = layer * N + cy * W + cx;
        // A cell two nets both need is blocked for both, except the net that got there first keeps its own pad.
        if (owner[i] === 0 || owner[i] === who) owner[i] = who;
        else if (who === -1) owner[i] = -1;
      }
    }
  };

  // Keep off the board edge and out of the mounting holes, on both layers.
  for (let layer = 0; layer < 2; layer++) {
    for (let cx = 0; cx < W; cx++) { owner[layer * N + cx] = -1; owner[layer * N + (H - 1) * W + cx] = -1; }
    for (let cy = 0; cy < H; cy++) { owner[layer * N + cy * W] = -1; owner[layer * N + cy * W + W - 1] = -1; }
    for (const h of b.holes) mark(layer, h.x - h.d / 2 - 0.8, h.y - h.d / 2 - 0.8, h.x + h.d / 2 + 0.8, h.y + h.d / 2 + 0.8, -1);
  }

  const ends = netEnds(b);
  const netNo = new Map<string, number>();
  b.nets.forEach((n, i) => netNo.set(n.id, i + 1));
  const padOwner = new Map<string, number>();
  for (const [id, pair] of ends) for (const e of pair) padOwner.set(`${e.partId}#${e.pad}`, netNo.get(id)!);

  // Every pad is copper: it belongs to its net, or to nobody (blocked) when it has none.
  const firstOf = new Set<string>();
  for (const f of b.footprints) {
    const isFirst = !firstOf.has(f.partId);
    firstOf.add(f.partId);
    const layer = f.side === 'top' ? 0 : 1;
    f.pads.forEach((p, i) => {
      const who = (isFirst && padOwner.get(`${f.partId}#${i + 1}`)) || -1;
      const grow = 0.3;
      for (const l of f.round ? [0, 1] : [layer]) {
        mark(l, f.x + p.x - p.w / 2 - grow, f.y + p.y - p.h / 2 - grow, f.x + p.x + p.w / 2 + grow, f.y + p.y + p.h / 2 + grow, who);
      }
    });
  }

  const traces: Trace[] = [];
  const vias: Via[] = [];
  const failed: string[] = [];
  let length = 0;

  // Power first (it needs the room), then the shortest nets.
  const order = b.nets.filter((n) => ends.has(n.id)).sort((p, q) => {
    const rank = (k: ConnectionKind) => (k === 'power' ? 0 : k === 'ground' ? 1 : 2);
    const d = (id: string) => { const [a, c] = ends.get(id)!; return Math.hypot(a.x - c.x, a.y - c.y); };
    return rank(p.kind) - rank(q.kind) || d(p.id) - d(q.id);
  });

  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const cost = new Float32Array(N * 2);
  const from = new Int32Array(N * 2);

  for (const n of order) {
    const who = netNo.get(n.id)!;
    const [a, c] = ends.get(n.id)!;
    const start = (a.side === 'top' ? 0 : 1) * N + cell(a.x, a.y);
    const goal = (c.side === 'top' ? 0 : 1) * N + cell(c.x, c.y);
    const gx = goal % N % W;
    const gy = Math.floor((goal % N) / W);
    // A net always owns the cells under its own two pads, and the cells just outside them,
    // so a neighbour's clearance can never wall it in.
    for (const node of [start, goal]) {
      const layer = node >= N ? 1 : 0;
      const at = node - layer * N;
      for (const d of [0, 1, -1, W, -W]) {
        const i = layer * N + at + d;
        if (at + d >= 0 && at + d < N && (d === 0 || owner[i] !== -1 || true) && (d === 0 || owner[i] <= 0)) owner[i] = who;
      }
    }
    const free = (i: number) => owner[i] === 0 || owner[i] === who;
    cost.fill(Infinity);
    from.fill(-1);
    cost[start] = 0;
    // A plain binary heap of [priority, node] pairs.
    const heap: number[] = [];
    const push = (pri: number, node: number) => {
      heap.push(pri, node);
      let i = heap.length / 2 - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p * 2] <= heap[i * 2]) break;
        [heap[p * 2], heap[i * 2]] = [heap[i * 2], heap[p * 2]];
        [heap[p * 2 + 1], heap[i * 2 + 1]] = [heap[i * 2 + 1], heap[p * 2 + 1]];
        i = p;
      }
    };
    const pop = (): number => {
      const node = heap[1];
      const lastNode = heap.pop()!;
      const lastPri = heap.pop()!;
      const size = heap.length / 2;
      if (size > 0) {
        heap[0] = lastPri;
        heap[1] = lastNode;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < size && heap[l * 2] < heap[m * 2]) m = l;
          if (r < size && heap[r * 2] < heap[m * 2]) m = r;
          if (m === i) break;
          [heap[m * 2], heap[i * 2]] = [heap[i * 2], heap[m * 2]];
          [heap[m * 2 + 1], heap[i * 2 + 1]] = [heap[i * 2 + 1], heap[m * 2 + 1]];
          i = m;
        }
      }
      return node;
    };
    push(0, start);
    let found = false;
    let guard = 0;
    while (heap.length && guard++ < N * 8) {
      const node = pop();
      if (node === goal) { found = true; break; }
      const layer = node >= N ? 1 : 0;
      const at = node - layer * N;
      const x = at % W;
      const y = (at - x) / W;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const next = layer * N + ny * W + nx;
        if (!free(next)) continue;
        // A diagonal step must not squeeze between two blocked corners.
        if (d >= 4 && (!free(layer * N + y * W + nx) || !free(layer * N + ny * W + x))) continue;
        const step = cost[node] + (d >= 4 ? 1.414 : 1) + (from[node] >= 0 && from[node] - node !== node - next ? 0.25 : 0);
        if (step < cost[next]) {
          cost[next] = step;
          from[next] = node;
          push(step + Math.hypot(nx - gx, ny - gy), next);
        }
      }
      // Change layer through a via, where both layers are free and so are the cells round it.
      const other = (1 - layer) * N + at;
      if (free(other) && free(node) && x > 1 && y > 1 && x < W - 2 && y < H - 2) {
        const step = cost[node] + VIA_COST;
        if (step < cost[other]) { cost[other] = step; from[other] = node; push(step + Math.hypot(x - gx, y - gy), other); }
      }
    }
    if (!found) { failed.push(n.id); continue; }

    // Walk back from the goal, splitting at each layer change, and claim the copper.
    const width = n.kind === 'power' ? 0.5 : n.kind === 'ground' ? 0.4 : 0.25;
    let run: [number, number][] = [];
    let runLayer = goal >= N ? 1 : 0;
    const flush = () => {
      if (run.length > 1) {
        // Drop the points in the middle of straight runs.
        const pts = run.filter((p, i) => i === 0 || i === run.length - 1
          || Math.abs((p[0] - run[i - 1][0]) * (run[i + 1][1] - p[1]) - (p[1] - run[i - 1][1]) * (run[i + 1][0] - p[0])) > 1e-6);
        for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        traces.push({ net: n.id, kind: n.kind, layer: runLayer === 0 ? 'top' : 'bottom', width, points: pts });
      }
      run = [];
    };
    for (let node = goal; node >= 0; node = from[node]) {
      const layer = node >= N ? 1 : 0;
      const at = node - layer * N;
      const x = (at % W) * PITCH;
      const y = Math.floor(at / W) * PITCH;
      if (layer !== runLayer) {
        vias.push({ net: n.id, x, y, drill: 0.3, pad: 0.6 });
        flush();
        runLayer = layer;
        for (let l = 0; l < 2; l++) mark(l, x - 0.5, y - 0.5, x + 0.5, y + 0.5, who);
      }
      run.push([x, y]);
      // The trace and a clearance cell each side now belong to this net.
      mark(layer, x - PITCH, y - PITCH, x + PITCH, y + PITCH, who);
    }
    // The ends land on the grid; add the true pad centres so the trace meets the pad.
    run.push([a.x, a.y]);
    flush();
    const lastTrace = traces[traces.length - 1];
    const firstOfNet = traces.find((t) => t.net === n.id);
    if (firstOfNet && lastTrace) firstOfNet.points.unshift([c.x, c.y]);
  }

  const result: Routing = { traces, vias, ends, routed: order.length - failed.length, failed, length: Math.round(length) };
  cache.set(b, result);
  return result;
}
