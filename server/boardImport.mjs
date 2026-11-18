import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';

// Reads a board the user already has, so a housing can be designed round it.
//
//   Gerber + drill files (loose or in a .zip)   parsed with gerber-parser / gerber-plotter and drawn
//                                               with pcb-stackup, the tracespace tools kitspace.org uses
//   KiCad board (.kicad_pcb)                    parsed directly: outline, footprints, pads, nets
//
// Everything is returned in millimetres with the origin at the lower-left corner of the board, Y up.
// Files are read from memory only. Nothing here executes or fetches anything named inside a file.

const require = createRequire(import.meta.url);
const MAX_FILES = 60;
const MAX_BYTES = 12 * 1024 * 1024;

const r2 = (n) => Math.round(n * 100) / 100;

// ---------- zip ----------

/** Lists the files in a zip archive. Stored and deflated entries only, which covers what EDA tools write. */
export function unzip(buf) {
  const out = [];
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('That zip file could not be read.');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  let total = 0;
  for (let n = 0; n < count && out.length < MAX_FILES; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || size > MAX_BYTES || (total += size) > MAX_BYTES * 3) continue;
    if (local + 30 > buf.length) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + packed);
    try {
      const data = method === 0 ? body : method === 8 ? inflateRawSync(body, { maxOutputLength: MAX_BYTES }) : null;
      // Only the last path segment is kept, so a crafted name cannot point anywhere.
      if (data) out.push({ name: name.split(/[\\/]/).pop(), data });
    } catch { /* skip an entry that does not inflate */ }
  }
  return out;
}

// ---------- KiCad ----------

function parseSexpr(text) {
  const root = [];
  const stack = [root];
  const re = /\(|\)|"((?:[^"\\]|\\.)*)"|[^\s()"]+/g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[0];
    if (t === '(') { const node = []; stack[stack.length - 1].push(node); stack.push(node); }
    else if (t === ')') { if (stack.length > 1) stack.pop(); }
    else stack[stack.length - 1].push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : t);
  }
  return root[0] ?? [];
}

const kids = (node, name) => node.filter((c) => Array.isArray(c) && c[0] === name);
const kid = (node, name) => node.find((c) => Array.isArray(c) && c[0] === name);
const nums = (node) => (node ?? []).slice(1).map(Number).filter(Number.isFinite);

