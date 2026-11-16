import type { Connection, Teardown } from './types';

export function fmtV(v?: number): string | null {
  if (v == null) return null;
  return `${trim(v)} V`;
}

export function fmtA(a?: number): string | null {
  if (a == null) return null;
  if (Math.abs(a) < 0.001) return `${trim(a * 1e6)} µA`;
  if (Math.abs(a) < 1) return `${trim(a * 1000)} mA`;
  return `${trim(a)} A`;
}

export function fmtW(w?: number): string | null {
  if (w == null) return null;
  if (w === 0) return '0 W';
  if (Math.abs(w) < 0.001) return `${trim(w * 1e6)} µW`;
  if (Math.abs(w) < 1) return `${trim(w * 1000)} mW`;
  return `${trim(w)} W`;
}

function trim(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 100 ? n.toFixed(0) : abs >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Power on a connection: stated, or V × I when both are given. */
export function connPower(c: Connection): number | undefined {
  if (c.powerW != null) return c.powerW;
  if (c.voltageV != null && c.currentA != null) return c.voltageV * c.currentA;
  return undefined;
}

export function connValues(c: Connection): string {
  return [fmtV(c.voltageV), fmtA(c.currentA), fmtW(connPower(c))].filter(Boolean).join(' · ');
}

export interface PartPower {
  inW: number;
  outW: number;
  /** Power that stays in the part: turned into heat, sound, light or radio. */
  usedW: number;
  hasIn: boolean;
  hasOut: boolean;
}

export function partPower(td: Teardown): Map<string, PartPower> {
  const m = new Map<string, PartPower>();
  const get = (id: string) => {
    let v = m.get(id);
    if (!v) m.set(id, (v = { inW: 0, outW: 0, usedW: 0, hasIn: false, hasOut: false }));
    return v;
  };
  for (const c of td.connections) {
    if (c.kind !== 'power') continue;
    const w = connPower(c) ?? 0;
    const a = get(c.from);
    const b = get(c.to);
    a.outW += w; a.hasOut = true;
    b.inW += w; b.hasIn = true;
  }
  for (const v of m.values()) v.usedW = Math.max(0, v.inW - v.outW);
  return m;
}

export interface TreeNode { id: string; depth: number; row: number }
export interface PowerTreeLayout { nodes: TreeNode[]; edges: Connection[]; depthCount: number; rowCount: number }

/** Left-to-right layout of the power connections: sources first, loads last. */
export function powerTree(td: Teardown): PowerTreeLayout {
  const edges = td.connections.filter((c) => c.kind === 'power');
  const ids = new Set<string>();
  edges.forEach((e) => { ids.add(e.from); ids.add(e.to); });
  const incoming = new Map<string, Connection[]>();
  edges.forEach((e) => incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]));

  // Longest path from any source. A visiting set guards against loops.
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const ins = incoming.get(id) ?? [];
    const d = ins.length ? Math.max(...ins.map((e) => visit(e.from, seen) + 1)) : 0;
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  ids.forEach((id) => visit(id, new Set()));

  const byDepth = new Map<number, string[]>();
  const order = td.parts.map((p) => p.id);
  [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach((id) => {
    const d = depth.get(id) ?? 0;
    byDepth.set(d, [...(byDepth.get(d) ?? []), id]);
  });

  // Order each column by the average row of its feeders to reduce crossings.
  const row = new Map<string, number>();
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const d of depths) {
    const col = byDepth.get(d)!;
    if (d > 0) {
      const score = (id: string) => {
        const ins = (incoming.get(id) ?? []).map((e) => row.get(e.from) ?? 0);
        return ins.length ? ins.reduce((s, v) => s + v, 0) / ins.length : 0;
      };
      col.sort((a, b) => score(a) - score(b));
    }
    col.forEach((id, i) => row.set(id, i));
  }

  const nodes = [...ids].map((id) => ({ id, depth: depth.get(id) ?? 0, row: row.get(id) ?? 0 }));
  return {
    nodes,
    edges,
    depthCount: depths.length,
    rowCount: Math.max(1, ...[...byDepth.values()].map((c) => c.length)),
  };
}
