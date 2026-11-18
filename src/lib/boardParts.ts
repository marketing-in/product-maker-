import type { ImportedBoard, ImportedPad } from './validate';
import type { Axis, Part, PartCategory, PartShape, Teardown, Vec3 } from './types';

// Turns an uploaded board (Gerber set or KiCad file) into a design: the board itself and a 3D part
// for every footprint on it. Gerber copper does not say what a part is, so each footprint is
// recognised from its pads: how many, how they are laid out, their pitch, whether they are drilled
// and whether they sit at the board edge. A KiCad file names its footprints, and that wins.
// Everything here runs in the browser and costs nothing.

type Comp = ImportedBoard['components'][number];

const C = {
  epoxy: '#1d1f22',
  tin: '#d3d6da',
  gold: '#d6ab45',
  metal: '#c3c7cd',
  resistor: '#24262a',
  ceramic: '#b48e66',
  inductor: '#3b3e42',
  can: '#2f4170',
  canTop: '#c9cdd2',
  white: '#ebe7dc',
  led: '#f1eee5',
  ledLens: '#e04a36',
  substrate: '#2c4a36',
  module: '#1d5a47',
  beige: '#d9c59b',
  generic: '#34373c',
} as const;

/** One solid, in the footprint frame: x along the footprint width, y along its height, z up from the board surface. */
interface Solid { shape: 'box' | 'cylinder'; size: Vec3; at: Vec3; axis?: Axis; color?: string }

export interface Guess {
  /** Package, for example "SOIC-8" or "0603". */
  pkg: string;
  /** What it most likely is, for people: "SOIC-8 chip". */
  what: string;
  category: PartCategory;
  color: string;
  solids: Solid[];
  /** How the guess was made: from the file's own name for it, or from the pad pattern. */
  how: 'named' | 'pattern' | 'size';
  evidence: string;
  /** Tiny two-pad parts of the same package are listed as one line with copies. */
  groupable?: boolean;
}

const box = (sx: number, sy: number, sz: number, x: number, y: number, z0: number, color?: string): Solid =>
  ({ shape: 'box', size: [sx, sy, sz], at: [x, y, z0 + sz / 2], color });
const cyl = (d: number, len: number, axis: Axis, x: number, y: number, zc: number, color?: string): Solid =>
  ({ shape: 'cylinder', size: axis === 'x' ? [len, d, d] : axis === 'y' ? [d, len, d] : [d, d, len], at: [x, y, zc], axis, color });

const near = (a: number, b: number, tol = 0.06) => Math.abs(a - b) <= tol;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The pads of a footprint, from the file when it has them, otherwise a plausible set from its size. */
function padsOf(c: Comp): ImportedPad[] {
  if (c.padList?.length) return c.padList;
  const pads: ImportedPad[] = [];
  const horiz = c.w >= c.h;
  if (c.pads <= 2) {
    const len = Math.max(c.w, c.h);
    const s = Math.min(c.w, c.h);
    for (const k of [-1, 1]) pads.push(horiz ? { x: k * len * 0.35, y: 0, w: len * 0.3, h: s } : { x: 0, y: k * len * 0.35, w: s, h: len * 0.3 });
  }
  return pads;
}

/** Feet for gull-wing and J-lead pins: from the body edge out to each pad that lies outside it. */
function legs(pads: ImportedPad[], hx: number, hy: number, z = 0.12): Solid[] {
  const out: Solid[] = [];
  for (const p of pads.slice(0, 160)) {
    if (Math.abs(p.x) > hx + 0.05) {
      const s = Math.sign(p.x);
      const end = p.x + s * p.w * 0.25;
      const len = Math.abs(end - s * hx);
      out.push(box(len, Math.max(0.15, Math.min(p.h * 0.6, 0.5)), z, s * hx + (s * len) / 2, p.y, 0, C.tin));
    } else if (Math.abs(p.y) > hy + 0.05) {
      const s = Math.sign(p.y);
      const end = p.y + s * p.h * 0.25;
      const len = Math.abs(end - s * hy);
      out.push(box(Math.max(0.15, Math.min(p.w * 0.6, 0.5)), len, z, p.x, s * hy + (s * len) / 2, 0, C.tin));
    }
  }
  return out;
}

/** Inner edge of the pads on each side of a two- or four-sided footprint: where the body ends. */
function innerHalf(pads: ImportedPad[], axis: 'x' | 'y'): number {
  const k = axis === 'x' ? 'x' : 'y';
  const wk = axis === 'x' ? 'w' : 'h';
  const max = Math.max(...pads.map((p) => Math.abs(p[k])));
  const side = pads.filter((p) => Math.abs(p[k]) > max - 0.3);
  return Math.min(...side.map((p) => Math.abs(p[k]) - p[wk] / 2));
}

