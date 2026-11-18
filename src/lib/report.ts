import { jsPDF } from 'jspdf';

import { archLayout, BH, BW } from './archLayout';
import { controls, downstream } from './behaviour';
import { boards, type BoardModel } from './board';
import { fitReport, mouldNotes } from './fit';
import { connPower, connValues, fmtW, partPower } from './power';
import { routeBoard } from './route';
import { snapshot } from './snapshot';
import { CATEGORY_LABEL, CATEGORY_ORDER, CONFIDENCE_LABEL, type ConnectionKind, type Part, type Teardown } from './types';
import { tally, validate, type CheckStatus } from './validate';

// The product report: a PDF with pictures of the product, the diagrams and flows that say
// how it works, the board, the housing, the bill of materials and what is still open.
// Everything is drawn from the design data in the browser, so it costs no tokens.

type RGB = [number, number, number];
const INK: RGB = [33, 37, 43];
const INK2: RGB = [82, 88, 96];
const INK3: RGB = [118, 123, 130];
const RULE: RGB = [214, 211, 203];
const PANEL: RGB = [252, 251, 248];
const KIND: Record<ConnectionKind, RGB> = {
  power: [196, 66, 28], ground: [58, 63, 69], signal: [42, 95, 176], rf: [18, 130, 122], mechanical: [143, 138, 127],
};
const STATUS: Record<CheckStatus, { label: string; fill: RGB; ink: RGB }> = {
  pass: { label: 'Pass', fill: [226, 241, 232], ink: [36, 110, 72] },
  warn: { label: 'Check', fill: [252, 240, 205], ink: [120, 82, 0] },
  fail: { label: 'Fail', fill: [250, 225, 220], ink: [168, 40, 24] },
  info: { label: 'Note', fill: [236, 236, 233], ink: INK2 },
};
const FIT: Record<string, { color: string; label: string }> = {
  inside: { color: '#3f8f62', label: 'Fits' },
  tight: { color: '#e07a52', label: 'Tight, under 0.5 mm' },
  cutout: { color: '#2f7de1', label: 'Reaches the wall: needs a cut-out' },
  wall: { color: '#c4421c', label: 'Crosses the wall or sits outside' },
  clash: { color: '#9b4dca', label: 'Overlaps another part' },
};

/** The built-in PDF fonts only cover Latin-1. Replace what they cannot draw. */
const SWAP: Record<string, string> = {
  '→': '->', '←': '<-', '↔': '<->', '≈': '~', '≤': '<=', '≥': '>=', 'Ω': ' ohm', 'Δ': 'd', '−': '-', '‑': '-',
  '✓': 'ok', '✗': 'x', '⌀': 'dia. ', '·': ' · ', ' ': ' ', ' ': ' ', ' ': ' ',
};
const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfText(s: unknown): string {
  return [...String(s ?? '')].map((ch) => (ch in SWAP ? SWAP[ch] : ch.charCodeAt(0) <= 255 || WIN.has(ch) ? ch : '?')).join('').replace(/ · /g, ' · ');
}

const hex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : INK3;
};
const usd = (n: number) => `$${n.toFixed(2)}`;

class Report {
  doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  W = 210;
  H = 297;
  M = 16;
  y = 16;
  constructor(private title: string) {}

  get inner() { return this.W - this.M * 2; }
  font(size: number, style: 'normal' | 'bold' = 'normal', color: RGB = INK) {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }
  fill(c: RGB) { this.doc.setFillColor(...c); }
  stroke(c: RGB, w = 0.25) { this.doc.setDrawColor(...c); this.doc.setLineWidth(w); }

  page(section: string) {
    if (this.doc.getNumberOfPages() > 1 || this.y > this.M) this.doc.addPage();
    this.y = this.M + 9;
    this.font(8, 'normal', INK3);
    this.doc.text(pdfText(section.toUpperCase()), this.M, this.M + 2);
    this.stroke(RULE);
    this.doc.line(this.M, this.M + 4, this.W - this.M, this.M + 4);
  }
  /** Room for h mm, or a new page with the same section label. */
  room(h: number, section: string) { if (this.y + h > this.H - this.M - 8) this.page(section); }

