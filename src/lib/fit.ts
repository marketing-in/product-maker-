import { instances } from './geometry';
import type { Axis, Part, Teardown, Vec3 } from './types';

// Mould and fit checks, worked out from the part boxes in the teardown.
// Everything here is a first-pass design-for-manufacture estimate from rules of
// thumb. Sizes come from the reconstruction, so treat tight numbers as prompts
// to measure, not as results.

const AI: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

interface Box { min: Vec3; max: Vec3 }
const boxOf = (c: Vec3, size: Vec3): Box => ({
  min: [c[0] - size[0] / 2, c[1] - size[1] / 2, c[2] - size[2] / 2],
  max: [c[0] + size[0] / 2, c[1] + size[1] / 2, c[2] + size[2] / 2],
});

const RESINS: { match: RegExp; name: string; density: number; shrinkPct: number; clampTPerCm2: number; coolK: number }[] = [
  { match: /\bpc\s*\/?\+?\s*abs\b/i, name: 'PC/ABS', density: 1.15, shrinkPct: 0.6, clampTPerCm2: 0.45, coolK: 2.4 },
  { match: /polycarbonate|\bpc\b/i, name: 'PC', density: 1.2, shrinkPct: 0.6, clampTPerCm2: 0.5, coolK: 2.6 },
  { match: /\babs\b/i, name: 'ABS', density: 1.05, shrinkPct: 0.5, clampTPerCm2: 0.4, coolK: 2.2 },
  { match: /polypropylene|\bpp\b/i, name: 'PP', density: 0.91, shrinkPct: 1.5, clampTPerCm2: 0.3, coolK: 2.8 },
  { match: /nylon|\bpa\d*\b/i, name: 'PA (nylon)', density: 1.14, shrinkPct: 1.2, clampTPerCm2: 0.5, coolK: 2.3 },
  { match: /silicone|rubber|tpe|tpu/i, name: 'Elastomer', density: 1.15, shrinkPct: 2.5, clampTPerCm2: 0.25, coolK: 4 },
];

export interface MouldNote {
  part: Part;
  moulded: boolean;
  resin: string;
  wall: number;
  pullAxis: Axis;
  pullSign: '+' | '-';
  depth: number;
  draftDeg: number;
  /** Taper per side over the full depth at the suggested draft. */
  draftTaperMm: number;
  volumeCm3: number;
  massG: number;
  shrinkPct: number;
  /** Cavity size after shrink allowance. */
  cavityMm: Vec3;
  projectedCm2: number;
  clampTonnes: number;
  coolingS: number;
  ribMm: [number, number];
  sideAction: boolean;
  notes: string[];
}