function parseKicad(text, fileName) {
  const tree = parseSexpr(text);
  if (tree[0] !== 'kicad_pcb') throw new Error('That file is not a KiCad board (.kicad_pcb).');
  const notes = [];

  // Outline: every graphic on Edge.Cuts. Arcs and circles are taken by their bounding points.
  const edge = [];
  const onEdge = (n) => (kid(n, 'layer') ?? [])[1] === 'Edge.Cuts';
  for (const n of tree.filter(Array.isArray)) {
    if (!/^gr_(line|rect|arc|circle|poly|curve)$/.test(n[0]) || !onEdge(n)) continue;
    for (const key of ['start', 'end', 'mid', 'center']) { const p = nums(kid(n, key)); if (p.length >= 2) edge.push(p); }
    if (n[0] === 'gr_circle') {
      const c = nums(kid(n, 'center'));
      const e = nums(kid(n, 'end'));
      if (c.length >= 2 && e.length >= 2) { const r = Math.hypot(e[0] - c[0], e[1] - c[1]); edge.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]); }
    }
    for (const pts of kids(n, 'pts')) for (const xy of kids(pts, 'xy')) { const p = nums(xy); if (p.length >= 2) edge.push(p); }
  }

  const raw = [];
  const holes = [];
  for (const fp of tree.filter((n) => Array.isArray(n) && (n[0] === 'footprint' || n[0] === 'module'))) {
    const at = nums(kid(fp, 'at'));
    const [fx = 0, fy = 0, rot = 0] = at;
    const side = (kid(fp, 'layer') ?? [])[1] === 'B.Cu' ? 'bottom' : 'top';
    const prop = (name) => (kids(fp, 'property').find((p) => p[1] === name) ?? [])[2];
    const textOf = (kind) => (kids(fp, 'fp_text').find((t) => t[1] === kind) ?? [])[2];
    const ref = prop('Reference') ?? textOf('reference') ?? '';
    const value = prop('Value') ?? textOf('value') ?? '';
    const a = (-rot * Math.PI) / 180;
    const turn = (x, y) => [fx + x * Math.cos(a) - y * Math.sin(a), fy + x * Math.sin(a) + y * Math.cos(a)];
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    let pads = 0;
    const padList = [];
    const drilled = [];
    for (const pad of kids(fp, 'pad')) {
      const [px = 0, py = 0] = nums(kid(pad, 'at'));
      const [w = 0.5, h = w] = nums(kid(pad, 'size'));
      const [cx, cy] = turn(px, py);
      const drill = nums(kid(pad, 'drill'))[0];
      if (pad[2] === 'np_thru_hole' || (pad[1] === '' && drill >= 2)) { holes.push({ x: cx, y: cy, d: drill ?? w }); continue; }
      const turned = Math.abs(Math.round(((nums(kid(pad, 'at'))[2] ?? rot) / 90))) % 2 === 1;
      padList.push({ x: cx, y: -cy, w: turned ? h : w, h: turned ? w : h, round: pad[3] === 'circle' || pad[3] === 'oval' && w === h });
      if (drill) drilled.push({ x: cx, y: -cy });
      const half = Math.max(w, h) / 2;
      box[0] = Math.min(box[0], cx - half); box[1] = Math.min(box[1], cy - half);
      box[2] = Math.max(box[2], cx + half); box[3] = Math.max(box[3], cy + half);
      pads++;
    }
    if (!pads) continue;
    raw.push({ ref, value, footprint: String(fp[1] ?? '').split(':').pop(), side, pads, box, padList, drilled });
    for (const b of [[box[0], box[1]], [box[2], box[3]]]) if (!edge.length) edge.push(b);
  }
  if (!edge.length) throw new Error('No board outline was found on the Edge.Cuts layer.');

  const minX = Math.min(...edge.map((p) => p[0]));
  const maxX = Math.max(...edge.map((p) => p[0]));
  const minY = Math.min(...edge.map((p) => p[1]));
  const maxY = Math.max(...edge.map((p) => p[1]));
  // KiCad's Y axis points down; flip it so the result is Y up from the lower-left corner.
  const X = (x) => r2(x - minX);
  const Y = (y) => r2(maxY - y);
  const components = raw.map((c) => {
    // Pads were stored with Y already flipped, so the centre is flipped the same way.
    const f = padFeatures(c.padList, (c.box[0] + c.box[2]) / 2, -(c.box[1] + c.box[3]) / 2, c.drilled.map((d) => ({ ...d })));
    return {
      ref: c.ref, value: c.value, footprint: c.footprint, side: c.side, pads: c.pads,
      x: X((c.box[0] + c.box[2]) / 2), y: Y((c.box[1] + c.box[3]) / 2),
      w: r2(c.box[2] - c.box[0]), h: r2(c.box[3] - c.box[1]),
      padList: f.pads, layout: f.layout, pitch: f.pitch, ep: f.ep, th: f.th, anchors: f.anchors,
    };
  });
  const thickness = nums(kid(kid(tree, 'general') ?? [], 'thickness'))[0] ?? 1.6;
  const nets = kids(tree, 'net').length;
  if (kids(tree, 'segment').length === 0) notes.push('The board has no routed tracks yet.');

  return {
    kind: 'kicad', name: fileName,
    board: { width: r2(maxX - minX), height: r2(maxY - minY), thickness: r2(thickness) },
    holes: holes.map((h) => ({ x: X(h.x), y: Y(h.y), d: r2(h.d) })),
    components, nets,
    layers: kids(kid(tree, 'layers') ?? [], undefined).length || (kid(tree, 'layers') ?? []).filter(Array.isArray).filter((l) => l[2] === 'signal').length,
    exact: true, notes,
  };
}

// ---------- Gerber ----------

function plot(text, options = {}) {
  const parser = require('gerber-parser');
  const plotter = require('gerber-plotter');
  return new Promise((resolve, reject) => {
    const objects = [];
    const p = parser(options);
    const pl = plotter(options);
    const timer = setTimeout(() => reject(new Error('A file took too long to read.')), 20000);
    p.on('warning', () => {});
    pl.on('warning', () => {});
    p.on('error', reject);
    pl.on('error', reject);
    pl.on('data', (o) => { if (objects.length < 200000) objects.push(o); });
    pl.on('end', () => { clearTimeout(timer); resolve(objects); });
    p.pipe(pl);
    p.end(text);
  });
}

