import { instances } from './geometry';
import { connPower } from './power';
import type { Connection, ControlEffect, Part, Teardown } from './types';

// The simulator: what happens when you press a button on the product.
//
// Controls come from the teardown when Claude described them (td.controls).
// Otherwise they are worked out: every switch, button, key or knob is a
// control, the first one switches the product on, the rest pulse whatever
// they drive. A press travels along the connections from the control to the
// chip that reads it, and the outputs (LEDs, speakers, motors, radio) react.

export interface Control {
  id: string;
  partId: string;
  /** Which copy of the part, for a row of identical keys. */
  index: number;
  label: string;
  effect: ControlEffect;
  action: string;
  affects: string[];
  derived: boolean;
}

export interface SimState {
  on: boolean;
  /** Output level, 0 to 1 (volume, brightness, speed). */
  level: number;
  /** Outputs switched on by a toggle control. */
  toggled: string[];
}

export const START: SimState = { on: false, level: 0.6, toggled: [] };

const CONTROL_WORD = /\b(switch|button|key(?!\s*board\s*connector)|knob|dial|slider|trigger|encoder|touch pad|touch sensor)\b/i;
const OUTPUT: Part['category'][] = ['display', 'electromech', 'antenna'];

export function isControlPart(p: Part): boolean {
  return (p.category === 'electromech' || p.category === 'sensor' || p.category === 'other') && CONTROL_WORD.test(p.name);
}

export function outputs(td: Teardown): Part[] {
  return td.parts.filter((p) => OUTPUT.includes(p.category) && !isControlPart(p) && td.connections.some((c) => c.to === p.id && c.kind !== 'mechanical'));
}

/** Names each copy of a part from a range such as "SW1–SW3". */
function copyLabel(p: Part, i: number, count: number): string {
  const m = /^([A-Za-z]+)(\d+)\s*[–-]\s*[A-Za-z]*(\d+)$/.exec(p.refDes ?? '');
  if (m && Number(m[3]) - Number(m[2]) + 1 === count) return `${m[1]}${Number(m[2]) + i}`;
  return count > 1 ? `${p.refDes ?? p.name} ${i + 1}` : (p.refDes ?? p.name);
}

/** Parts reached by following connections forward from a part. */
export function downstream(td: Teardown, from: string): { parts: string[]; path: Connection[] } {
  const seen = new Set([from]);
  const path: Connection[] = [];
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const c of td.connections) {
      if (c.kind === 'mechanical' || c.kind === 'ground' || c.from !== id || seen.has(c.to)) continue;
      seen.add(c.to);
      path.push(c);
      queue.push(c.to);
    }
  }
  seen.delete(from);
  return { parts: [...seen], path };
}

export function controls(td: Teardown): Control[] {
  const byId = new Map(td.parts.map((p) => [p.id, p]));
  const outs = outputs(td).map((p) => p.id);
  if (td.controls?.length) {
    const used = new Map<string, number>();
    return td.controls.filter((c) => byId.has(c.partId)).map((c, i) => {
      const index = used.get(c.partId) ?? 0;
      used.set(c.partId, index + 1);
      const count = instances(byId.get(c.partId)!).length;
      return {
        id: `ctl-${i}`, partId: c.partId, index: Math.min(index, count - 1), label: c.label, effect: c.effect,
        action: c.action, affects: (c.affects ?? []).filter((id) => byId.has(id)), derived: false,
      };
    });
  }
  const list: Control[] = [];
  for (const p of td.parts.filter(isControlPart)) {
    const count = instances(p).length;
    for (let i = 0; i < count; i++) {
      const first = list.length === 0;
      const reach = downstream(td, p.id).parts.filter((id) => outs.includes(id));
      list.push({
        id: `${p.id}#${i}`, partId: p.id, index: i, label: copyLabel(p, i, count),
        effect: first ? 'power' : 'momentary',
        action: first ? 'Switches the product on or off.' : 'Sends a press to the controller. The outputs it drives respond.',
        affects: reach.length ? reach : outs, derived: true,
      });
    }
  }
  return list;
}

export interface Live {
  /** Parts doing something right now. */
  active: Set<string>;
  /** Connections carrying power or signal right now. */
  wires: Set<string>;
  drawW: number;
}

/** What is live for a given state, plus anything pulsed by a recent press. */
export function live(td: Teardown, s: SimState, pulsed: string[] = [], pulsedWires: string[] = []): Live {
  const active = new Set<string>(pulsed);
  const wires = new Set<string>(pulsedWires);
  let drawW = 0;
  if (s.on) {
    const outs = new Set(outputs(td).map((p) => p.id));
    const byId = new Map(td.parts.map((p) => [p.id, p]));
    for (const c of td.connections) {
      if (c.kind === 'mechanical' || c.kind === 'ground') continue;
      const to = byId.get(c.to);
      // An output runs when the level is up, or when a control has latched it on. Everything else is simply powered.
      // Level (volume, speed) only applies to things that move; a status LED stays lit.
      const isOut = outs.has(c.to) && to?.category === 'electromech';
      const running = !isOut || s.level > 0 || s.toggled.includes(c.to);
      if (!running) continue;
      wires.add(c.id);
      active.add(c.to);
      active.add(c.from);
      if (c.kind === 'power' && to && !td.connections.some((d) => d.kind === 'power' && d.from === c.to)) {
        drawW += (connPower(c) ?? 0) * (isOut ? s.level : 1);
      }
    }
  }
  return { active, wires, drawW };
}

export interface PressResult { state: SimState; pulse: string[]; pulseWires: string[]; log: string }

export function press(td: Teardown, s: SimState, c: Control): PressResult {
  const byId = new Map(td.parts.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.refDes ?? byId.get(id)?.name ?? id;
  const route = downstream(td, c.partId);
  const hop = route.path.slice(0, 3).map((e) => name(e.to)).join(' → ');
  const via = hop ? ` Signal: ${name(c.partId)} → ${hop}.` : '';
  const state: SimState = { ...s, toggled: [...s.toggled] };

  if (c.effect === 'power') {
    state.on = !s.on;
    return { state, pulse: [c.partId], pulseWires: route.path.map((e) => e.id), log: `${c.label}: power ${state.on ? 'on' : 'off'}.${via}` };
  }
  if (!s.on) {
    return { state, pulse: [c.partId], pulseWires: [], log: `${c.label} pressed, but the product is off. Nothing happens.` };
  }
  const pulseWires = route.path.map((e) => e.id);
  if (c.effect === 'level-up' || c.effect === 'level-down') {
    state.level = Math.round(Math.max(0, Math.min(1, s.level + (c.effect === 'level-up' ? 0.2 : -0.2))) * 10) / 10;
    return { state, pulse: [c.partId, ...c.affects], pulseWires, log: `${c.label}: level ${Math.round(state.level * 100)}%.${via}` };
  }
  if (c.effect === 'toggle') {
    const allOn = c.affects.length > 0 && c.affects.every((id) => state.toggled.includes(id));
    state.toggled = allOn ? state.toggled.filter((id) => !c.affects.includes(id)) : [...new Set([...state.toggled, ...c.affects])];
    return { state, pulse: [c.partId], pulseWires, log: `${c.label}: ${c.affects.map(name).join(', ') || 'outputs'} ${allOn ? 'off' : 'on'}.${via}` };
  }
  return { state, pulse: [c.partId, ...c.affects], pulseWires, log: `${c.label}: ${c.action}${via}` };
}
