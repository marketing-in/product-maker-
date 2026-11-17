import { boards } from './board';
import { fitReport } from './fit';
import { defaults, simulate } from './simulate';
import type { Teardown } from './types';
import type { TabId } from '../components/Guide';

// The checks the agent runs on a design, in the order an engineer would ask
// them. Each one is computed from the model, so they re-run after every edit.

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** Where to look, or fix it. */
  tab: TabId;
}

/** A board the user uploaded, as read by the server. Millimetres from the lower-left corner. */
export interface ImportedBoard {
  kind: 'gerber' | 'kicad';
  name: string;
  board: { width: number; height: number; thickness: number };
  holes: { x: number; y: number; d: number }[];
  mounting: { x: number; y: number; d: number }[];
  components: { ref: string; value: string; footprint: string; side: 'top' | 'bottom'; pads: number; x: number; y: number; w: number; h: number }[];
  nets: number;
  layers: number;
  exact: boolean;
  notes: string[];
  svgTop?: string;
  svgBottom?: string;
}

export interface Brief {
  title: string;
  understanding: string;
  questions: { id: string; question: string; options: string[]; assumed: string; why?: string }[];
  requirements: string[];
  blocks: { name: string; role: string; parts?: string }[];
  risks: string[];
  costLowUsd: number | null;
  costHighUsd: number | null;
}

const names = (list: { name: string; refDes?: string }[], n = 3) =>
  list.slice(0, n).map((p) => p.refDes ?? p.name).join(', ') + (list.length > n ? ` and ${list.length - n} more` : '');