/** Pads from a plotted copper or drill layer, in millimetres. */
function padsOf(objects) {
  const size = objects.find((o) => o.type === 'size');
  const k = size?.units === 'in' ? 25.4 : 1;
  const tools = new Map();
  const pads = [];
  for (const o of objects) {
    if (o.type === 'shape') {
      // A pad shape is one or more primitives: circles, rectangles, polygons (octagons), rings.
      // Its size is the box round all of them.
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      const grow = (x, y) => { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); };
      for (const s of o.shape ?? []) {
        const cx = s.cx ?? 0;
        const cy = s.cy ?? 0;
        if (s.type === 'circle' || s.type === 'ring') { const r = (s.r ?? 0) + (s.width ?? 0) / 2 * (s.type === 'ring' ? 1 : 0); grow(cx - r, cy - r); grow(cx + r, cy + r); }
        else if (s.type === 'rect') { grow(cx - (s.width ?? 0) / 2, cy - (s.height ?? 0) / 2); grow(cx + (s.width ?? 0) / 2, cy + (s.height ?? 0) / 2); }
        else if (Array.isArray(s.points)) for (const [x, y] of s.points) grow(x, y);
      }
      const ok = box.every(Number.isFinite);
      const w = ok ? (box[2] - box[0]) * k : 0;
      const h = ok ? (box[3] - box[1]) * k : 0;
      const first = (o.shape ?? [])[0] ?? {};
      const round = (o.shape ?? []).length === 1 && (first.type === 'circle' || (first.type === 'poly' && (first.points ?? []).length >= 8 && Math.abs(w - h) < 0.05) || (first.r ?? 0) * 2 * k >= Math.min(w, h) * 0.95);
      tools.set(o.tool, { w: w || 0.5, h: h || w || 0.5, round });
    } else if (o.type === 'pad') {
      const t = tools.get(o.tool) ?? { w: 0.5, h: 0.5, round: false };
      pads.push({ x: o.x * k, y: o.y * k, w: t.w, h: t.h, round: t.round });
    }
  }
  const strokes = objects.filter((o) => o.type === 'stroke').reduce((n, o) => n + (o.path?.length ?? 1), 0);
  return { pads, box: size?.box?.map((v) => v * k) ?? null, strokes };
}

/**
 * The pad pattern of one footprint, measured so the app can tell what the part is: how the pads
 * are laid out (a pair, a row, two rows, four sides, a grid), the pitch between neighbours, a large
 * centre pad, and how many pads have a drill hit (through-hole pins). Pads come back relative to the
 * footprint centre, so the board view can draw the real copper.
 */
export function padFeatures(pads, cx, cy, holes = []) {
  const n = pads.length;
  const rel = pads.map((p) => ({ x: r2(p.x - cx), y: r2(p.y - cy), w: r2(p.w), h: r2(p.h), ...(p.round ? { round: true } : {}) }));
  const areas = rel.map((p) => p.w * p.h).sort((a, b) => a - b);
  const median = areas[Math.floor(n / 2)] ?? 0;
  const half = Math.max(0, ...rel.map((q) => Math.max(Math.abs(q.x), Math.abs(q.y))));
  // A big pad in the middle is the exposed thermal pad of a QFN or a power package.
  const ep = n >= 5 && rel.some((p) => p.w * p.h > median * 4 && Math.abs(p.x) < half * 0.3 && Math.abs(p.y) < half * 0.3);
  // Anchors are the large pads that hold a connector or shield down; the signal pins are the rest.
  const signal = rel.filter((p) => !(n >= 4 && p.w * p.h > median * 3));
  const near = signal.map((p, i) => Math.min(...signal.filter((_, j) => j !== i).map((q) => Math.hypot(q.x - p.x, q.y - p.y))));
  const pitch = signal.length > 1 ? r2([...near].sort((a, b) => a - b)[Math.floor(near.length / 2)]) : 0;
  const distinct = (vals) => { const out = []; for (const v of [...vals].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > 0.2) out.push(v); return out; };
  const xs = distinct(signal.map((p) => p.x));
  const ys = distinct(signal.map((p) => p.y));
  const [x0, x1, y0, y1] = [Math.min(...signal.map((p) => p.x)), Math.max(...signal.map((p) => p.x)), Math.min(...signal.map((p) => p.y)), Math.max(...signal.map((p) => p.y))];
  const on = (v, edge) => Math.abs(v - edge) < 0.25;
  const sides = {
    left: signal.filter((p) => on(p.x, x0)).length, right: signal.filter((p) => on(p.x, x1)).length,
    bottom: signal.filter((p) => on(p.y, y0)).length, top: signal.filter((p) => on(p.y, y1)).length,
  };
  const perimeter = signal.filter((p) => on(p.x, x0) || on(p.x, x1) || on(p.y, y0) || on(p.y, y1)).length;
  let layout = 'mixed';
  if (n === 1) layout = 'single';
  else if (signal.length === 2) layout = 'pair';
  else if (xs.length === 1 || ys.length === 1) layout = 'row';
  else if (xs.length >= 3 && ys.length >= 3 && signal.length >= xs.length * ys.length * 0.6 && perimeter < signal.length * 0.8) layout = 'grid';
  else if (xs.length === 2 && sides.left + sides.right === signal.length && sides.left >= 2) layout = 'dual-v';
  else if (ys.length === 2 && sides.top + sides.bottom === signal.length && sides.top >= 2) layout = 'dual-h';
  else if (sides.left >= 2 && sides.right >= 2 && sides.top >= 2 && sides.bottom >= 2 && perimeter >= signal.length * 0.9) layout = 'quad';
  // Through-hole: a drill hit inside the pad.
  const th = pads.filter((p) => holes.some((h) => Math.abs(h.x - p.x) < p.w / 2 && Math.abs(h.y - p.y) < p.h / 2)).length;
  return { pads: rel.slice(0, 160), layout, pitch, ep, th, anchors: n - signal.length };
}

