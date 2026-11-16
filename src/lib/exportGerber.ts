import type { BoardModel, Footprint } from './board';
import { slug } from './geometry';
import { routeBoard } from './route';

// Gerber (RS-274X) and Excellon output for a reconstructed board. Millimetres,
// origin at the lower-left corner of the board, seen from the top side.
//
// What is in the set: the board outline, pads, solder mask and paste openings,
// component outlines on silkscreen, drill hits and a placement file. What is
// not: copper routing. A teardown does not contain the traces, so these files
// are a starting point for a redesign, not a board you can order as it is.

const fmt = (mm: number) => String(Math.round(mm * 1e6));
const xy = (x: number, y: number) => `X${fmt(x)}Y${fmt(y)}`;

class Layer {
  private apertures = new Map<string, number>();
  private body: string[] = [];
  private current = 0;
  constructor(private fileFunction: string, private polarity = 'Positive') {}

  private use(def: string) {
    let code = this.apertures.get(def);
    if (!code) this.apertures.set(def, (code = 10 + this.apertures.size));
    if (code !== this.current) { this.body.push(`D${code}*`); this.current = code; }
  }
  rect(x: number, y: number, w: number, h: number) {
    this.use(`R,${w.toFixed(4)}X${h.toFixed(4)}`);
    this.body.push(`${xy(x, y)}D03*`);
  }
  disc(x: number, y: number, d: number) {
    this.use(`C,${d.toFixed(4)}`);
    this.body.push(`${xy(x, y)}D03*`);
  }
  line(points: [number, number][], width = 0.12) {
    this.use(`C,${width.toFixed(4)}`);
    points.forEach(([x, y], i) => this.body.push(`${xy(x, y)}${i === 0 ? 'D02' : 'D01'}*`));
  }
  circle(cx: number, cy: number, r: number, width = 0.12) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 32; i++) pts.push([cx + r * Math.cos((i / 32) * 2 * Math.PI), cy + r * Math.sin((i / 32) * 2 * Math.PI)]);
    this.line(pts, width);
  }
  toString() {
    return [
      '%TF.GenerationSoftware,TeardownLab,TeardownLab,0.1*%',
      `%TF.FileFunction,${this.fileFunction}*%`,
      `%TF.FilePolarity,${this.polarity}*%`,
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%LPD*%',
      'G01*',
      ...[...this.apertures].map(([def, code]) => `%ADD${code}${def}*%`),
      ...this.body,
      'M02*',
      '',
    ].join('\n');
  }
}

function outline(l: Layer, f: Footprint, grow = 0) {
  if (f.round) { l.circle(f.x, f.y, f.w / 2 + grow); return; }
  const hw = f.w / 2 + grow;
  const hh = f.h / 2 + grow;
  l.line([[f.x - hw, f.y - hh], [f.x + hw, f.y - hh], [f.x + hw, f.y + hh], [f.x - hw, f.y + hh], [f.x - hw, f.y - hh]]);
}

export interface GerberFile { name: string; text: string }