export function validate(td: Teardown): Check[] {
  const list: Check[] = [];
  const fit = fitReport(td);
  const sim = simulate(td, defaults(td));
  const brds = boards(td);
  const power = td.connections.filter((c) => c.kind === 'power');

  // Electrical: does every chip have a supply?
  const fed = new Set(power.map((c) => c.to));
  const feeds = new Set(power.map((c) => c.from));
  // A lamp or small sensor is often fed straight from a signal pin, so any incoming connection counts for those.
  const driven = new Set(td.connections.filter((c) => c.kind === 'signal').map((c) => c.to));
  const unpowered = td.parts.filter((p) => (p.category === 'ic' || p.category === 'sensor' || p.category === 'display')
    && !fed.has(p.id) && !feeds.has(p.id) && !(p.category !== 'ic' && driven.has(p.id)));
  list.push(power.length === 0
    ? { id: 'erc', title: 'Electrical rules', status: 'fail', detail: 'No power connections. Nothing in the design is supplied.', tab: 'power' }
    : unpowered.length
      ? { id: 'erc', title: 'Electrical rules', status: 'warn', detail: `${unpowered.length} active ${unpowered.length === 1 ? 'part has' : 'parts have'} no supply drawn: ${names(unpowered)}.`, tab: 'arch' }
      : { id: 'erc', title: 'Electrical rules', status: 'pass', detail: `Every active part has a supply. ${power.length} power paths, ${td.connections.length - power.length} other connections.`, tab: 'arch' });

  // Connectivity: parts on a board that nothing connects to.
  const wired = new Set(td.connections.flatMap((c) => [c.from, c.to]));
  const loose = td.parts.filter((p) => p.parentId && ['ic', 'power', 'connector', 'sensor'].includes(p.category) && !wired.has(p.id));
  list.push(loose.length
    ? { id: 'nets', title: 'Connections', status: 'warn', detail: `${loose.length} board ${loose.length === 1 ? 'part is' : 'parts are'} not connected to anything: ${names(loose)}.`, tab: 'arch' }
    : { id: 'nets', title: 'Connections', status: 'pass', detail: 'Every chip and connector on a board is connected.', tab: 'arch' });

  // Mechanical fit.
  if (fit.hasHousing) {
    // Wheels, feet, knobs and aerials belong outside the housing.
    const OUTSIDE_OK = /wheel|tyre|tire|caster|castor|foot|feet|knob|antenna|aerial|handle|strap|cable|plug|track|propeller|leg\b/i;
    const out = fit.rows.filter((r) => r.status === 'outside');
    const bad = out.filter((r) => !OUTSIDE_OK.test(r.part.name));
    const tight = fit.rows.filter((r) => r.status === 'tight');
    list.push(bad.length
      ? { id: 'fit', title: 'Fit in the housing', status: 'fail', detail: `${names(bad.map((r) => r.part))} ${bad.length === 1 ? 'sits' : 'sit'} outside the housing.`, tab: 'design' }
      : tight.length
        ? { id: 'fit', title: 'Fit in the housing', status: 'warn', detail: `${names(tight.map((r) => r.part))}: under 0.5 mm to the wall.`, tab: 'design' }
        : { id: 'fit', title: 'Fit in the housing', status: 'pass', detail: `${fit.rows.length - out.length} parts fit inside the ${fit.envelope.map((v) => v.toFixed(0)).join(' × ')} mm housing.${out.length ? ` ${names(out.map((r) => r.part))} sit outside it, as they should.` : ''}`, tab: 'fit' });
    list.push(fit.clashes.length
      ? { id: 'clash', title: 'Parts clear of each other', status: 'warn', detail: `${fit.clashes.length} overlap${fit.clashes.length === 1 ? '' : 's'}. Worst: ${fit.clashes[0].a.name} and ${fit.clashes[0].b.name}, ${fit.clashes[0].depth.toFixed(1)} mm.`, tab: 'design' }
      : { id: 'clash', title: 'Parts clear of each other', status: 'pass', detail: 'No two parts occupy the same space.', tab: 'fit' });
  } else {
    list.push({ id: 'fit', title: 'Fit in the housing', status: 'info', detail: 'No housing in the design, so fit was not checked.', tab: 'fit' });
  }

  // Thermal and battery.
  const hot = sim.parts.filter((p) => p.over);
  if (sim.parts.length) {
    // Past 200 °C the estimate says the power figures are wrong, not that the part glows.
    const absurd = hot.filter((h) => h.tempC > 200);
    list.push(absurd.length
      ? { id: 'heat', title: 'Power figures', status: 'warn', detail: `The power going into ${names(absurd.map((h) => h.part))} does not match what comes out, so its heat cannot be estimated. Check the voltages and currents on its connections in the power tree.`, tab: 'power' }
      : hot.length
      ? { id: 'heat', title: 'Temperature', status: 'warn', detail: `${names(hot.map((h) => h.part))} estimated at ${Math.round(hot[0].tempC)} °C, over the ${hot[0].limitC} °C limit. First-order estimate: confirm before acting.`, tab: 'sim' }
      : { id: 'heat', title: 'Temperature', status: 'pass', detail: `Hottest part ${sim.hottest ? `${sim.hottest.part.refDes ?? sim.hottest.part.name} at about ${Math.round(sim.hottest.tempC)} °C` : 'within limits'}.`, tab: 'sim' });
  }
  if (sim.battery) {
    const h = sim.battery.runtimeH;
    list.push(sim.battery.cRate > 2
      ? { id: 'bat', title: 'Battery', status: 'warn', detail: `Peak draw is ${sim.battery.cRate.toFixed(1)} C. Most small cells are rated for 1 to 2 C.`, tab: 'sim' }
      : { id: 'bat', title: 'Battery', status: 'pass', detail: h ? `About ${h < 1 ? `${Math.round(h * 60)} minutes` : `${h.toFixed(1)} hours`} at typical use, ${sim.battery.cRate.toFixed(2)} C at peak.` : 'Battery is charged but nothing draws from it.', tab: 'sim' });
  }

  // Board.
  if (brds.length) {
    const empty = brds.filter((b) => b.footprints.length === 0);
    list.push(empty.length
      ? { id: 'board', title: 'Board layout', status: 'warn', detail: `${names(empty.map((b) => b.part))} has no parts placed on it.`, tab: 'board' }
      : { id: 'board', title: 'Board layout', status: 'pass', detail: `${brds.length} board${brds.length === 1 ? '' : 's'}, ${brds.reduce((s, b) => s + b.footprints.length, 0)} placements. Gerber files generate and parse.`, tab: 'board' });
  }

  // Behaviour.
  list.push(td.controls?.length
    ? { id: 'ctl', title: 'Controls', status: 'pass', detail: `${td.controls.length} control${td.controls.length === 1 ? '' : 's'} described: ${td.controls.slice(0, 4).map((c) => c.label).join(', ')}.`, tab: 'run' }
    : { id: 'ctl', title: 'Controls', status: 'info', detail: 'No button actions described. The simulator works them out from the wiring.', tab: 'run' });

  // Evidence.
  const assumed = td.parts.filter((p) => p.confidence === 'assumed').length;
  list.push({ id: 'ev', title: 'Open questions', status: 'info', detail: `${assumed} of ${td.parts.length} parts are assumed. ${td.unknowns.length} open questions, ${td.verifySteps.length} things to measure.`, tab: 'guide' });
  return list;
}

export function tally(checks: Check[]): { pass: number; warn: number; fail: number; scored: number } {
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  return { pass: count('pass'), warn: count('warn'), fail: count('fail'), scored: checks.filter((c) => c.status !== 'info').length };
}