export function mouldNotes(td: Teardown): MouldNote[] {
  const screws = td.parts.filter((p) => p.category === 'fastener');
  return td.parts.filter((p) => p.category === 'enclosure').map((p) => {
    const text = `${p.material ?? ''} ${p.process ?? ''}`;
    const moulded = /mould|mold|inject|compress/i.test(text) || p.shape === 'shell';
    const resin = RESINS.find((r) => r.match.test(text));
    const open = p.open ?? '+z';
    // A flat part pulls along its thinnest axis; a shell pulls out of its open face.
    const pullAxis: Axis = p.shape === 'shell' ? (open[1] as Axis) : (['x', 'y', 'z'] as Axis[])[p.size.indexOf(Math.min(...p.size))];
    const ai = AI[pullAxis];
    const [bi, ci] = ([0, 1, 2] as const).filter((i) => i !== ai);
    const depth = p.size[ai];
    const wall = p.shape === 'shell' ? Math.max(0.4, p.wall ?? 2) : Math.min(...p.size);
    const outer = p.size[0] * p.size[1] * p.size[2];
    const inner = p.shape === 'shell'
      ? Math.max(0, (p.size[bi] - 2 * wall) * (p.size[ci] - 2 * wall) * (depth - wall))
      : 0;
    const volumeCm3 = (outer - inner) / 1000;
    const density = resin?.density ?? 1.05;
    const shrinkPct = resin?.shrinkPct ?? 0.5;
    const draftDeg = depth > 50 ? 2 : depth > 20 ? 1.5 : 1;
    const projectedCm2 = (p.size[bi] * p.size[ci]) / 100;
    const sideAction = /side.?action|slide|lifter/i.test(text);

    const notes: string[] = [];
    const nearby = screws.filter((s) => instances(s).some((c) => {
      const b = boxOf(p.position, p.size);
      return c.every((v, i) => v >= b.min[i] - 2 && v <= b.max[i] + 2);
    }));
    if (!moulded) {
      // Cut or formed from sheet: draft, ribs, sink marks and shrink do not apply.
      const metal = /steel|alumin|metal|brass|copper|stamp|bent|formed|press/i.test(text);
      const sheet = /mdf|plywood|wood|timber|board|acrylic|cnc|rout|laser|sawn|cut|sheet/i.test(text);
      if (metal) notes.push(`Formed sheet, ${wall} mm: keep each inside bend radius at least ${wall} mm and holes at least ${(wall * 2).toFixed(1)} mm from a bend.`);
      else if (sheet) notes.push(`Cut from flat ${wall} mm sheet, so draft, ribs and shrink do not apply. Joints and fixings set the strength.`);
      for (const s of nearby) {
        const d = Math.min(...s.size);
        notes.push(`${s.qty} × ${s.name}: pilot hole about ${(d * 0.75).toFixed(1)} mm, at least ${(d * 2.5).toFixed(1)} mm from any edge.`);
      }
      if (!notes.length) notes.push('Not a moulded part. No problems found at this level of detail.');
      return {
        part: p, moulded, resin: 'Not a moulded resin', wall, pullAxis, pullSign: '+' as const, depth, draftDeg: 0, draftTaperMm: 0,
        volumeCm3, massG: 0, shrinkPct: 0, cavityMm: p.size, projectedCm2, clampTonnes: 0, coolingS: 0, ribMm: [0, 0] as [number, number],
        sideAction: false, notes,
      };
    }
    if (wall < 1) notes.push(`Wall of ${wall} mm is thin for a part this size. Expect short shots unless the flow length is under ${Math.round(wall * 150)} mm.`);
    if (wall > 4) notes.push(`Wall of ${wall} mm is thick. Core it out to about 2.5 mm to avoid sink marks and long cooling.`);
    if (depth / wall > 30) notes.push(`Deep draw (${Math.round(depth / wall)} × wall). Add ribs or raise the draft so the part releases without scuffing.`);
    if (sideAction) notes.push('The process note mentions a side action. Any port or button opening in a side wall needs a slide or a shut-off.');
    for (const s of nearby) {
      const d = Math.min(...s.size);
      notes.push(`${s.qty} × ${s.name}: screw boss about ${(d * 2).toFixed(1)} mm outside diameter, ${(d * 0.8).toFixed(1)} mm pilot hole, with ${(wall * 0.6).toFixed(1)} mm ribs to the wall.`);
    }
    if (!notes.length) notes.push('No problems found at this level of detail.');

    return {
      part: p, moulded, resin: resin?.name ?? (moulded ? 'Not stated, ABS assumed' : 'Not a moulded resin'),
      wall, pullAxis, pullSign: p.shape === 'shell' ? (open[0] as '+' | '-') : '+', depth, draftDeg,
      draftTaperMm: depth * Math.tan((draftDeg * Math.PI) / 180),
      volumeCm3, massG: volumeCm3 * density, shrinkPct,
      cavityMm: p.size.map((v) => v * (1 + shrinkPct / 100)) as Vec3,
      projectedCm2, clampTonnes: projectedCm2 * (resin?.clampTPerCm2 ?? 0.4),
      coolingS: (resin?.coolK ?? 2.2) * wall * wall,
      ribMm: [wall * 0.5, wall * 0.6], sideAction, notes,
    };
  });
}

export type FitStatus = 'inside' | 'tight' | 'through-wall' | 'outside';

export interface FitRow {
  part: Part;
  status: FitStatus;
  /** Smallest gap to the inner face of the housing, in mm. Negative means it crosses the wall. */
  clearance: number;
  axis: Axis;
  note: string;
}

export interface Clash { a: Part; b: Part; depth: number; axis: Axis }