const pin1 = (x: number, y: number, top: number): Solid => cyl(0.5, 0.04, 'z', x, y, top + 0.02, '#5a5e64');

/** Which board edge the footprint touches, if any (board coordinates, mm from the lower-left corner). */
function edgeOf(c: Comp, W: number, H: number): 'left' | 'right' | 'bottom' | 'top' | null {
  const d = { left: c.x - c.w / 2, right: W - (c.x + c.w / 2), bottom: c.y - c.h / 2, top: H - (c.y + c.h / 2) };
  const [side, dist] = Object.entries(d).sort((a, b) => a[1] - b[1])[0] as ['left' | 'right' | 'bottom' | 'top', number];
  return dist < 2.5 ? side : null;
}

/** A metal connector shell that sits against the board edge and overhangs it a little, as a USB socket does. */
function edgeShell(c: Comp, edge: 'left' | 'right' | 'bottom' | 'top', W: number, H: number, len: number, depth: number, tall: number): Solid[] {
  const over = 0.6;
  let cx = 0;
  let cy = 0;
  let sx = len;
  let sy = depth;
  if (edge === 'bottom') cy = -over + depth / 2 - c.y;
  if (edge === 'top') cy = H + over - depth / 2 - c.y;
  if (edge === 'left') { sx = depth; sy = len; cx = -over + depth / 2 - c.x; }
  if (edge === 'right') { sx = depth; sy = len; cx = W + over - depth / 2 - c.x; }
  const mouth = edge === 'bottom' ? [0, cy - depth / 2] : edge === 'top' ? [0, cy + depth / 2] : edge === 'left' ? [cx - depth / 2, 0] : [cx + depth / 2, 0];
  const across = edge === 'bottom' || edge === 'top';
  return [
    box(sx, sy, tall, cx, cy, 0, C.metal),
    box(across ? len - 0.9 : 0.25, across ? 0.25 : len - 0.9, tall - 0.7, mouth[0], mouth[1], 0.35, C.epoxy),
  ];
}