  h1(s: string) { this.font(20, 'bold'); const lines = this.doc.splitTextToSize(pdfText(s), this.inner); this.doc.text(lines, this.M, this.y + 6); this.y += 6 + lines.length * 8; }
  // A heading never sits alone at the foot of a page: it needs room for some of what follows.
  h2(s: string, section: string) { this.room(34, section); this.font(13, 'bold'); this.doc.text(pdfText(s), this.M, this.y + 5); this.y += 9; }
  para(s: string, size = 9.5, color: RGB = INK2, width = this.inner, x = this.M) {
    this.font(size, 'normal', color);
    const lines: string[] = this.doc.splitTextToSize(pdfText(s), width);
    const lh = size * 0.42;
    this.doc.text(lines, x, this.y + lh);
    this.y += lines.length * lh + 2.5;
  }
  bullets(items: string[], section: string, color: RGB = INK2, numbered = false) {
    for (const [n, it] of items.entries()) {
      this.font(9.5, 'normal', color);
      const lines: string[] = this.doc.splitTextToSize(pdfText(it), this.inner - 5);
      this.room(lines.length * 4 + 2, section);
      if (numbered) { this.font(9.5, 'bold', INK3); this.doc.text(`${n + 1}.`, this.M, this.y + 4); }
      else { this.fill(INK3); this.doc.circle(this.M + 1.2, this.y + 2.6, 0.6, 'F'); }
      this.font(9.5, 'normal', color);
      this.doc.text(lines, this.M + 5, this.y + 4);
      this.y += lines.length * 4 + 1.6;
    }
    this.y += 1.5;
  }
  /** A row of label/value pairs. */
  facts(items: [string, string][], cols = 4) {
    const w = this.inner / cols;
    items.forEach(([k, v], i) => {
      const x = this.M + (i % cols) * w;
      const y = this.y + Math.floor(i / cols) * 13;
      this.font(7.5, 'normal', INK3);
      this.doc.text(pdfText(k), x, y + 3);
      this.font(11, 'bold', INK);
      this.doc.text(this.doc.splitTextToSize(pdfText(v), w - 3)[0] ?? '', x, y + 9);
    });
    this.y += Math.ceil(items.length / cols) * 13 + 3;
  }
  image(url: string | null, h: number, caption?: string) {
    if (!url) { this.para('3D picture not available in this browser.', 9, INK3); return; }
    // The picture is 16:10. It is drawn at its own size, centred, with nothing behind it.
    const w = Math.min(this.inner, h * 1.6);
    this.doc.addImage(url, 'JPEG', this.M + (this.inner - w) / 2, this.y, w, w / 1.6, undefined, 'FAST');
    h = w / 1.6;
    this.y += h + 2;
    if (caption) this.para(caption, 8, INK3);
  }
  pill(text: string, x: number, y: number, fill: RGB, ink: RGB): number {
    this.font(7.5, 'bold', ink);
    const w = this.doc.getTextWidth(pdfText(text)) + 4;
    this.fill(fill);
    this.doc.roundedRect(x, y - 3.2, w, 4.6, 2.2, 2.2, 'F');
    this.doc.text(pdfText(text), x + 2, y);
    return w;
  }
  /** A table that carries on over pages, repeating its header. */
  table(cols: { title: string; w: number; align?: 'right' }[], rows: string[][], section: string, size = 8.5) {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const k = this.inner / total;
    const ws = cols.map((c) => c.w * k);
    const header = () => {
      this.font(7.5, 'bold', INK3);
      let x = this.M;
      cols.forEach((c, i) => { this.doc.text(pdfText(c.title), c.align === 'right' ? x + ws[i] - 1 : x + 1, this.y + 3.5, { align: c.align === 'right' ? 'right' : 'left' }); x += ws[i]; });
      this.y += 5;
      this.stroke(INK3, 0.3);
      this.doc.line(this.M, this.y, this.M + this.inner, this.y);
      this.y += 0.5;
    };
    this.room(14, section);
    header();
    const lh = size * 0.4;
    for (const row of rows) {
      const cells = row.map((v, i) => { this.font(size, i === 0 ? 'bold' : 'normal'); return this.doc.splitTextToSize(pdfText(v), ws[i] - 2.5) as string[]; });
      const h = Math.max(...cells.map((c) => c.length)) * lh + 2.4;
      if (this.y + h > this.H - this.M - 8) { this.page(section); header(); }
      let x = this.M;
      cells.forEach((lines, i) => {
        this.font(size, i === 0 ? 'bold' : 'normal', i === 0 ? INK : INK2);
        const right = cols[i].align === 'right';
        this.doc.text(lines, right ? x + ws[i] - 1 : x + 1, this.y + lh + 0.6, { align: right ? 'right' : 'left' });
        x += ws[i];
      });
      this.y += h;
      this.stroke(RULE, 0.2);
      this.doc.line(this.M, this.y, this.M + this.inner, this.y);
    }
    this.y += 4;
  }
  /** A box with an arrow head, used by every flow diagram. */
  box(x: number, y: number, w: number, h: number, title: string, sub = '', opt: { fill?: RGB; border?: RGB; titleSize?: number } = {}) {
    this.fill(opt.fill ?? PANEL);
    this.stroke(opt.border ?? [190, 186, 176], 0.3);
    this.doc.roundedRect(x, y, w, h, 1.4, 1.4, 'FD');
    const ts = opt.titleSize ?? Math.max(5.5, Math.min(8.5, h * 0.9));
    this.font(ts, 'bold', INK);
    const t = this.doc.splitTextToSize(pdfText(title), w - 3) as string[];
    this.doc.text(t.slice(0, sub ? 1 : 2), x + 1.6, y + ts * 0.42 + 1.3);
    if (sub) {
      const ss = Math.max(5, ts - 1.5);
      this.font(ss, 'normal', INK3);
      // As many lines as the box has room for below the title.
      const room = Math.max(1, Math.floor((h - (ts * 0.42 + 2.3)) / (ss * 0.4)) - 0);
      const lines = (this.doc.splitTextToSize(pdfText(sub), w - 3) as string[]);
      const shown = lines.slice(0, Math.min(2, room));
      if (lines.length > shown.length) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/\s+\S*$/, '')}…`;
      this.doc.text(shown, x + 1.6, y + ts * 0.42 + 1.3 + ss * 0.42 + 0.9);
    }
  }
  arrow(x1: number, y1: number, x2: number, y2: number, c: RGB = INK3, w = 0.35) {
    this.stroke(c, w);
    this.doc.line(x1, y1, x2, y2);
    const a = Math.atan2(y2 - y1, x2 - x1);
    const s = 1.6;
    this.fill(c);
    this.doc.triangle(x2, y2, x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45), x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45), 'F');
  }
  curve(x1: number, y1: number, x2: number, y2: number, c: RGB, w: number, vertical = false) {
    this.stroke(c, w);
    const dx = x2 - x1;
    const dy = y2 - y1;
    // A cubic that leaves and arrives level (or upright), like the on-screen diagrams.
    const seg = vertical ? [0, dy / 2, dx, dy / 2, dx, dy] : [dx / 2, 0, dx / 2, dy, dx, dy];
    this.doc.lines([seg], x1, y1, [1, 1], 'S', false);
  }
  footers(stamp: string) {
    const n = this.doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      this.font(7.5, 'normal', INK3);
      this.doc.text(pdfText(this.title), this.M, this.H - 8);
      this.doc.text(pdfText(`${stamp} · page ${i} of ${n}`), this.W - this.M, this.H - 8, { align: 'right' });
    }
  }
}

// -------------------------------------------------------------------------------- diagrams

/** The system block diagram: sources, each board with its blocks, loads. */
function blockDiagram(r: Report, td: Teardown, maxH: number) {
  const L = archLayout(td);
  if (!L.edges.length) { r.para('No connections are recorded, so there is no block diagram.', 9, INK3); return; }
  const k = Math.min(r.inner / L.width, maxH / L.height);
  const ox = r.M + (r.inner - L.width * k) / 2;
  const oy = r.y;
  const X = (v: number) => ox + v * k;
  const Y = (v: number) => oy + v * k;
  const pos = new Map(L.blocks.map((b) => [b.id, b]));
  for (const f of L.frames) {
    r.fill([238, 236, 230]);
    r.stroke([200, 196, 186], 0.25);
    r.doc.setLineDashPattern([1.2, 0.8], 0);
    r.doc.roundedRect(X(f.x), Y(f.y), f.w * k, f.h * k, 1.8, 1.8, 'FD');
    r.doc.setLineDashPattern([], 0);
    r.font(Math.max(5.5, 12 * k), 'bold', INK2);
    r.doc.text(pdfText(f.label).slice(0, 48), X(f.x + 12), Y(f.y + 18));
  }
  const frame = new Map(L.frames.map((f) => [f.id, f]));
  const anchor = (id: string) => {
    const b = pos.get(id);
    if (b) return { x: b.x + BW / 2, y: b.y + BH / 2, hw: BW / 2 };
    const f = frame.get(id);
    return f ? { x: f.x + f.w / 2, y: f.y + 12, hw: f.w / 2 } : null;
  };
  for (const e of L.edges) {
    const a = anchor(e.from);
    const b = anchor(e.to);
    if (!a || !b) continue;
    const dir = b.x >= a.x ? 1 : -1;
    const same = Math.abs(a.x - b.x) < 4;
    const x1 = a.x + (same ? a.hw : dir * a.hw);
    const x2 = b.x + (same ? b.hw : -dir * b.hw);
    r.curve(X(x1), Y(a.y), X(x2), Y(b.y), KIND[e.kind], e.kind === 'power' ? 0.45 : 0.3);
    r.fill(KIND[e.kind]);
    r.doc.circle(X(x2), Y(b.y), 0.55, 'F');
  }
  for (const b of L.blocks) {
    const p = L.byId.get(b.id)!;
    r.box(X(b.x), Y(b.y), BW * k, BH * k, `${p.refDes ? `${p.refDes} ` : ''}${p.name}`, p.package ?? CATEGORY_LABEL[p.category], { titleSize: Math.max(5, Math.min(8, 13 * k)) });
  }
  r.y += L.height * k + 3;
  // Legend.
  let x = r.M;
  for (const kind of ['power', 'ground', 'signal', 'rf'] as ConnectionKind[]) {
    if (!L.edges.some((e) => e.kind === kind)) continue;
    r.stroke(KIND[kind], 0.8);
    r.doc.line(x, r.y + 1.5, x + 6, r.y + 1.5);
    r.font(8, 'normal', INK2);
    const label = { power: 'Power', ground: 'Ground', signal: 'Signal', rf: 'Radio', mechanical: '' }[kind];
    r.doc.text(label, x + 8, r.y + 2.6);
    x += 12 + r.doc.getTextWidth(label) + 6;
  }
  r.y += 8;
}

/**
 * Power from the input down to each load, as an indented tree: one row per part, each joined
 * to what feeds it by a line as thick as the power on that path. Works at any depth and carries
 * on over pages.
 */
function powerFlow(r: Report, td: Teardown, section: string) {
  const edges = td.connections.filter((c) => c.kind === 'power');
  if (!edges.length) { r.para('No power connections are recorded.', 9, INK3); return; }
  const byId = new Map(td.parts.map((p) => [p.id, p]));
  const pw = partPower(td);
  const out = new Map<string, typeof edges>();
  const into = new Map<string, typeof edges>();
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    into.set(e.to, [...(into.get(e.to) ?? []), e]);
  }
  const ids = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const order = td.parts.map((p) => p.id);
  const sources = ids.filter((id) => !into.has(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const maxW = Math.max(0.001, ...edges.map((e) => connPower(e) ?? 0));
  const name = (id: string) => { const p = byId.get(id); return p ? `${p.refDes ? `${p.refDes} ` : ''}${p.name}` : id; };
  const BOXW = 72;
  const ROWH = 11;
  const STEP = 7;
  const seen = new Set<string>();
  const rows: { id: string; depth: number; via: (typeof edges)[number] | null }[] = [];
  const walk = (id: string, depth: number, via: (typeof edges)[number] | null) => {
    if (seen.has(id) || depth > 14) return;
    seen.add(id);
    rows.push({ id, depth, via });
    const kids = [...(out.get(id) ?? [])].sort((a, b) => (connPower(b) ?? 0) - (connPower(a) ?? 0));
    for (const e of kids) walk(e.to, depth + 1, e);
  };
  for (const s of sources.length ? sources : [ids[0]]) walk(s, 0, null);
  for (const id of ids) if (!seen.has(id)) walk(id, 0, null);

  const placed = new Map<string, { page: number; x: number; y: number }>();
  for (const row of rows) {
    r.room(ROWH + 1, section);
    const page = r.doc.getNumberOfPages();
    const x = r.M + row.depth * STEP;
    const y = r.y;
    const v = pw.get(row.id);
    const sub = !v?.hasIn ? `Source, supplies ${fmtW(v?.outW ?? 0)}` : v.hasOut ? `In ${fmtW(v.inW)}, passes on ${fmtW(v.outW)}` : `Load, uses ${fmtW(v.inW)}`;
    // The line from the part that feeds this one.
    const parent = row.via ? placed.get(row.via.from) : undefined;
    if (row.via && parent) {
      const w = 0.3 + ((connPower(row.via) ?? 0) / maxW) * 1.5;
      const top = parent.page === page ? parent.y + ROWH - 1 : r.M + 6;
      r.stroke(KIND.power, w);
      r.doc.line(parent.x + 3, top, parent.x + 3, y + ROWH / 2 - 0.5);
      r.doc.line(parent.x + 3, y + ROWH / 2 - 0.5, x, y + ROWH / 2 - 0.5);
    }
    r.box(x, y, BOXW, ROWH - 2, name(row.id), sub, {
      titleSize: 7.5,
      fill: !v?.hasIn ? [253, 243, 214] : v.hasOut ? PANEL : [240, 238, 232],
      border: !v?.hasIn ? [220, 170, 40] : [190, 186, 176],
    });
    // What arrives on the path, beside the box.
    const others = (into.get(row.id) ?? []).filter((e) => e !== row.via).map((e) => name(e.from));
    const label = row.via ? `${row.via.label}${connValues(row.via) ? `: ${connValues(row.via)}` : ''}` : 'Input';
    r.font(7.5, 'bold', KIND.power);
    const tx = x + BOXW + 3;
    r.doc.text(pdfText(label), tx, y + 3.4, { maxWidth: r.W - r.M - tx });
    if (others.length) {
      r.font(7, 'normal', INK3);
      r.doc.text(pdfText(`also fed from ${others.join(', ')}`), tx, y + 6.6, { maxWidth: r.W - r.M - tx });
    }
    placed.set(row.id, { page, x, y });
    r.y += ROWH;
  }
  r.y += 3;
}

/** For each control: what is pressed, which parts carry it, and what responds. */
function controlFlow(r: Report, td: Teardown, section: string) {
  const list = controls(td);
  if (!list.length) { r.para('This product has no buttons, switches or knobs recorded.', 9, INK3); return; }
  const byId = new Map(td.parts.map((p) => [p.id, p]));
  const name = (id: string) => { const p = byId.get(id); return p ? `${p.refDes ? `${p.refDes} ` : ''}${p.name}` : id; };
  const seen = new Set<string>();
  for (const c of list) {
    const key = `${c.label}|${c.partId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hops = downstream(td, c.partId).path.slice(0, 2).map((e) => name(e.to)).filter((h) => !c.affects.map(name).includes(h));
    const outs = c.affects.slice(0, 3).map(name);
    const steps = [`Press: ${c.label}`, ...hops, outs.length ? outs.join(', ') : 'Controller'];
    r.room(26, section);
    const w = Math.min(46, (r.inner - (steps.length - 1) * 7) / steps.length);
    steps.forEach((s, i) => {
      const x = r.M + i * (w + 7);
      const first = i === 0;
      const last = i === steps.length - 1;
      r.box(x, r.y, w, 11, s, first ? CATEGORY_LABEL[byId.get(c.partId)?.category ?? 'other'] : last ? 'responds' : 'carries the signal', {
        fill: first ? [253, 243, 214] : last ? [226, 241, 232] : PANEL,
        border: first ? [220, 170, 40] : last ? [120, 180, 140] : [190, 186, 176],
        titleSize: 7,
      });
      if (!last) r.arrow(x + w + 0.6, r.y + 5.5, x + w + 6.4, r.y + 5.5);
    });
    r.y += 13;
    r.para(c.action, 8.5, INK2);
    r.y += 1.5;
  }
}