export interface FitReport {
  hasHousing: boolean;
  envelope: Vec3;
  wall: number;
  rows: FitRow[];
  clashes: Clash[];
}

const MEANT_TO_PASS: Part['category'][] = ['connector', 'display', 'electromech', 'sensor', 'antenna'];

const HOLDS = /holder|socket|cradle|clip|bracket|mount|sleeve|boot|cage|carrier|clamp|standoff|spacer/i;

export function fitReport(td: Teardown): FitReport {
  const housing = td.parts.filter((p) => p.category === 'enclosure');
  const inside = td.parts.filter((p) => p.category !== 'enclosure' && p.category !== 'fastener');
  const env: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const h of housing) {
    for (const c of instances(h)) {
      const b = boxOf(c, h.size);
      for (let i = 0; i < 3; i++) { env.min[i] = Math.min(env.min[i], b.min[i]); env.max[i] = Math.max(env.max[i], b.max[i]); }
    }
  }
  const shells = housing.filter((h) => h.shape === 'shell');
  const wall = shells.length ? Math.min(...shells.map((h) => h.wall ?? 2)) : 0;
  const axes: Axis[] = ['x', 'y', 'z'];

  const rows: FitRow[] = housing.length === 0 ? [] : inside.map((p) => {
    let clearance = Infinity;
    let axis: Axis = 'x';
    let beyond = false;
    for (const c of instances(p)) {
      const b = boxOf(c, p.size);
      for (let i = 0; i < 3; i++) {
        const gap = Math.min(b.min[i] - (env.min[i] + wall), env.max[i] - wall - b.max[i]);
        if (gap < clearance) { clearance = gap; axis = axes[i]; }
        if (b.max[i] < env.min[i] || b.min[i] > env.max[i]) beyond = true;
      }
    }
    const status: FitStatus = beyond ? 'outside' : clearance < 0 ? 'through-wall' : clearance < 0.5 ? 'tight' : 'inside';
    const note =
      status === 'outside' ? 'Sits wholly outside the housing. Check its position.'
      : status === 'through-wall' ? (MEANT_TO_PASS.includes(p.category)
        ? `Reaches ${Math.abs(clearance).toFixed(1)} mm into the wall along ${axis}: it needs a cut-out there.`
        : `Crosses the wall along ${axis} by ${Math.abs(clearance).toFixed(1)} mm. Either the size is over-estimated or the wall is relieved here.`)
      : status === 'tight' ? `Only ${clearance.toFixed(1)} mm to the wall along ${axis}. Allow for moulding tolerance of about ±0.2 mm.`
      : `${clearance.toFixed(1)} mm to the nearest wall, along ${axis}.`;
    return { part: p, status, clearance, axis, note };
  });

  // Part-to-part overlaps. A part and the thing it is mounted on are expected to touch.
  const clashes: Clash[] = [];
  for (let i = 0; i < inside.length; i++) {
    for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i];
      const b = inside[j];
      if (a.parentId === b.id || b.parentId === a.id) continue;
      // A holder, socket or clip is meant to wrap the part it holds.
      if (HOLDS.test(a.name) || HOLDS.test(b.name)) continue;
      let worst: Clash | null = null;
      for (const ca of instances(a)) {
        for (const cb of instances(b)) {
          const A = boxOf(ca, a.size);
          const B = boxOf(cb, b.size);
          const over = [0, 1, 2].map((k) => Math.min(A.max[k], B.max[k]) - Math.max(A.min[k], B.min[k]));
          if (over.every((o) => o > 0.3)) {
            const k = over.indexOf(Math.min(...over));
            if (!worst || over[k] > worst.depth) worst = { a, b, depth: over[k], axis: axes[k] };
          }
        }
      }
      if (worst) clashes.push(worst);
    }
  }
  clashes.sort((x, y) => y.depth - x.depth);

  const envelope: Vec3 = housing.length
    ? [env.max[0] - env.min[0], env.max[1] - env.min[1], env.max[2] - env.min[2]]
    : td.product.dimensionsMm;
  return { hasHousing: housing.length > 0, envelope, wall, rows, clashes };
}