/** Recognise one footprint and build its body. Returns null for things that are not parts (a lone pad, a fiducial). */
export function guessPart(c: Comp, W: number, H: number): Guess | null {
  const pads = padsOf(c);
  const n = c.pads;
  const L = Math.max(c.w, c.h);
  const S = Math.min(c.w, c.h);
  const horiz = c.w >= c.h;
  const th = (c.th ?? 0) > 0;
  const layout = c.layout ?? (n === 2 ? 'pair' : 'mixed');
  const pitch = c.pitch ?? 0;
  const text = `${c.footprint} ${c.value}`.trim();
  const named = Boolean(c.footprint);
  const prefix = (c.footprint || c.value) ? c.ref.replace(/[^A-Za-z].*$/, '').replace(/\d.*$/, '').toUpperCase() : '';
  const say = (what: string) => (named ? `KiCad footprint ${c.footprint}.` : `Pad pattern in the copper: ${what}.`);
  const pattern = `${n} pads${pitch ? `, ${r1(pitch)} mm pitch` : ''}${th ? ', through-hole' : ''}, ${r1(c.w)} × ${r1(c.h)} mm`;
  const edge = edgeOf(c, W, H);
  const signalN = n - (c.anchors ?? 0);

  if (n === 1 && !named) return null;

  // ---------- two-terminal parts ----------
  const chip = (pkg: string, bl: number, bw: number, bh: number, kind: 'R' | 'C' | 'L' | 'D' | 'LED' | '?'): Guess => {
    const [sx, sy] = horiz ? [bl, bw] : [bw, bl];
    const body = kind === 'C' ? C.ceramic : kind === 'L' ? C.inductor : kind === 'LED' ? C.led : C.resistor;
    const cap = Math.min(bl * 0.2, 0.6);
    const ends = [-1, 1].map((k) => (horiz
      ? box(cap, bw * 1.02, bh * 1.02, k * (bl / 2 - cap / 2), 0, 0, C.tin)
      : box(bw * 1.02, cap, bh * 1.02, 0, k * (bl / 2 - cap / 2), 0, C.tin)));
    const solids = [box(horiz ? bl - cap * 2 : sx, horiz ? sy : bl - cap * 2, bh, 0, 0, 0, body), ...ends];
    if (kind === 'LED') solids.push(box(sx * 0.4, sy * 0.6, 0.08, 0, 0, bh, C.ledLens));
    if (kind === 'D') solids.push(horiz ? box(bl * 0.12, bw * 1.01, bh * 1.01, -bl * 0.28, 0, 0, '#9aa0a6') : box(bw * 1.01, bl * 0.12, bh * 1.01, 0, -bl * 0.28, 0, '#9aa0a6'));
    const role = { R: 'resistor', C: 'capacitor', L: 'inductor', D: 'diode', LED: 'LED', '?': 'resistor or capacitor' }[kind];
    return {
      pkg, what: `${pkg} ${role}`, category: kind === 'LED' ? 'display' : kind === 'D' ? 'ic' : 'passive',
      color: body, solids, how: named || prefix ? 'named' : 'size', evidence: say(pattern), groupable: kind !== 'D',
    };
  };
  const twoKind = (): 'R' | 'C' | 'L' | 'D' | 'LED' | '?' => {
    if (/LED/i.test(text) || prefix === 'LED') return 'LED';
    if (/^R_|resist/i.test(c.footprint) || prefix === 'R') return 'R';
    if (/^C_|capac/i.test(c.footprint) || prefix === 'C') return 'C';
    if (/^L_|induct/i.test(c.footprint) || prefix === 'L' || prefix === 'FB') return 'L';
    if (/^D_|diode|SOD|SMA|SMB/i.test(c.footprint) || prefix === 'D') return 'D';
    return '?';
  };

  if (/CP_Elec|CP_Radial|Elec/i.test(c.footprint) || (prefix === 'C' && th && L > 4)) {
    const d = Math.max(4, Math.min(12, L * (th ? 1.6 : 0.75)));
    const ht = Math.min(13, d * 1.25);
    return {
      pkg: `${r1(d)} mm can`, what: 'electrolytic capacitor', category: 'passive', color: C.can, how: 'named', evidence: say(pattern),
      solids: [cyl(d, ht, 'z', 0, 0, ht / 2 + 0.3, C.can), cyl(d * 0.92, 0.25, 'z', 0, 0, ht + 0.42, C.canTop)],
    };
  }

  if (layout === 'pair' || (n === 2 && !c.layout)) {
    if (th) {
      const s = L - Math.max(...pads.map((p) => Math.max(p.w, p.h)));
      const axis: Axis = horiz ? 'x' : 'y';
      if (s > 6) {
        const len = s * 0.55;
        const legsTh = pads.map((p) => box(0.5, 0.5, 2.6, p.x, p.y, 0, C.tin));
        return {
          pkg: `axial, ${r1(s)} mm`, what: 'axial resistor or diode', category: 'passive', color: C.beige, how: 'pattern', evidence: say(pattern),
          solids: [cyl(2.4, len, axis, 0, 0, 2.6, C.beige), ...legsTh],
        };
      }
      if (near(pitch || s, 2.54, 0.08)) {
        const along = horiz ? c.w : c.h;
        return {
          pkg: '1x2 header, 2.54 mm', what: '2-pin header, LED or small capacitor', category: 'connector', color: C.epoxy, how: 'pattern', evidence: say(pattern),
          solids: [horiz ? box(along, 2.5, 2.5, 0, 0, 0, C.epoxy) : box(2.5, along, 2.5, 0, 0, 0, C.epoxy), ...pads.map((q) => box(0.64, 0.64, 8.5, q.x, q.y, 0, C.gold))],
        };
      }
      const d = s <= 2.6 ? 5 : Math.min(10, s * 2);
      const ht = Math.min(12, d * 1.4);
      return {
        pkg: `radial, ${r1(s)} mm`, what: s <= 2.6 ? 'radial capacitor, LED or 2-pin header' : 'radial capacitor', category: 'passive', color: C.can, how: 'pattern', evidence: say(pattern),
        solids: [cyl(d, ht, 'z', 0, 0, ht / 2 + 0.4, C.can), cyl(d * 0.92, 0.25, 'z', 0, 0, ht + 0.52, C.canTop)],
      };
    }
    const k = twoKind();
    if (L >= 5 && S / L >= 0.6) {
      const side = S * 0.85;
      return {
        pkg: `${r1(side)} mm block`, what: 'power inductor', category: 'passive', color: C.inductor, how: 'size', evidence: say(pattern),
        solids: [box(side, side, Math.min(4.5, side * 0.5), 0, 0, 0, C.inductor)],
      };
    }
    if (L >= 3.4 && S / L >= 0.55) return chip(L < 5.5 ? 'SMA' : 'SMB', L * 0.72, S * 0.9, 2.1, k === '?' ? 'D' : k);
    const table: [number, string, number, number, number][] = [
      [0.95, '0201', 0.6, 0.3, 0.3], [1.75, '0402', 1.0, 0.5, 0.35], [2.6, '0603', 1.6, 0.8, 0.45],
      [3.4, '0805', 2.0, 1.25, 0.5], [4.8, '1206', 3.2, 1.6, 0.55], [6.0, '1210', 3.2, 2.5, 0.55], [99, '2512', 6.3, 3.2, 0.6],
    ];
    const [, pkg, bl, bw, bh] = table.find((t) => L < t[0])!;
    return chip(pkg, Math.min(bl, L * 0.8), Math.min(bw, S * 1.05), bh, k);
  }

  // ---------- connectors ----------
  // Big drilled pads at the edge: the pins of a DC barrel jack.
  if (th && edge && Math.max(...pads.map((q) => Math.max(q.w, q.h))) >= 3 && n <= 9) {
    const shell = edgeShell(c, edge, W, H, 9, 14, 11);
    shell[0].color = C.epoxy;
    return { pkg: 'DC jack', what: 'DC barrel jack', category: 'connector', color: C.epoxy, how: 'pattern', evidence: say(`${pattern}, at the ${edge} edge`), solids: shell };
  }
  const usb = /USB/i.test(text);
  if ((usb && /C|Type/i.test(text)) || (edge && signalN >= 10 && signalN <= 26 && near(pitch, 0.5, 0.08) && ((c.anchors ?? 0) >= 2 || th))) {
    return {
      pkg: 'USB-C', what: 'USB-C socket', category: 'connector', color: C.metal, how: usb ? 'named' : 'pattern',
      evidence: say(`${pattern}, at the ${edge ?? 'board'} edge`),
      solids: edgeShell(c, edge ?? 'bottom', W, H, 8.94, 7.35, 3.26),
    };
  }
  if ((usb && /micro/i.test(text)) || (edge && signalN === 5 && near(pitch, 0.65, 0.08))) {
    return {
      pkg: 'micro-USB', what: 'micro-USB socket', category: 'connector', color: C.metal, how: usb ? 'named' : 'pattern',
      evidence: say(`${pattern}, at the ${edge ?? 'board'} edge`),
      solids: edgeShell(c, edge ?? 'bottom', W, H, 7.5, 5.0, 2.6),
    };
  }

  const headerPitch = [2.54, 2.0, 1.27].find((p) => near(pitch, p, 0.05));
  const rowish = layout === 'row' || ((layout === 'dual-h' || layout === 'dual-v') && pads.length >= 4);
  if ((th && rowish && headerPitch && !/DIP/i.test(text)) || /PinHeader|PinSocket|Conn_\d/i.test(c.footprint)) {
    const rowsAcross = layout === 'row' ? 1 : 2;
    const spread = layout === 'row' ? 0 : layout === 'dual-h' ? Math.max(...pads.map((p) => p.y)) - Math.min(...pads.map((p) => p.y)) : Math.max(...pads.map((p) => p.x)) - Math.min(...pads.map((p) => p.x));
    // Two rows a DIP apart are a chip, not a header.
    if (rowsAcross === 1 || spread < 3.5) {
      const p = headerPitch ?? 2.54;
      const along = horiz ? c.w : c.h;
      const across = (rowsAcross === 1 ? 0 : spread) + p;
      const base = horiz ? box(along, across, 2.5, 0, 0, 0, C.epoxy) : box(across, along, 2.5, 0, 0, 0, C.epoxy);
      const pins = pads.slice(0, 80).map((q) => box(0.64, 0.64, 8.5, q.x, q.y, 0, C.gold));
      const cols = rowsAcross === 1 ? n : n / 2;
      return {
        pkg: `${rowsAcross}x${cols} header, ${p} mm`, what: `${rowsAcross}×${cols} pin header or socket`, category: 'connector', color: C.epoxy,
        how: named ? 'named' : 'pattern', evidence: say(pattern), solids: [base, ...pins],
      };
    }
  }

  const jstPitch = [1.0, 1.25, 1.5, 2.0, 2.5].find((p) => near(pitch, p, 0.04));
  if ((/JST|Molex|PicoBlade|Conn_/i.test(text)) || (jstPitch && ((c.anchors ?? 0) >= 2 || (th && layout === 'row' && pitch !== 2.54)) && signalN >= 2 && signalN <= 16 && layout !== 'quad')) {
    const p = jstPitch ?? pitch;
    const tall = p <= 1.25 ? 2.9 : p <= 1.5 ? 3.5 : p <= 2.0 ? 6 : 7;
    return {
      pkg: `${signalN}-pin, ${r1(p)} mm`, what: `${signalN}-pin wire-to-board connector (JST-style)`, category: 'connector', color: C.white,
      how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(c.w * 0.92, c.h * 0.92, tall, 0, 0, 0, C.white), box(horiz ? c.w * 0.7 : 0.2, horiz ? 0.2 : c.h * 0.7, tall * 0.6, 0, 0, tall * 0.25, C.epoxy)],
    };
  }
  if (/FPC|FFC/i.test(text) || (near(pitch, 0.5, 0.06) && (c.anchors ?? 0) >= 2 && signalN >= 6)) {
    return {
      pkg: `FPC ${signalN}-pin, 0.5 mm`, what: `${signalN}-pin flat-cable (FPC) connector`, category: 'connector', color: C.epoxy,
      how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(c.w * 0.9, c.h * 0.7, 1.6, 0, 0, 0, C.epoxy), box(horiz ? c.w * 0.86 : c.h * 0.15, horiz ? c.h * 0.15 : c.w * 0.86, 0.3, 0, 0, 1.6, '#5b3d27')],
    };
  }

  // ---------- switches and crystals (four pads at the corners) ----------
  if (/SW_|Button|Tactile/i.test(text) || prefix === 'SW' || (n === 4 && L >= 4.5 && L <= 9.6 && L / S < 1.6 && layout !== 'row')) {
    const side = Math.min(S * 0.95, 6.2);
    return {
      pkg: `${r1(side)} mm tactile`, what: 'push button (tactile switch)', category: 'electromech', color: C.epoxy, how: named || prefix ? 'named' : 'pattern', evidence: say(pattern),
      solids: [
        box(side, side, 3.1, 0, 0, 0, C.epoxy),
        box(side * 1.02, side * 1.02, 0.3, 0, 0, 3.1, C.metal),
        cyl(side * 0.55, 1.6, 'z', 0, 0, 3.4 + 0.8, '#2b2d31'),
        ...(th ? pads.map((q) => box(0.7, 0.3, 1.2, q.x, q.y, 0, C.tin)) : []),
      ],
    };
  }
  if (/Crystal|Oscillator|XTAL/i.test(text) || prefix === 'Y' || prefix === 'X' || (n === 4 && !th && L < 6.5 && layout !== 'row')) {
    return {
      pkg: `${r1(c.w)} × ${r1(c.h)} can`, what: n === 4 && !named ? 'crystal or oscillator (4-pad can)' : 'crystal or oscillator', category: 'passive', color: C.metal,
      how: named || prefix ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(c.w * 0.85, c.h * 0.85, 0.3, 0, 0, 0, '#b29b74'), box(c.w * 0.78, c.h * 0.78, 0.5, 0, 0, 0.3, C.metal)],
    };
  }

  // ---------- small transistors and regulators ----------
  if (n >= 3 && n <= 6 && !th && L <= 4.0 && layout !== 'row') {
    const pkg = /SOT-?23-?5|SOT-?25/i.test(text) || n === 5 ? 'SOT-23-5' : n === 6 ? 'SOT-23-6' : n === 4 ? 'SOT-143' : L < 2.6 ? 'SC-70' : 'SOT-23';
    const [bl, bw] = L < 2.6 ? [2.0, 1.25] : [2.9, 1.3];
    const [sx, sy] = layoutAxis(layout, horiz) ? [bl, bw] : [bw, bl];
    return {
      pkg, what: `${pkg} transistor, diode or regulator`, category: 'ic', color: C.epoxy, how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(sx, sy, 1.0, 0, 0, 0.1, C.epoxy), ...legs(pads, sx / 2, sy / 2), pin1(-sx / 2 + 0.4, -sy / 2 + 0.3, 1.1)],
    };
  }
  if (n >= 3 && n <= 5 && !th && (c.anchors ?? 0) >= 1 && L > 4.0 && L < 12) {
    const big = [...pads].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const small = pads.filter((p) => p !== big);
    const ax = Math.abs(big.x) > Math.abs(big.y) ? 'x' : 'y';
    const sm = small.reduce((s, p) => s + (ax === 'x' ? p.x : p.y), 0) / Math.max(1, small.length);
    const bg = ax === 'x' ? big.x : big.y;
    const mid = (sm + bg) / 2;
    const span = Math.abs(bg - sm) * 0.75;
    const across = (ax === 'x' ? big.h : big.w) * 0.95;
    const pkg = L > 8.5 ? 'DPAK' : 'SOT-223';
    const body = ax === 'x' ? box(span, across, pkg === 'DPAK' ? 2.3 : 1.6, mid, 0, 0.1, C.epoxy) : box(across, span, pkg === 'DPAK' ? 2.3 : 1.6, 0, mid, 0.1, C.epoxy);
    return {
      pkg, what: `${pkg} regulator or power transistor`, category: 'power', color: C.epoxy, how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [body, box(big.w * 0.9, big.h * 0.9, 0.25, big.x, big.y, 0, C.tin), ...legs(small, ax === 'x' ? 99 : across / 2, ax === 'x' ? across / 2 : 99)],
    };
  }
  if (n === 3 && th && layout === 'row') {
    const p1 = near(pitch, 1.27, 0.08);
    if (p1) {
      return {
        pkg: 'TO-92', what: 'TO-92 transistor or regulator', category: 'ic', color: C.epoxy, how: 'pattern', evidence: say(pattern),
        solids: [cyl(4.8, 4.5, 'z', 0, 0, 3 + 2.25, C.epoxy), ...pads.map((q) => box(0.45, 0.45, 3.2, q.x, q.y, 0, C.tin))],
      };
    }
  }

  // ---------- integrated circuits ----------
  const pinCount = n - (c.ep ? 1 : 0);
  if (layout === 'grid' || /BGA/i.test(text)) {
    return {
      pkg: `BGA-${pinCount}`, what: `BGA-${pinCount} chip`, category: 'ic', color: C.epoxy, how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(c.w + 0.8, c.h + 0.8, 0.35, 0, 0, 0.25, C.substrate), box(c.w + 0.4, c.h + 0.4, 0.6, 0, 0, 0.6, C.epoxy), pin1(-c.w / 2, -c.h / 2 + 0.2, 1.2)],
    };
  }
  if (layout === 'quad' || /QFN|DFN|QFP/i.test(text)) {
    const flat = c.ep || /QFN|DFN/i.test(text) || (!/QFP/i.test(text) && pitch <= 0.55 && L <= 7.5);
    if (flat) {
      const pkg = `QFN-${pinCount}`;
      return {
        pkg, what: `${pkg} chip`, category: 'ic', color: C.epoxy, how: named ? 'named' : 'pattern', evidence: say(pattern),
        solids: [box(c.w - 0.05, c.h - 0.05, 0.85, 0, 0, 0.02, C.epoxy), box(c.w + 0.02, c.h + 0.02, 0.2, 0, 0, 0, C.tin), pin1(-c.w / 2 + 0.6, -c.h / 2 + 0.6, 0.87)],
      };
    }
    const hx = innerHalf(pads.filter((p) => Math.abs(p.x) > Math.abs(p.y)), 'x') + 0.1;
    const hy = innerHalf(pads.filter((p) => Math.abs(p.y) >= Math.abs(p.x)), 'y') + 0.1;
    const pkg = `${pitch <= 0.55 ? 'LQFP' : 'QFP'}-${pinCount}`;
    return {
      pkg, what: `${pkg} chip`, category: 'ic', color: C.epoxy, how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(hx * 2, hy * 2, 1.4, 0, 0, 0.1, C.epoxy), ...legs(pads, hx, hy), pin1(-hx + 1, -hy + 1, 1.5)],
    };
  }
  if (layout === 'dual-h' || layout === 'dual-v' || /SOIC|SO-\d|SOP|DIP/i.test(text)) {
    const rowsAlongX = layout === 'dual-h' || (layout !== 'dual-v' && horiz);
    const dip = th && near(pitch, 2.54, 0.06);
    const hAcross = innerHalf(pads, rowsAlongX ? 'y' : 'x') + (dip ? -0.3 : 0.05);
    const along = (rowsAlongX ? c.w : c.h) + (dip ? 1.4 : 0.5);
    const family = dip ? 'DIP' : near(pitch, 1.27, 0.06) ? 'SOIC' : near(pitch, 0.65, 0.05) ? (pinCount <= 10 ? 'MSOP' : 'TSSOP') : near(pitch, 0.5, 0.05) || near(pitch, 0.635, 0.05) ? 'SSOP' : 'dual-row';
    const pkg = family === 'dual-row' ? `${pinCount}-pin dual-row` : `${family}-${pinCount}`;
    const tall = dip ? 3.3 : family === 'SOIC' ? 1.5 : 1.0;
    const z0 = dip ? 0.6 : 0.1;
    const [sx, sy] = rowsAlongX ? [along, hAcross * 2] : [hAcross * 2, along];
    const leads = dip
      ? pads.slice(0, 64).flatMap((q) => [box(0.5, 0.5, z0 + 0.4, q.x, q.y, 0, C.tin)])
      : legs(pads, sx / 2, sy / 2);
    return {
      pkg, what: `${pkg} chip`, category: 'ic', color: C.epoxy, how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(sx, sy, tall, 0, 0, z0, C.epoxy), ...leads, pin1(-sx / 2 + 0.7, -sy / 2 + 0.6, z0 + tall)],
    };
  }

  // ---------- modules and everything else ----------
  const sizes = new Map<string, number>();
  for (const q of pads) { const k = `${q.w.toFixed(1)}x${q.h.toFixed(1)}`; sizes.set(k, (sizes.get(k) ?? 0) + 1); }
  const uniform = Math.max(0, ...sizes.values()) >= pads.length * 0.7;
  if (L >= 12 && n >= 14 && !th && uniform) {
    const counts = { left: 0, right: 0, bottom: 0, top: 0 };
    for (const q of pads) {
      if (q.x < -c.w / 2 + 1.5) counts.left++;
      if (q.x > c.w / 2 - 1.5) counts.right++;
      if (q.y < -c.h / 2 + 1.5) counts.bottom++;
      if (q.y > c.h / 2 - 1.5) counts.top++;
    }
    // The side with no pads is usually the antenna end: the metal shield sits away from it.
    const open = (Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0]) as keyof typeof counts;
    const shift = { left: [c.w * 0.1, 0], right: [-c.w * 0.1, 0], bottom: [0, c.h * 0.1], top: [0, -c.h * 0.1] }[open];
    const vertical = open === 'top' || open === 'bottom';
    return {
      pkg: `${r1(c.w)} × ${r1(c.h)} module`, what: 'module (radio or controller) with a metal shield', category: 'ic', color: C.module,
      how: named ? 'named' : 'pattern', evidence: say(pattern),
      solids: [box(c.w, c.h, 0.8, 0, 0, 0, C.module), box(vertical ? c.w * 0.86 : c.w * 0.72, vertical ? c.h * 0.72 : c.h * 0.86, 2.2, shift[0], shift[1], 0.8, C.metal)],
    };
  }

  if (L < 0.9 && n <= 2) return null;
  return {
    pkg: `${n}-pad`, what: `component with ${n} pads`, category: th && edge ? 'connector' : 'other', color: C.generic, how: 'size', evidence: say(pattern),
    solids: [box(Math.max(0.6, c.w * 0.85), Math.max(0.6, c.h * 0.85), Math.min(3, 0.6 + L * 0.15), 0, 0, 0.05, C.generic)],
  };
}