/** A practical order to put the product together, from the parts and the wiring. */
function assemblySteps(td: Teardown): { title: string; detail: string }[] {
  const housing = td.parts.filter((p) => p.category === 'enclosure').sort((a, b) => a.position[2] - b.position[2]);
  const base = housing.slice(0, Math.max(1, Math.ceil(housing.length / 2)));
  const top = housing.slice(base.length);
  const pcbs = td.parts.filter((p) => p.category === 'pcb');
  const onBoard = (p: Part) => pcbs.some((b) => b.id === p.parentId);
  const big = td.parts.filter((p) => ['battery', 'electromech', 'display', 'sensor', 'antenna', 'thermal'].includes(p.category) && !onBoard(p));
  const wires = td.connections.filter((c) => /wire|harness|cable|lead|flex|twisted/i.test(`${c.medium ?? ''} ${c.wire ?? ''}`));
  const screws = td.parts.filter((p) => p.category === 'fastener');
  const names = (ps: Part[], n = 6) => ps.slice(0, n).map((p) => `${p.refDes ? `${p.refDes} ` : ''}${p.name}`).join(', ') + (ps.length > n ? ` and ${ps.length - n} more` : '');
  const steps: { title: string; detail: string }[] = [];
  if (pcbs.length) steps.push({ title: 'Build the boards', detail: `Fit the parts to ${names(pcbs)}: ${td.parts.filter(onBoard).length} part lines, smallest first, then reflow or hand-solder.` });
  if (base.length) steps.push({ title: 'Prepare the base of the housing', detail: names(base) });
  if (pcbs.length) steps.push({ title: 'Mount the boards', detail: `Place ${names(pcbs)} on their bosses or ribs.` });
  if (big.length) steps.push({ title: 'Fit the main components', detail: names(big) });
  if (wires.length) steps.push({ title: 'Connect the wiring', detail: wires.slice(0, 6).map((w) => w.label).join(', ') + (wires.length > 6 ? ` and ${wires.length - 6} more` : '') });
  if (top.length) steps.push({ title: 'Close the housing', detail: names(top) });
  if (screws.length) steps.push({ title: 'Fasten', detail: screws.map((s) => `${s.qty} × ${s.name}`).join(', ') });
  steps.push({ title: 'Test', detail: td.verifySteps[0] ?? 'Power it on and check each control and output.' });
  return steps;
}

