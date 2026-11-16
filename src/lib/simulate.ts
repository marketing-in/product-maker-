import { connPower, partPower } from './power';
import type { Part, Teardown } from './types';

// A first-order parameter simulation on the power paths of the teardown.
// Change the load, duty cycle, supply voltage, ambient temperature and battery
// size, and see the input current, the heat in each part, a rough temperature
// for each part and the battery runtime.
//
// The thermal model is deliberately simple: still air, each part loses heat
// through its own surface plus some board copper. It ranks parts and finds the
// one to worry about. It does not replace a measurement or a CFD run.

export interface SimParams {
  /** Peak load as a share of the teardown's stated figures, 0 to 1.5. */
  load: number;
  /** Share of the time the product runs at that peak, 0 to 1. */
  duty: number;
  supplyV: number;
  ambientC: number;
  capacityMah: number;
}

export interface SimPart {
  part: Part;
  heatW: number;
  avgHeatW: number;
  riseC: number;
  tempC: number;
  limitC: number;
  over: boolean;
}

export interface SimResult {
  inputW: number;
  inputA: number;
  heatW: number;
  airRiseC: number;
  parts: SimPart[];
  hottest: SimPart | null;
  battery: { part: Part; voltageV: number; drawW: number; avgDrawW: number; runtimeH: number | null; cRate: number } | null;
}

const H_PART = 12; // W/m²K, still air inside a housing, convection plus radiation
const H_CASE = 8; // W/m²K, outside of a small plastic housing

/** Turns stored energy or sound into something other than heat. */
const efficiencyOut: Partial<Record<Part['category'], number>> = { electromech: 0.05, antenna: 0.5, display: 0.25 };

function areaM2(p: Part, board?: Part): number {
  const [x, y, z] = p.size;
  let a = 2 * (x * y + y * z + x * z);
  // Copper under and round a mounted part spreads its heat.
  if (board) a += 6 * Math.max(x * y, y * z, x * z);
  return a / 1e6;
}

export function defaults(td: Teardown): SimParams {
  const battery = td.parts.find((p) => p.category === 'battery');
  const mah = battery ? /(\d[\d,.]*)\s*mAh/i.exec(`${battery.name} ${battery.function} ${battery.package ?? ''}`) : null;
  const firstSource = sources(td)[0];
  return {
    load: 1,
    duty: 0.3,
    supplyV: firstSource?.voltageV ?? 5,
    ambientC: 25,
    capacityMah: mah ? Number(mah[1].replace(/,/g, '')) : 2000,
  };
}

/** Power connections that leave a part with no power input of its own. */
function sources(td: Teardown) {
  const fed = new Set(td.connections.filter((c) => c.kind === 'power').map((c) => c.to));
  return td.connections.filter((c) => c.kind === 'power' && !fed.has(c.from));
}

export function simulate(td: Teardown, q: SimParams): SimResult {
  const byId = new Map(td.parts.map((p) => [p.id, p]));
  const power = partPower(td);
  const inputW = sources(td).reduce((s, c) => s + (connPower(c) ?? 0), 0) * q.load;

  const housing = td.parts.filter((p) => p.category === 'enclosure');
  const d = td.product.dimensionsMm;
  const caseArea = housing.length
    ? (2 * (d[0] * d[1] + d[1] * d[2] + d[0] * d[2])) / 1e6
    : 0;

  const rows: SimPart[] = [];
  let heat = 0;
  for (const [id, pw] of power) {
    const p = byId.get(id);
    if (!p || !pw.hasIn || p.category === 'battery') continue;
    // A regulator or driver that passes power on loses a fraction of it. When the figures in the
    // design do not add up, do not treat the whole gap as heat: cap the loss at 12% of the input.
    // The same goes for an amplifier or driver chip whose load (a speaker, a motor) is not drawn:
    // more than a watt into a chip is assumed to be passed on, with a fifth lost as heat.
    const passesOn = pw.hasOut || ((p.category === 'ic' || p.category === 'power') && pw.inW > 1);
    const loss = passesOn ? Math.min(pw.usedW, pw.inW * (pw.hasOut ? 0.12 : 0.2)) : pw.usedW;
    const used = loss * q.load;
    // A motor turns most of its input into motion; a speaker turns very little into sound.
    const work = /motor|fan|pump|servo|actuator/i.test(p.name) ? 0.65 : (efficiencyOut[p.category] ?? 0);
    const heatW = used * (1 - work);
    heat += heatW * q.duty;
    rows.push({ part: p, heatW, avgHeatW: heatW * q.duty, riseC: 0, tempC: 0, limitC: p.category === 'electromech' ? 70 : 85, over: false });
  }
  const airRiseC = caseArea > 0 ? heat / (H_CASE * caseArea) : 0;
  for (const r of rows) {
    const board = r.part.parentId ? byId.get(r.part.parentId) : undefined;
    r.riseC = r.avgHeatW / (H_PART * areaM2(r.part, board?.category === 'pcb' ? board : undefined));
    r.tempC = q.ambientC + airRiseC + r.riseC;
    r.over = r.tempC > r.limitC;
  }
  rows.sort((a, b) => b.tempC - a.tempC);

  const bat = td.parts.find((p) => p.category === 'battery');
  let battery: SimResult['battery'] = null;
  if (bat) {
    const out = td.connections.filter((c) => c.kind === 'power' && c.from === bat.id);
    const voltageV = out.find((c) => c.voltageV)?.voltageV ?? 3.7;
    const drawW = out.reduce((s, c) => s + (connPower(c) ?? 0), 0) * q.load;
    const avgDrawW = drawW * q.duty;
    battery = {
      part: bat, voltageV, drawW, avgDrawW,
      // 90 % of the rated capacity is usable before the cut-off.
      runtimeH: avgDrawW > 0 ? (q.capacityMah / 1000) * voltageV * 0.9 / avgDrawW : null,
      cRate: q.capacityMah > 0 ? drawW / voltageV / (q.capacityMah / 1000) : 0,
    };
  }

  return {
    inputW,
    inputA: q.supplyV > 0 ? inputW / q.supplyV : 0,
    heatW: heat,
    airRiseC,
    parts: rows,
    hottest: rows[0] ?? null,
    battery,
  };
}

/** Hottest part temperature and runtime across the load range, for the chart. */
export function sweep(td: Teardown, q: SimParams): { load: number; tempC: number; runtimeH: number | null }[] {
  const out = [];
  for (let i = 1; i <= 15; i++) {
    const load = i / 10;
    const r = simulate(td, { ...q, load });
    out.push({ load, tempC: r.hottest?.tempC ?? q.ambientC, runtimeH: r.battery?.runtimeH ?? null });
  }
  return out;
}