/** Groups pads that sit close together: each group is taken as one component footprint. */
function cluster(pads, gap) {
  const parent = pads.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // A grid keeps this near-linear for boards with thousands of pads.
  const cell = Math.max(gap * 2, 2.7);
  const grid = new Map();
  pads.forEach((p, i) => {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), i]);
  });
  pads.forEach((p, i) => {
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (j <= i) continue;
          const q = pads[j];
          const sx = Math.abs(p.x - q.x) - (p.w + q.w) / 2;
          const sy = Math.abs(p.y - q.y) - (p.h + q.h) / 2;
          // Through-hole pins on a 2.54 mm grid (headers, DIP rows) are one part even with a wider gap.
          const pins = p.pin && q.pin && Math.hypot(p.x - q.x, p.y - q.y) <= 2.6;
          if (Math.max(sx, sy) <= gap || pins) parent[find(i)] = find(j);
        }
      }
    }
  });
  const groups = new Map();
  pads.forEach((p, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), p]); });
  return [...groups.values()];
}

async function parseGerbers(files, fileName) {
  const identify = require('whats-that-gerber');
  const pcbStackup = require('pcb-stackup');
  const texts = files
    .filter((f) => !/\.(csv|txt|md|pos|json|ya?ml|kicad_\w+)$/i.test(f.name))
    .map((f) => ({ name: f.name, text: f.data.toString('utf8') }))
    .filter((f) => /^(G04|%|M48|;|T\d|G\d)/m.test(f.text.slice(0, 4000)));
  if (!texts.length) throw new Error('No Gerber or drill files were found in that upload.');
  const types = identify(texts.map((f) => f.name));
  const known = texts.filter((f) => types[f.name]?.type);
  if (!known.some((f) => types[f.name].type === 'copper')) throw new Error('No copper layer was recognised. Use standard layer file names (for example F_Cu, GTL, .gbr).');
  const notes = [];

  const stackup = await pcbStackup(known.map((f) => ({ filename: f.name, gerber: f.text })), { useOutline: true });
  const mm = stackup.top.units === 'in' ? 25.4 : 1;
  let width = stackup.top.width * mm;
  let height = stackup.top.height * mm;
  let ox = (stackup.top.viewBox[0] / 1000) * mm;
  let oy = (stackup.top.viewBox[1] / 1000) * mm;

  const outline = known.find((f) => types[f.name].type === 'outline');
  if (outline) {
    const { box } = padsOf(await plot(outline.text));
    // The box includes the width of the drawn line; the board edge is its centre.
    const pen = (await plot(outline.text)).find((o) => o.type === 'stroke')?.width ?? 0;
    const penMm = pen * (stackup.top.units === 'in' ? 25.4 : 1);
    if (box && box.every(Number.isFinite)) { ox = box[0] + penMm / 2; oy = box[1] + penMm / 2; width = box[2] - box[0] - penMm; height = box[3] - box[1] - penMm; }
  } else notes.push('No outline layer was found, so the board size is taken from the extent of the copper.');

  // Drill hits first: a pad with a hole in it is a through-hole pin.
  const drills = [];
  for (const f of known.filter((x) => types[x.name].type === 'drill')) {
    try { drills.push(...padsOf(await plot(f.text, { filetype: 'drill' })).pads); } catch { notes.push(`The drill file ${f.name} could not be read.`); }
  }

  const pins = drills.filter((d) => d.w >= 0.65 && d.w < 2);
  const painted = [];
  const components = [];
  for (const side of ['top', 'bottom']) {
    const cu = known.find((f) => types[f.name].type === 'copper' && types[f.name].side === side);
    if (!cu) continue;
    const { pads, strokes } = padsOf(await plot(cu.text));
    // Old exports paint pads with lines instead of flashing them; those parts cannot be found from this layer.
    if (strokes > 40 * Math.max(1, pads.length) && pads.length < 300) painted.push(side);
    const inPad = (d, p) => Math.abs(d.x - p.x) < Math.max(p.w, 0.3) / 2 && Math.abs(d.y - p.y) < Math.max(p.h, 0.3) / 2;
    // Vias (small drills) are not parts. A component pin has a real drill in it.
    let real = pads.filter((p) => p.w < 12 && p.h < 12 && !(Math.max(p.w, p.h) <= 1.6 && drills.some((d) => d.w < 0.65 && inPad(d, p))));
    for (const p of real) p.pin = drills.some((d) => d.w >= 0.65 && d.w < 2 && inPad(d, p));
    if (side === 'top') {
      // Some exports draw pin pads as filled areas, not flashes: the drill file still has every pin.
      for (const d of pins) if (!real.some((p) => inPad(d, p))) real.push({ x: d.x, y: d.y, w: d.w + 0.7, h: d.w + 0.7, round: true, pin: true });
    } else {
      // Through-hole parts sit on the top; their pins show on the bottom copper too.
      real = real.filter((p) => !p.pin);
    }
    const boxes = cluster(real, 0.9).map((group) => ({
      n: group.length, pads: group, drilled: group.every((p) => p.pin),
      x0: Math.min(...group.map((p) => p.x - p.w / 2)), x1: Math.max(...group.map((p) => p.x + p.w / 2)),
      y0: Math.min(...group.map((p) => p.y - p.h / 2)), y1: Math.max(...group.map((p) => p.y + p.h / 2)),
    }));
    // A chip has two facing rows of pins. Two rows of the same count and length, lined up and
    // close together, are one footprint.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b || a.n !== b.n || a.n === 2) continue;
        // Single drilled holes are not two halves of a chip resistor.
        if (a.n === 1 && (a.drilled || b.drilled)) continue;
        const [aw, ah, bw, bh] = [a.x1 - a.x0, a.y1 - a.y0, b.x1 - b.x0, b.y1 - b.y0];
        const horiz = aw >= ah;
        const len = horiz ? aw : ah;
        const sameLen = Math.abs(len - (horiz ? bw : bh)) < 0.4 && Math.abs((horiz ? ah : aw) - (horiz ? bh : bw)) < 0.4;
        const lined = Math.abs((horiz ? a.x0 : a.y0) - (horiz ? b.x0 : b.y0)) < 0.4;
        const apart = horiz ? Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) : Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
        // Single pads pair up into a two-terminal part (a capacitor, a resistor) when they face each other closely.
        const reach = a.n === 1 ? Math.max(len * 1.5, 2.5) : Math.max(len * 1.6, 7);
        if (sameLen && lined && apart > 0 && apart <= reach) {
          boxes[i] = { n: a.n + b.n, pads: [...a.pads, ...b.pads], drilled: a.drilled && b.drilled, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) };
          boxes[j] = null;
        }
      }
    }
    // A barrel jack or a big terminal: each pin is a large drilled pad, a few mm apart. One part.
    const bigPin = (g) => g && g.drilled && g.pads.some((p) => Math.max(p.w, p.h) >= 3);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!bigPin(a) || !bigPin(b)) continue;
        const gap = Math.max(Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
        if (gap > 4) continue;
        boxes[i] = { n: a.n + b.n, pads: [...a.pads, ...b.pads], drilled: true, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) };
        boxes[j] = null;
        j = i;
      }
    }
    for (const g of boxes.filter(Boolean)) {
      const [cx, cy] = [(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2];
      const f = padFeatures(g.pads, cx, cy, drills);
      components.push({ ref: '', value: '', footprint: '', side, pads: g.n, x: r2(cx - ox), y: r2(cy - oy), w: r2(g.x1 - g.x0), h: r2(g.y1 - g.y0), padList: f.pads, layout: f.layout, pitch: f.pitch, ep: f.ep, th: f.th, anchors: f.anchors });
    }
  }
  // Copper on both sides in the same place is one through-hole part (boards without a drill file
  // show it this way). It is kept once, on the top.
  const tops = components.filter((c) => c.side === 'top');
  for (let i = components.length - 1; i >= 0; i--) {
    const c = components[i];
    if (c.side !== 'bottom') continue;
    const twin = tops.find((t) => t.pads === c.pads && Math.abs(t.x - c.x) < 0.3 && Math.abs(t.y - c.y) < 0.3);
    if (twin) { twin.th = Math.max(twin.th, twin.pads); components.splice(i, 1); }
  }
  components.sort((a, b) => b.w * b.h - a.w * a.h);
  components.forEach((c, i) => { c.ref = `P${i + 1}`; });

  const holes = drills.map((p) => ({ x: r2(p.x - ox), y: r2(p.y - oy), d: r2(Math.max(p.w, p.h)) }));

  // A placement file, when the upload has one, names the parts the copper cannot.
  const pos = files.find((f) => /(placement|pos|cpl|pick).*\.csv$|\.pos$/i.test(f.name));
  let named = 0;
  if (pos) {
    const rows = pos.data.toString('utf8').split(/\r?\n/).map((l) => l.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim()));
    const head = rows[0]?.map((h) => h.toLowerCase()) ?? [];
    const col = (re) => head.findIndex((h) => re.test(h));
    const [ci, vi, xi, yi] = [col(/^(ref|designator)/), col(/^(part|val|comment)/), col(/^(x|mid x|posx)/), col(/^(y|mid y|posy)/)];
    if (ci >= 0 && xi >= 0 && yi >= 0) {
      for (const row of rows.slice(1)) {
        const x = parseFloat(row[xi]);
        const y = parseFloat(row[yi]);
        if (!row[ci] || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        const near = components.filter((c) => !c.named).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
        if (near && Math.hypot(near.x - x, near.y - y) < Math.max(near.w, near.h) / 2 + 1.5) { near.ref = row[ci]; near.value = vi >= 0 ? row[vi] : ''; near.named = true; named++; }
      }
    }
  }
  components.forEach((c) => delete c.named);
  notes.push(named
    ? `${named} parts were named from the placement file.`
    : 'Gerber files do not name the parts. Footprints were found by grouping pads, and are numbered P1, P2 and so on by size.');

  if (painted.length) notes.push(`The ${painted.join(' and ')} copper draws most pads with lines instead of flashing them (an older export), so surface-mount parts there could not be found. Through-hole parts were found from the drill file. A fresh Gerber export or the .kicad_pcb file gives every part.`);
  const copper = known.filter((f) => types[f.name].type === 'copper').length;
  return {
    kind: 'gerber', name: fileName,
    board: { width: r2(width), height: r2(height), thickness: 1.6 },
    holes, components, nets: 0, layers: copper,
    files: known.map((f) => ({ name: f.name, type: types[f.name].type, side: types[f.name].side })),
    svgTop: stackup.top.svg, svgBottom: stackup.bottom.svg,
    exact: false, notes,
  };
}