function assemblyFlow(r: Report, td: Teardown, section: string) {
  const steps = assemblySteps(td);
  steps.forEach((s, i) => {
    r.font(8.5, 'normal', INK2);
    const lines = (r.doc.splitTextToSize(pdfText(s.detail), r.inner - 22) as string[]).slice(0, 3);
    const h = 8 + lines.length * 3.6;
    r.room(h + 6, section);
    r.fill(INK);
    r.doc.circle(r.M + 4, r.y + 4.5, 3.6, 'F');
    r.font(9, 'bold', [255, 255, 255]);
    r.doc.text(String(i + 1), r.M + 4, r.y + 5.7, { align: 'center' });
    r.fill(PANEL);
    r.stroke(RULE, 0.3);
    r.doc.roundedRect(r.M + 11, r.y, r.inner - 11, h, 1.4, 1.4, 'FD');
    r.font(9.5, 'bold', INK);
    r.doc.text(pdfText(s.title), r.M + 14, r.y + 5);
    r.font(8.5, 'normal', INK2);
    r.doc.text(lines, r.M + 14, r.y + 9);
    if (i < steps.length - 1) r.arrow(r.M + 4, r.y + 8.6, r.M + 4, r.y + h + 3.2);
    r.y += h + 4;
  });
}

/** The bare board: outline, holes, pads, copper and each part with its reference. */
function boardDrawing(r: Report, b: BoardModel, maxH: number) {
  const k = Math.min(r.inner / b.width, maxH / b.height);
  const ox = r.M + (r.inner - b.width * k) / 2;
  const oy = r.y;
  const X = (v: number) => ox + v * k;
  const Y = (v: number) => oy + (b.height - v) * k;
  const mask = hex(b.part.color);
  r.fill(mask.map((c) => Math.round(c * 0.75)) as RGB);
  r.stroke(INK, 0.3);
  r.doc.roundedRect(ox, oy, b.width * k, b.height * k, 1, 1, 'FD');
  const routing = routeBoard(b);
  for (const t of routing.traces.filter((tr) => tr.layer === 'bottom')) {
    r.stroke(mask.map((c) => Math.round(c * 0.55)) as RGB, Math.max(0.15, t.width * k));
    r.doc.lines(t.points.slice(1).map((p, i) => [(p[0] - t.points[i][0]) * k, -(p[1] - t.points[i][1]) * k]), X(t.points[0][0]), Y(t.points[0][1]), [1, 1], 'S');
  }
  for (const t of routing.traces.filter((tr) => tr.layer === 'top')) {
    r.stroke([226, 192, 99], Math.max(0.2, t.width * k));
    r.doc.lines(t.points.slice(1).map((p, i) => [(p[0] - t.points[i][0]) * k, -(p[1] - t.points[i][1]) * k]), X(t.points[0][0]), Y(t.points[0][1]), [1, 1], 'S');
  }
  r.fill([216, 178, 90]);
  for (const f of b.footprints.filter((fp) => fp.side === 'top')) {
    for (const p of f.pads) r.doc.rect(X(f.x + p.x - p.w / 2), Y(f.y + p.y + p.h / 2), p.w * k, p.h * k, 'F');
  }
  for (const v of routing.vias) { r.fill([216, 178, 90]); r.doc.circle(X(v.x), Y(v.y), (v.pad / 2) * k, 'F'); }
  for (const h of b.holes) { r.fill([20, 22, 26]); r.doc.circle(X(h.x), Y(h.y), (h.d / 2) * k, 'F'); }
  r.stroke([240, 238, 230], 0.2);
  for (const f of b.footprints.filter((fp) => fp.side === 'top')) {
    if (f.round) r.doc.circle(X(f.x), Y(f.y), (f.w / 2) * k, 'S');
    else r.doc.rect(X(f.x - f.w / 2), Y(f.y + f.h / 2), f.w * k, f.h * k, 'S');
    const size = Math.max(4, Math.min(7, Math.min(f.w, f.h) * k * 1.6));
    r.font(size, 'bold', [240, 238, 230]);
    r.doc.text(pdfText(f.ref).slice(0, 12), X(f.x), Y(f.y) + size * 0.15, { align: 'center' });
  }
  r.y += b.height * k + 4;
  return routing;
}