/** For two-row and SOT parts: does the long side of the body run along x? */
function layoutAxis(layout: string, horiz: boolean): boolean {
  if (layout === 'dual-h') return true;
  if (layout === 'dual-v') return false;
  return horiz;
}

// ---------- the design ----------

/** Short label for the footprint list and for Claude's brief. */
export function guessLabel(c: Comp, b: ImportedBoard): string {
  const g = guessPart(c, b.board.width, b.board.height);
  return g ? `${g.pkg}: ${g.what}` : 'single pad (test point or fiducial)';
}

export function boardDesign(b: ImportedBoard): Teardown {
  const W = b.board.width;
  const H = b.board.height;
  const t = b.board.thickness || 1.6;
  // The longer side runs along x, so the board view and the exports keep their orientation.
  const rot = H > W;
  const P = (x: number, y: number): [number, number] => (rot ? [y - H / 2, -(x - W / 2)] : [x - W / 2, y - H / 2]);
  const turn = (x: number, y: number): [number, number] => (rot ? [y, -x] : [x, y]);
  const turnSize = (sx: number, sy: number): [number, number] => (rot ? [sy, sx] : [sx, sy]);
  const turnAxis = (a?: Axis): Axis | undefined => (rot && a === 'x' ? 'y' : rot && a === 'y' ? 'x' : a);

  const board: Part = {
    id: 'board', name: `Circuit board (${b.name.replace(/\.(zip|kicad_pcb)$/i, '')})`, category: 'pcb', refDes: 'PCB1', qty: 1,
    function: 'Carries and connects every part.', material: 'FR-4, copper', process: 'PCB fabrication',
    confidence: 'observed', evidence: `Outline measured from the ${b.kind === 'kicad' ? 'KiCad board' : 'Gerber'} file: ${W} × ${H} mm.`,
    shape: 'box', size: rot ? [H, W, t] : [W, H, t], position: [0, 0, 0], explode: [0, 0, 0], color: '#1f5a41',
    drills: b.holes.slice(0, 400).map((h) => { const [u, v] = rot ? [h.y, W - h.x] : [h.x, h.y]; return { x: u, y: v, d: h.d }; }),
  };

  type Built = { c: Comp; g: Guess; part: Part };
  const built: Built[] = [];
  let skipped = 0;
  b.components.forEach((c, i) => {
    const g = guessPart(c, W, H);
    if (!g) { skipped++; return; }
    const top = c.side !== 'bottom';
    // The solids in product coordinates, relative to the footprint centre; then the part is centred on their box.
    const solids = g.solids.map((s) => {
      const [x, y] = turn(s.at[0], s.at[1]);
      const [sx, sy] = turnSize(s.size[0], s.size[1]);
      const z = top ? t / 2 + s.at[2] : -(t / 2 + s.at[2]);
      return { ...s, at: [x, y, z] as Vec3, size: [sx, sy, s.size[2]] as Vec3, axis: turnAxis(s.axis) };
    });
    const lo = [0, 1, 2].map((k) => Math.min(...solids.map((s) => s.at[k] - s.size[k] / 2)));
    const hi = [0, 1, 2].map((k) => Math.max(...solids.map((s) => s.at[k] + s.size[k] / 2)));
    const mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as Vec3;
    const [fx, fy] = P(c.x, c.y);
    const shapes: PartShape[] = solids.map((s) => ({
      shape: s.shape, size: s.size, axis: s.axis, color: s.color,
      offset: [s.at[0] - mid[0], s.at[1] - mid[1], s.at[2] - mid[2]],
    }));
    const lift = 12 + (hi[2] - lo[2]);
    const pads = padsOf(c).slice(0, 160).map((p) => {
      const [x, y] = turn(p.x, p.y);
      const [w, h] = turnSize(p.w, p.h);
      return { x: x - mid[0], y: y - mid[1], w, h };
    });
    const ref = c.ref || `P${i + 1}`;
    const label = c.value ? `${c.value} (${g.pkg})` : g.what.charAt(0).toUpperCase() + g.what.slice(1);
    built.push({
      c, g,
      part: {
        id: `fp-${i + 1}`, name: label, category: g.category, refDes: ref, qty: 1,
        function: functionOf(g),
        package: g.pkg,
        confidence: g.how === 'named' ? 'observed' : 'inferred',
        evidence: g.evidence,
        unknowns: g.how === 'named' ? undefined : 'Part number and value: Gerber copper does not contain them.',
        parentId: 'board',
        shape: 'box', size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
        position: [fx + mid[0], fy + mid[1], mid[2]],
        explode: [0, 0, top ? lift : -lift],
        color: g.color, shapes, pads,
      },
    });
  });

  // Rows of identical tiny passives become one line with copies, so the list stays readable.
  const parts: Part[] = [board];
  const groups = new Map<string, Built[]>();
  for (const x of built) {
    if (!x.g.groupable || x.c.value) { parts.push(x.part); continue; }
    const key = `${x.g.what}|${x.c.side}|${x.part.size.map((v) => v.toFixed(2)).join(',')}`;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  for (const list of groups.values()) {
    if (list.length === 1) { parts.push(list[0].part); continue; }
    const [first, ...rest] = list;
    const what = first.g.what.replace(/(resistor or capacitor|resistor|capacitor|inductor|LED)$/, (m) => (m === 'resistor or capacitor' ? 'resistors or capacitors' : `${m}s`));
    parts.push({
      ...first.part,
      name: what.charAt(0).toUpperCase() + what.slice(1),
      refDes: undefined,
      qty: list.length,
      evidence: `${first.g.evidence} ${list.length} footprints share this pattern: ${list.slice(0, 12).map((x) => x.part.refDes).join(', ')}${list.length > 12 ? '…' : ''}.`,
      copies: rest.map((x) => x.part.position),
    });
  }

  const top = Math.max(0, ...parts.filter((p) => p.parentId && p.position[2] > 0).map((p) => p.position[2] + p.size[2] / 2 - t / 2));
  const bottom = Math.max(0, ...parts.filter((p) => p.parentId && p.position[2] < 0).map((p) => -(p.position[2] - p.size[2] / 2) - t / 2));
  const count = (cat: PartCategory) => built.filter((x) => x.g.category === cat).length;
  const recognised = built.filter((x) => x.g.how !== 'size').length;
  const name = b.name.replace(/\.(zip|kicad_pcb)$/i, '');

  return {
    product: {
      name: `Board: ${name}`,
      category: 'Circuit board',
      summary: [
        `A ${W} × ${H} mm board read from ${b.kind === 'kicad' ? 'a KiCad board file' : 'Gerber files'}, with ${built.length} parts generated on it`,
        `(${count('ic') + count('power')} chips, ${count('passive')} passives, ${count('connector')} connectors, ${count('electromech')} switches).`,
        b.kind === 'kicad'
          ? 'Footprint names come from the file; bodies and heights are typical for each package.'
          : `${recognised} footprints were recognised from their pad pattern; the rest are shown as plain blocks. Values and part numbers are not in Gerber files.`,
      ].join(' '),
      dimensionsMm: [rot ? H : W, rot ? W : H, Math.round((t + top + bottom) * 10) / 10],
    },
    parts,
    connections: [],
    unknowns: [
      b.kind === 'kicad' ? 'Component heights: KiCad footprints give the pads, not the body height.' : 'What each part is exactly: Gerber copper has pads, not part numbers or values.',
      'Nets between the parts: they are not read from the copper yet.',
      ...(skipped ? [`${skipped} single pads (test points, fiducials) are not shown as parts.`] : []),
    ],
    verifySteps: [
      'Hold the real board next to the 3D view and check each generated part.',
      ...(b.kind === 'gerber' ? ['Add the pick-and-place file (.pos or .csv) to the upload to name every part.'] : []),
      'Measure the tallest part on each side before designing a housing.',
    ],
    safety: [],
    meta: { source: 'board', createdAt: new Date().toISOString() },
  };
}

function functionOf(g: Guess): string {
  switch (g.category) {
    case 'ic': return `A ${g.pkg} chip; what it does is not in the board files.`;
    case 'power': return 'Power conversion or switching, by its package.';
    case 'passive': return `A ${g.what} in a ${g.pkg} package.`;
    case 'connector': return `A ${g.what}.`;
    case 'electromech': return 'A button the user presses.';
    case 'display': return 'An indicator light.';
    default: return `A part with this footprint: ${g.pkg}.`;
  }
}