export function buildGerberSet(b: BoardModel, product: string): GerberFile[] {
  const base = slug(`${product}-${b.part.refDes ?? b.part.id}`);
  const W = b.width;
  const H = b.height;

  const edge = new Layer('Profile,NP');
  edge.line([[0, 0], [W, 0], [W, H], [0, H], [0, 0]], 0.1);

  const side = (name: 'top' | 'bottom') => {
    const top = name === 'top';
    const cu = new Layer(`Copper,L${top ? 1 : 2},${top ? 'Top' : 'Bot'}`);
    const mask = new Layer(`Soldermask,${top ? 'Top' : 'Bot'}`, 'Negative');
    const paste = new Layer(`Paste,${top ? 'Top' : 'Bot'}`);
    const silk = new Layer(`Legend,${top ? 'Top' : 'Bot'}`);
    for (const f of b.footprints) {
      if (f.side !== name) continue;
      outline(silk, f, 0.15);
      for (const p of f.pads) {
        cu.rect(f.x + p.x, f.y + p.y, p.w, p.h);
        mask.rect(f.x + p.x, f.y + p.y, p.w + 0.1, p.h + 0.1);
        if (!f.round) paste.rect(f.x + p.x, f.y + p.y, p.w, p.h);
      }
    }
    // Annular ring and mask opening round each mounting hole, on both sides.
    for (const h of b.holes) {
      cu.disc(h.x, h.y, h.d + 1.6);
      mask.disc(h.x, h.y, h.d + 1.8);
    }
    return { cu, mask, paste, silk };
  };
  const top = side('top');
  const bot = side('bottom');

  // Autorouted copper: traces on their layer, vias through both.
  const routing = routeBoard(b);
  for (const t of routing.traces) (t.layer === 'top' ? top : bot).cu.line(t.points, t.width);
  for (const v of routing.vias) { top.cu.disc(v.x, v.y, v.pad); bot.cu.disc(v.x, v.y, v.pad); }

  // Straight lines between connected parts: a guide for routing, not copper.
  const rats = new Layer('Other,Ratsnest');
  const centre = new Map<string, [number, number]>();
  b.footprints.forEach((f) => { if (!centre.has(f.partId)) centre.set(f.partId, [f.x, f.y]); });
  for (const n of b.nets) {
    const a = centre.get(n.from);
    const c = centre.get(n.to);
    if (a && c) rats.line([a, c], 0.08);
  }

  const drills = [...b.holes.map((h) => ({ x: h.x, y: h.y, d: h.d })), ...routing.vias.map((v) => ({ x: v.x, y: v.y, d: v.drill }))];
  const sizes = [...new Set(drills.map((h) => h.d.toFixed(2)))];
  const drill = [
    'M48', '; Teardown Lab drill file: mounting holes and vias', 'FMAT,2', 'METRIC,TZ',
    ...sizes.map((d, i) => `T${i + 1}C${d}`),
    '%', 'G90', 'G05',
    ...sizes.flatMap((d, i) => [
      `T${i + 1}`,
      ...drills.filter((h) => h.d.toFixed(2) === d).map((h) => `X${h.x.toFixed(3)}Y${h.y.toFixed(3)}`),
    ]),
    'T0', 'M30', '',
  ].join('\n');

  const cell = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const placement = [
    'Ref,Part,Side,X (mm),Y (mm),Width (mm),Height (mm)',
    ...b.footprints.map((f) => [f.ref, f.name, f.side, f.x.toFixed(2), f.y.toFixed(2), f.w.toFixed(2), f.h.toFixed(2)].map(cell).join(',')),
    '',
  ].join('\n');

  const readme = `Teardown Lab board reconstruction
${product} / ${b.part.refDes ?? ''} ${b.part.name}
Board ${W} x ${H} mm, ${b.thickness} mm thick. ${b.footprints.length} placements, ${b.holes.length} mounting holes.

FILES
  ${base}-Edge_Cuts.gbr     board outline
  ${base}-F_Cu.gbr          top copper         ${base}-B_Cu.gbr      bottom copper
  ${base}-F_Mask.gbr        top mask openings  ${base}-B_Mask.gbr    bottom mask openings
  ${base}-F_Paste.gbr       top stencil        ${base}-B_Paste.gbr   bottom stencil
  ${base}-F_SilkS.gbr       top part outlines  ${base}-B_SilkS.gbr   bottom part outlines
  ${base}-Ratsnest.gbr      straight lines between connected parts (guide only)
  ${base}.drl               Excellon drill hits (holes and vias)
  ${base}-placement.csv     pick-and-place positions

READ THIS BEFORE ORDERING
These files were generated from a description, photos or a design by the agent. The
outline and the part positions are estimates. The pads are typical for each part
class, not the real land patterns.
COPPER: ${routing.routed} of ${routing.routed + routing.failed.length} nets are routed by an autorouter (${routing.length} mm of trace, ${routing.vias.length} vias).
It is a first pass on two layers. For a photographed product it is NOT the original
routing. Nothing is checked for current capacity, impedance or noise.
Open the board in KiCad, replace each footprint with the real one, then review and
re-route before ordering.
Units are millimetres. Origin is the lower-left board corner, top view.
`;

  return [
    { name: `${base}-Edge_Cuts.gbr`, text: edge.toString() },
    { name: `${base}-F_Cu.gbr`, text: top.cu.toString() },
    { name: `${base}-B_Cu.gbr`, text: bot.cu.toString() },
    { name: `${base}-F_Mask.gbr`, text: top.mask.toString() },
    { name: `${base}-B_Mask.gbr`, text: bot.mask.toString() },
    { name: `${base}-F_Paste.gbr`, text: top.paste.toString() },
    { name: `${base}-B_Paste.gbr`, text: bot.paste.toString() },
    { name: `${base}-F_SilkS.gbr`, text: top.silk.toString() },
    { name: `${base}-B_SilkS.gbr`, text: bot.silk.toString() },
    { name: `${base}-Ratsnest.gbr`, text: rats.toString() },
    { name: `${base}.drl`, text: drill },
    { name: `${base}-placement.csv`, text: placement },
    { name: 'README.txt', text: readme },
  ];
}

// ---- a minimal ZIP writer (stored, no compression) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: GerberFile[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const dirSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