function costChart(r: Report, td: Teardown) {
  const rows = CATEGORY_ORDER.map((cat) => {
    const parts = td.parts.filter((p) => p.category === cat);
    return { label: CATEGORY_LABEL[cat], usd: parts.reduce((s, p) => s + (p.estCostUsd ?? 0) * p.qty, 0) };
  }).filter((x) => x.usd > 0).sort((a, b) => b.usd - a.usd);
  if (!rows.length) return;
  const max = rows[0].usd;
  const labelW = 46;
  for (const row of rows) {
    r.font(8.5, 'normal', INK2);
    r.doc.text(pdfText(row.label), r.M, r.y + 3.5);
    const w = Math.max(0.8, ((r.inner - labelW - 22) * row.usd) / max);
    r.fill(INK2);
    r.doc.rect(r.M + labelW, r.y + 0.8, w, 3.4, 'F');
    r.font(8.5, 'bold', INK);
    r.doc.text(usd(row.usd), r.M + labelW + w + 2, r.y + 3.5);
    r.y += 5.6;
  }
  r.y += 3;
}

// -------------------------------------------------------------------------------- the report

export async function buildReport(td: Teardown): Promise<Uint8Array> {
  const r = new Report(td.product.name);
  const pause = () => new Promise((res) => setTimeout(res, 0));
  const checks = validate(td);
  const score = tally(checks);
  const cost = td.parts.reduce((s, p) => s + (p.estCostUsd ?? 0) * p.qty, 0);
  const pieces = td.parts.reduce((s, p) => s + p.qty, 0);
  const brds = boards(td);
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // ---- 1 cover
  r.font(8, 'bold', INK3);
  r.doc.text(pdfText(`PRODUCT REPORT · ${td.product.category}`.toUpperCase()), r.M, r.y);
  r.y += 3;
  r.h1(td.product.name);
  r.para(td.product.summary, 10.5, INK2);
  r.y += 1;
  await pause();
  r.image(snapshot(td, { explode: 0 }), 104, 'The product as designed, assembled.');
  r.facts([
    ['Size', `${td.product.dimensionsMm.map((v) => Math.round(v)).join(' × ')} mm`],
    ['Power in', td.product.powerInput ?? 'Not stated'],
    ['Parts', `${td.parts.length} lines, ${pieces} pieces`],
    ['Material cost', cost ? `about ${usd(cost)}` : 'Not priced'],
    ['Connections', String(td.connections.length)],
    ['Circuit boards', String(brds.length)],
    ['Checks passed', `${score.pass} of ${score.scored}`],
    ['Made', `${date}`],
  ]);
  r.font(9, 'bold', INK);
  r.doc.text('In this report', r.M, r.y + 3);
  r.y += 5;
  const contents = [
    'Inside the product: exploded view and what every part does',
    'How it works: system block diagram, power flow, where the power goes',
    'Using and building it: control flow for each button, assembly order',
    ...(brds.some((b) => b.footprints.length) ? ['Circuit boards: layout with copper traces and part placement'] : []),
    ...(td.parts.some((p) => p.category === 'enclosure') ? ['Housing: fit in 3D, how each part is moulded or cut, fixings'] : []),
    ...(td.firmware ? ['Firmware: pin map, build, flash and bench tests'] : []),
    'Bill of materials: cost by group and every part',
    'Checks, safety, open questions and how to confirm them',
  ];
  r.font(8.5, 'normal', INK2);
  contents.forEach((c, i) => { r.doc.text(pdfText(`${i + 1}.  ${c}`), r.M, r.y + 3.5); r.y += 4.6; });
  r.y += 2;
  r.font(7.5, 'normal', INK3);
  r.doc.text(r.doc.splitTextToSize(pdfText(`Made by Teardown Lab from ${td.meta.source === 'sample' ? 'the built-in sample' : td.meta.source === 'board' ? 'the uploaded board file' : `a design by ${td.meta.model ?? 'Claude'}`}. Sizes, part numbers and electrical values are engineering estimates until measured; each part is marked observed, inferred or assumed.`), r.inner), r.M, r.y + 2);

  // ---- 2 exploded and what is inside
  r.page('Inside the product');
  r.h2('Exploded view', 'Inside the product');
  await pause();
  r.image(snapshot(td, { explode: 1 }), 100, 'Every part pulled apart along the direction it is assembled.');
  r.h2('What is inside', 'Inside the product');
  const sorted = [...td.parts].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  r.table(
    [{ title: 'Part', w: 30 }, { title: 'Group', w: 18 }, { title: 'What it does', w: 52 }, { title: 'Basis', w: 12 }],
    sorted.map((p) => [`${p.refDes ? `${p.refDes} ` : ''}${p.name}${p.qty > 1 ? ` (×${p.qty})` : ''}`, CATEGORY_LABEL[p.category], p.function, CONFIDENCE_LABEL[p.confidence]]),
    'Inside the product',
  );

  // ---- 3 how it works
  r.page('How it works');
  r.h2('System block diagram', 'How it works');
  r.para('Each circuit board as a frame with the blocks on it. What feeds the product is on the left, what it drives on the right. Lines are coloured by the kind of connection.', 9);
  blockDiagram(r, td, 150);
  r.page('How it works');
  r.h2('Power flow', 'How it works');
  r.para('Power from each source down to every load. Each part is joined to what feeds it; the thicker the line, the more power on that path. Sources are shaded yellow, end loads grey.', 9);
  powerFlow(r, td, 'How it works');
  const pw = partPower(td);
  const loads = [...pw.entries()].filter(([, v]) => v.hasIn).map(([id, v]) => ({ p: td.parts.find((x) => x.id === id), ...v })).filter((x) => x.p).sort((a, b) => b.usedW - a.usedW);
  if (loads.length) {
    r.h2('Where the power goes', 'How it works');
    r.table(
      [{ title: 'Part', w: 40 }, { title: 'Receives', w: 16, align: 'right' }, { title: 'Passes on', w: 16, align: 'right' }, { title: 'Uses', w: 16, align: 'right' }],
      loads.map((l) => [`${l.p!.refDes ? `${l.p!.refDes} ` : ''}${l.p!.name}`, fmtW(l.inW) ?? '', l.hasOut ? fmtW(l.outW) ?? '' : '–', l.p!.category === 'battery' ? 'stores' : fmtW(l.usedW) ?? '']),
      'How it works',
    );
  }

  // ---- 4 how it is used, how it is built
  r.page('Using and building it');
  r.h2('Control flow: what each control does', 'Using and building it');
  r.para('Each row follows one press from the control, through the parts that carry it, to the parts that respond.', 9);
  controlFlow(r, td, 'Using and building it');
  r.h2('Assembly flow', 'Using and building it');
  r.para('A practical order to put it together, worked out from the parts and the wiring.', 9);
  assemblyFlow(r, td, 'Using and building it');

  // ---- 5 boards
  for (const b of brds.slice(0, 4)) {
    if (!b.footprints.length) continue;
    const label = `Circuit board ${b.part.refDes ?? ''}`.trim();
    r.page(label);
    r.h2(`${b.part.refDes ? `${b.part.refDes} ` : ''}${b.part.name}`, label);
    await pause();
    const routing = boardDrawing(r, b, 95);
    r.facts([
      ['Outline', `${b.width} × ${b.height} mm`],
      ['Thickness', `${b.thickness} mm`],
      ['Placements', String(b.footprints.length)],
      ['Copper', `${routing.routed} of ${routing.routed + routing.failed.length} nets routed`],
    ]);
    r.para(`Top side. Gold lines are autorouted copper traces on the top layer (${routing.length} mm in all, ${routing.vias.length} vias); darker lines show the bottom layer. This is a first-pass route, not checked for current or noise.`, 8.5, INK3);
    r.table(
      [{ title: 'Ref', w: 12 }, { title: 'Part', w: 50 }, { title: 'Side', w: 10 }, { title: 'X, Y mm', w: 18, align: 'right' }, { title: 'Size mm', w: 18, align: 'right' }],
      b.footprints.map((f) => [f.ref, f.name, f.side, `${f.x.toFixed(1)}, ${f.y.toFixed(1)}`, `${f.w.toFixed(1)} × ${f.h.toFixed(1)}`]),
      label,
    );
  }

  // ---- 6 housing
  const fit = fitReport(td);
  if (fit.hasHousing) {
    r.page('Housing, fit and mould');
    r.h2('Fit inside the housing', 'Housing, fit and mould');
    const colors = new Map<string, string>();
    const PASS = ['connector', 'display', 'electromech', 'sensor', 'antenna'];
    const used = new Set<string>();
    for (const row of fit.rows) {
      const k = row.status === 'inside' ? 'inside' : row.status === 'tight' ? 'tight' : row.status === 'through-wall' && PASS.includes(row.part.category) ? 'cutout' : 'wall';
      colors.set(row.part.id, FIT[k].color);
      used.add(k);
    }
    for (const c of fit.clashes) { colors.set(c.a.id, FIT.clash.color); colors.set(c.b.id, FIT.clash.color); used.add('clash'); }
    await pause();
    r.image(snapshot(td, { xray: true, colors }), 92);
    let x = r.M;
    for (const k of Object.keys(FIT).filter((key) => used.has(key))) {
      r.fill(hex(FIT[k].color));
      r.doc.rect(x, r.y, 3, 3, 'F');
      r.font(8, 'normal', INK2);
      r.doc.text(pdfText(FIT[k].label), x + 4.5, r.y + 2.6);
      x += 9 + r.doc.getTextWidth(pdfText(FIT[k].label));
      if (x > r.W - r.M - 40) { x = r.M; r.y += 5; }
    }
    r.y += 7;
    r.facts([
      ['Housing envelope', `${fit.envelope.map((v) => v.toFixed(0)).join(' × ')} mm`],
      ['Thinnest wall', fit.wall ? `${fit.wall} mm` : '–'],
      ['Need attention', String(fit.rows.filter((row) => row.status !== 'inside').length)],
      ['Part clashes', String(fit.clashes.length)],
    ]);
    const moulds = mouldNotes(td);
    r.h2('How each housing part is made', 'Housing, fit and mould');
    r.table(
      [{ title: 'Part', w: 30 }, { title: 'Material', w: 22 }, { title: 'Wall', w: 9, align: 'right' }, { title: 'Tool opens', w: 15 }, { title: 'Draft', w: 9, align: 'right' }, { title: 'Mass', w: 10, align: 'right' }, { title: 'Clamp', w: 10, align: 'right' }],
      moulds.map((m) => [m.part.name, m.moulded ? m.resin : m.part.material ?? 'Sheet', `${m.wall.toFixed(1)} mm`, m.moulded ? `${m.pullSign}${m.pullAxis.toUpperCase()}, ${m.depth.toFixed(0)} mm` : 'Cut or formed', m.moulded ? `${m.draftDeg}°` : '–', m.moulded ? `${m.massG.toFixed(0)} g` : '–', m.moulded ? `${Math.max(1, Math.round(m.clampTonnes))} t` : '–']),
      'Housing, fit and mould',
    );
    const notes = moulds.flatMap((m) => m.notes.filter((n) => !/^No problems|^Not a moulded part/.test(n)).map((n) => `${m.part.name}: ${n}`));
    if (notes.length) { r.h2('Mould and fixing notes', 'Housing, fit and mould'); r.bullets(notes.slice(0, 18), 'Housing, fit and mould'); }
    const issues = fit.rows.filter((row) => row.status !== 'inside');
    if (issues.length) { r.h2('Fit items to look at', 'Housing, fit and mould'); r.bullets(issues.slice(0, 14).map((row) => `${row.part.name}: ${row.note}`), 'Housing, fit and mould'); }
  }

  // ---- firmware, when it has been written
  const fw = td.firmware;
  if (fw) {
    r.page('Firmware');
    r.h2('Firmware', 'Firmware');
    r.para(fw.summary, 9.5);
    r.facts([
      ['Controller', fw.controller],
      ['Framework', fw.framework],
      ['Board', fw.env.board],
      ['Code', `${fw.files.length} files, ${fw.files.reduce((n, f) => n + f.content.split('\n').length, 0)} lines`],
    ]);
    r.h2('Pin map', 'Firmware');
    r.table(
      [{ title: 'Pin', w: 12 }, { title: 'Signal', w: 24 }, { title: 'Direction', w: 13 }, { title: 'Connects to', w: 30 }, { title: 'Note', w: 30 }],
      fw.pins.map((p) => [p.pin, p.signal, p.direction, p.connectsTo, p.note ?? '']),
      'Firmware',
    );
    r.h2('Build and flash', 'Firmware');
    r.bullets(fw.build, 'Firmware', INK2, true);
    r.h2('Test on the bench', 'Firmware');
    r.bullets(fw.test, 'Firmware', INK2, true);
    if (fw.assumptions.length) { r.h2('Assumptions', 'Firmware'); r.bullets(fw.assumptions, 'Firmware'); }
    r.para(`The source files (${fw.files.map((f) => f.path).join(', ')}) are in the firmware folder of the full download. Written from the design; not compiled or run on hardware by Teardown Lab.`, 8.5, INK3);
  }

  // ---- 7 bill of materials
  r.page('Bill of materials');
  r.h2('Cost by group', 'Bill of materials');
  costChart(r, td);
  r.h2('Every part', 'Bill of materials');
  r.table(
    [{ title: 'Ref', w: 13 }, { title: 'Part', w: 34 }, { title: 'Package or material', w: 25 }, { title: 'Likely part numbers', w: 26 }, { title: 'Qty', w: 7, align: 'right' }, { title: 'Unit', w: 10, align: 'right' }],
    sorted.map((p) => [p.refDes ?? '', p.name, p.package ?? p.material ?? '', (p.candidates ?? []).join(', '), String(p.qty), p.estCostUsd != null ? usd(p.estCostUsd) : '']),
    'Bill of materials',
  );
  r.font(10, 'bold');
  r.room(8, 'Bill of materials');
  r.doc.text(pdfText(`Estimated material cost: ${usd(cost)} for one unit`), r.M, r.y + 2);
  r.y += 6;
  r.para('Rough volume prices for comparison, not quotes. Part numbers are candidates until a marking is read.', 8.5, INK3);

  // ---- 8 checks and open questions
  r.page('Checks and open questions');
  r.h2(`Checks: ${score.pass} of ${score.scored} pass`, 'Checks and open questions');
  for (const c of checks) {
    r.font(9, 'normal', INK2);
    const lines = (r.doc.splitTextToSize(pdfText(c.detail), r.inner - 20) as string[]);
    r.room(lines.length * 3.8 + 8, 'Checks and open questions');
    const s = STATUS[c.status];
    r.pill(s.label, r.M, r.y + 3.6, s.fill, s.ink);
    r.font(9.5, 'bold');
    r.doc.text(pdfText(c.title), r.M + 18, r.y + 3.6);
    r.font(9, 'normal', INK2);
    r.doc.text(lines, r.M + 18, r.y + 7.6);
    r.y += 6 + lines.length * 3.8 + 2;
  }
  if (td.safety.length) { r.h2('Safety', 'Checks and open questions'); r.bullets(td.safety, 'Checks and open questions', [150, 50, 30]); }
  if (td.unknowns.length) { r.h2('Still unknown', 'Checks and open questions'); r.bullets(td.unknowns, 'Checks and open questions'); }
  if (td.verifySteps.length) { r.h2('How to confirm it', 'Checks and open questions'); r.bullets(td.verifySteps, 'Checks and open questions', INK2, true); }

  r.footers(`Teardown Lab · ${date}`);
  return new Uint8Array(r.doc.output('arraybuffer'));
}
