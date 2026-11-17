import type { Part, Teardown } from './types';

// The block-diagram layout shared by the Architecture view and the product report:
// sources on the left, each board as a frame with its blocks, loads on the right.

export const BW = 158;
export const BH = 42;
const GAP = 14;
export const PAD = 16;
const HEAD = 30;
const COL_GAP = 90;

const ROLE_ORDER: Part['category'][] = ['connector', 'power', 'battery', 'ic', 'sensor', 'display', 'electromech', 'antenna', 'passive', 'thermal', 'other'];
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Block { id: string; x: number; y: number }
interface Frame { id: string; x: number; y: number; w: number; h: number; label: string }

export function archLayout(td: Teardown) {
  const byId = new Map(td.parts.map((p) => [p.id, p]));
  const edges = td.connections.filter((c) => c.kind !== 'mechanical' && byId.has(c.from) && byId.has(c.to));
  const used = new Set<string>();
  edges.forEach((e) => { used.add(e.from); used.add(e.to); });
  const boardsList = td.parts.filter((p) => p.category === 'pcb');
  const boardIds = new Set(boardsList.map((b) => b.id));
  const sortRole = (a: Part, b: Part) => ROLE_ORDER.indexOf(a.category) - ROLE_ORDER.indexOf(b.category);

  const powerOut = new Set(edges.filter((e) => e.kind === 'power').map((e) => e.from));
  const powerIn = new Set(edges.filter((e) => e.kind === 'power').map((e) => e.to));
  const off = td.parts.filter((p) => used.has(p.id) && !boardIds.has(p.id) && !(p.parentId && boardIds.has(p.parentId)));
  const isSource = (p: Part) => p.category === 'battery' || (powerOut.has(p.id) && !powerIn.has(p.id)) || Boolean(p.parentId && byId.get(p.parentId)?.category === 'battery');
  const left = off.filter(isSource).sort(sortRole);
  const right = off.filter((p) => !isSource(p)).sort(sortRole);

  const blocks: Block[] = [];
  const frames: Frame[] = [];
  const column = (parts: Part[], x: number) => {
    parts.forEach((p, i) => blocks.push({ id: p.id, x, y: PAD + HEAD + i * (BH + GAP) }));
    return parts.length ? parts.length * (BH + GAP) - GAP + HEAD : 0;
  };

  let x = PAD;
  const leftH = column(left, x);
  if (left.length) x += BW + COL_GAP;

  let y = PAD;
  let midW = 0;
  for (const b of boardsList) {
    const kids = td.parts.filter((p) => p.parentId === b.id && used.has(p.id)).sort(sortRole);
    if (!kids.length && !used.has(b.id)) continue;
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(kids.length))));
    const rows = Math.max(1, Math.ceil(kids.length / cols));
    const w = cols * BW + (cols - 1) * GAP + PAD * 2;
    const h = HEAD + rows * BH + (rows - 1) * GAP + PAD;
    frames.push({ id: b.id, x, y, w, h, label: `${b.refDes ? `${b.refDes} ` : ''}${b.name}` });
    kids.forEach((k, i) => blocks.push({
      id: k.id,
      x: x + PAD + (i % cols) * (BW + GAP),
      y: y + HEAD + Math.floor(i / cols) * (BH + GAP),
    }));
    midW = Math.max(midW, w);
    y += h + GAP * 2;
  }
  const midH = y - GAP * 2;
  if (midW) x += midW + COL_GAP;
  const rightH = column(right, x);
  if (right.length) x += BW + COL_GAP;

  return {
    edges, blocks, frames, byId,
    width: Math.max(320, x - COL_GAP + PAD),
    height: Math.max(leftH, midH, rightH) + PAD * 2,
  };
}