/** A plain drawing of a KiCad board for the preview: outline, holes and footprints with their references. */
function sketch(b) {
  const pad = 2;
  const W = b.board.width + pad * 2;
  const H = b.board.height + pad * 2;
  const y = (v) => pad + b.board.height - v;
  const esc = (s) => String(s).replace(/[<>&"]/g, '');
  const parts = b.components.filter((c) => c.side === 'top').map((c) => {
    const big = Math.min(c.w, c.h) > 2.2 && c.w > c.ref.length * 0.75;
    return `<rect x="${pad + c.x - c.w / 2}" y="${y(c.y) - c.h / 2}" width="${c.w}" height="${c.h}" rx="0.2" fill="#1b1f23" stroke="#e9e6dc" stroke-width="0.12"/>`
      + (big ? `<text x="${pad + c.x}" y="${y(c.y) + 0.45}" font-size="${Math.min(1.6, c.h * 0.4)}" text-anchor="middle" fill="#e9e6dc" font-family="monospace">${esc(c.ref)}</text>` : '');
  }).join('');
  const holes = b.holes.map((h) => `<circle cx="${pad + h.x}" cy="${y(h.y)}" r="${h.d / 2}" fill="#101214" stroke="#d8b25a" stroke-width="0.4"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm"><rect x="${pad}" y="${pad}" width="${b.board.width}" height="${b.board.height}" rx="0.8" fill="#1f5a41"/>${holes}${parts}</svg>`;
}

export async function importBoard(uploads) {
  let files = [];
  for (const u of uploads.slice(0, MAX_FILES)) {
    if (/\.zip$/i.test(u.name) || u.data.readUInt32LE?.(0) === 0x04034b50) files.push(...unzip(u.data));
    else files.push({ name: String(u.name).split(/[\\/]/).pop(), data: u.data });
  }
  files = files.filter((f) => f.data.length <= MAX_BYTES).slice(0, MAX_FILES);
  const label = uploads.length === 1 ? uploads[0].name : `${uploads.length} files`;
  const kicad = files.find((f) => /\.kicad_pcb$/i.test(f.name));
  let board;
  if (kicad) {
    board = parseKicad(kicad.data.toString('utf8'), kicad.name);
    board.svgTop = sketch(board);
  } else {
    if (files.some((f) => /\.(kicad_sch|kicad_pro|sch|brd)$/i.test(f.name)) && !files.some((f) => /\.(gbr|gtl|gbl|drl|ger)$/i.test(f.name))) {
      throw new Error('Only the board file (.kicad_pcb) and Gerber files can be read. Add the .kicad_pcb file from the same project.');
    }
    board = await parseGerbers(files, label);
  }
  if (!(board.board.width > 1 && board.board.height > 1)) throw new Error('The board outline could not be measured.');
  // Mounting holes: unplated-size holes away from any footprint.
  board.mounting = board.holes.filter((h) => h.d >= 2 && !board.components.some((c) => Math.abs(c.x - h.x) < c.w / 2 && Math.abs(c.y - h.y) < c.h / 2));
  board.components = board.components.slice(0, 400);
  board.holes = board.holes.slice(0, 400);
  return board;
}

/** The facts handed to Claude: the board is fixed, the housing is to be designed round it. */
export function boardBrief(b) {
  const big = [...b.components].sort((x, y) => y.w * y.h - x.w * x.h).slice(0, 90);
  const edge = (c) => {
    const near = [];
    if (c.x - c.w / 2 < 1.5) near.push('left edge');
    if (b.board.width - (c.x + c.w / 2) < 1.5) near.push('right edge');
    if (c.y - c.h / 2 < 1.5) near.push('bottom edge');
    if (b.board.height - (c.y + c.h / 2) < 1.5) near.push('top edge');
    return near.length ? `, at the ${near.join(' and ')}` : '';
  };
  return [
    `Board file: ${b.name} (${b.kind === 'kicad' ? 'KiCad board, exact data' : 'Gerber set; parts found by grouping pads, unnamed'}).`,
    `Board outline: ${b.board.width} x ${b.board.height} mm, ${b.board.thickness} mm thick, ${b.layers || 'unknown'} copper layers${b.nets ? `, ${b.nets} nets` : ''}.`,
    `Coordinates below are in mm from the lower-left board corner, top view, X right, Y up.`,
    b.mounting.length
      ? `Mounting holes: ${b.mounting.map((h) => `(${h.x}, ${h.y}) diameter ${h.d}`).join('; ')}.`
      : 'Mounting holes: none found. Hold the board with ribs, a slot or clips.',
    `Components (${b.components.length} in total, largest ${big.length} listed) as: reference | value | footprint | side | centre x, y | size w x h | pads`,
    ...big.map((c) => `${c.ref} | ${c.value || '?'} | ${c.footprint || (c.guess ? `${c.guess} (guessed from the pads)` : '?')} | ${c.side} | ${c.x}, ${c.y} | ${c.w} x ${c.h} | ${c.pads}${edge(c)}`),
  ].join('\n');
}
