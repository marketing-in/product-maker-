import { CATEGORIES, KINDS } from './schema.mjs';

// Claude's tool input is checked against the schema by the API, but the 3D
// view must never crash on a bad number or a dangling id, so everything is
// coerced and clamped here before it reaches the browser.

const DEFAULT_COLOR = {
  enclosure: '#454b50', pcb: '#2f6b4f', ic: '#1f2428', passive: '#b9a37a', connector: '#b9bec4',
  power: '#23282c', battery: '#3d77b3', display: '#1c2733', electromech: '#2c2f33', sensor: '#c2b280',
  antenna: '#c58a4a', thermal: '#aab0b6', fastener: '#a3a8ad', other: '#7d8388',
};

const text = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};
const optNum = (v, lo, hi) => (v == null ? undefined : num(v, lo, hi, undefined));
const vec = (v, lo, hi, fallback) =>
  Array.isArray(v) && v.length >= 3 ? [0, 1, 2].map((i) => num(v[i], lo, hi, fallback[i])) : [...fallback];
const oneOf = (v, options, fallback) => (options.includes(v) ? v : fallback);
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const list = (v, max = 12) =>
  Array.isArray(v) ? v.map((s) => text(s, 300)).filter(Boolean).slice(0, max) : [];

/** The solids a part is built from. Dropped unless there are at least two usable ones. */
function shapeList(raw) {
  const out = (Array.isArray(raw) ? raw : []).slice(0, 8)
    .filter((s) => s && typeof s === 'object' && Array.isArray(s.size))
    .map((s) => ({
      shape: oneOf(s.shape, ['box', 'cylinder'], 'box'),
      size: vec(s.size, 0.1, 5000, [5, 5, 5]),
      axis: oneOf(s.axis, ['x', 'y', 'z'], undefined),
      offset: vec(s.offset, -5000, 5000, [0, 0, 0]),
      color: /^#[0-9a-f]{6}$/i.test(s.color ?? '') ? s.color.toLowerCase() : undefined,
    }));
  return out.length >= 2 ? out : undefined;
}

export function sanitizeTeardown(raw, model) {
  if (!raw || typeof raw !== 'object') throw new Error('The model returned no teardown.');
  const product = raw.product ?? {};
  const seen = new Set();

  const parts = (Array.isArray(raw.parts) ? raw.parts : []).slice(0, 80).map((p, i) => {
    let id = slug(p.id) || `part-${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const category = oneOf(p.category, CATEGORIES, 'other');
    const copies = Array.isArray(p.copies)
      ? p.copies.slice(0, 24).filter((c) => Array.isArray(c) && c.length >= 3).map((c) => vec(c, -5000, 5000, [0, 0, 0]))
      : [];
    return {
      id,
      rawId: String(p.id ?? ''),
      name: text(p.name, 120) || `Part ${i + 1}`,
      category,
      refDes: text(p.refDes, 40),
      qty: Math.max(Math.round(num(p.qty, 1, 9999, 1)), 1 + copies.length),
      function: text(p.function) || '',
      material: text(p.material, 200),
      process: text(p.process, 200),
      package: text(p.package, 200),
      candidates: list(p.candidates, 6),
      estCostUsd: optNum(p.estCostUsd, 0, 100000),
      confidence: oneOf(p.confidence, ['observed', 'inferred', 'assumed'], 'assumed'),
      evidence: text(p.evidence) || 'No evidence given.',
      unknowns: text(p.unknowns),
      parentId: p.parentId ? slug(p.parentId) : null,
      shape: oneOf(p.shape, ['box', 'cylinder', 'shell'], 'box'),
      size: vec(p.size, 0.1, 5000, [10, 10, 10]),
      axis: oneOf(p.axis, ['x', 'y', 'z'], undefined),
      open: oneOf(p.open, ['+x', '-x', '+y', '-y', '+z', '-z'], undefined),
      wall: optNum(p.wall, 0.3, 50),
      position: vec(p.position, -5000, 5000, [0, 0, 0]),
      copies: copies.length ? copies : undefined,
      explode: vec(p.explode, -10000, 10000, [0, 0, 0]),
      color: /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color.toLowerCase() : DEFAULT_COLOR[category],
      shapes: shapeList(p.shapes),
    };
  });
  if (parts.length === 0) throw new Error('The model returned a teardown with no parts.');

  // Ids may have been normalised; map the originals so references still resolve.
  const idMap = new Map();
  const remember = (key, id) => { if (!idMap.has(key)) idMap.set(key, id); };
  // The first part to use an id keeps it when the model repeats one.
  parts.forEach((p) => { remember(p.rawId, p.id); remember(slug(p.rawId), p.id); remember(p.id, p.id); });
  const resolve = (v) => idMap.get(String(v ?? '')) ?? idMap.get(slug(v));
  parts.forEach((p) => {
    const parent = p.parentId ? resolve(p.parentId) : null;
    p.parentId = parent && parent !== p.id ? parent : null;
    delete p.rawId;
  });

  ensureExplode(parts);

  const connSeen = new Set();
  const connections = (Array.isArray(raw.connections) ? raw.connections : []).slice(0, 200).flatMap((c, i) => {
    const from = resolve(c.from);
    const to = resolve(c.to);
    if (!from || !to || from === to) return [];
    let id = slug(c.id) || `c-${i + 1}`;
    while (connSeen.has(id)) id = `${id}-${i + 1}`;
    connSeen.add(id);
    return [{
      id, from, to,
      kind: oneOf(c.kind, KINDS, 'signal'),
      label: text(c.label, 80) || 'Connection',
      medium: text(c.medium, 120),
      voltageV: optNum(c.voltageV, -100000, 100000),
      currentA: optNum(c.currentA, 0, 100000),
      powerW: optNum(c.powerW, 0, 1e7),
      protocol: text(c.protocol, 120),
      wire: text(c.wire, 120),
      confidence: oneOf(c.confidence, ['observed', 'inferred', 'assumed'], 'assumed'),
      evidence: text(c.evidence),
    }];
  });

  return {
    product: {
      name: text(product.name, 120) || 'Unnamed product',
      category: text(product.category, 80) || 'Unknown',
      summary: text(product.summary, 900) || '',
      dimensionsMm: vec(product.dimensionsMm, 0.1, 10000, bounds(parts)),
      powerInput: text(product.powerInput, 160),
    },
    parts,
    connections,
    controls: controlList(raw.controls, parts),
    unknowns: list(raw.unknowns),
    verifySteps: list(raw.verifySteps),
    safety: list(raw.safety),
    meta: { source: 'claude', model, createdAt: new Date().toISOString() },
  };
}

const EFFECTS = new Set(['power', 'toggle', 'momentary', 'level-up', 'level-down']);

/** Controls that point at real parts. Dropped silently otherwise: the app derives its own. */
function controlList(raw, parts) {
  const ids = new Set(parts.map((p) => p.id));
  return (Array.isArray(raw) ? raw : [])
    .filter((c) => c && typeof c === 'object' && ids.has(c.partId) && EFFECTS.has(c.effect))
    .slice(0, 40)
    .map((c) => ({
      partId: c.partId,
      label: text(c.label, 60) || 'Control',
      effect: c.effect,
      action: text(c.action, 240) || '',
      affects: (Array.isArray(c.affects) ? c.affects : []).filter((id) => ids.has(id)).slice(0, 20),
    }));
}

function bounds(parts) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p.position[i] - p.size[i] / 2);
      hi[i] = Math.max(hi[i], p.position[i] + p.size[i] / 2);
    }
  }
  return [0, 1, 2].map((i) => Math.max(1, hi[i] - lo[i]));
}

/** If the model left explode vectors empty, derive a usable exploded layout. */
function ensureExplode(parts) {
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const moving = parts.filter((p) => len(p.explode) > 0.5).length;
  if (moving >= parts.length / 2) {
    const byId = new Map(parts.map((p) => [p.id, p]));
    for (const p of parts) {
      const parent = p.parentId ? byId.get(p.parentId) : null;
      if (parent && len(p.explode) <= 0.5 && len(parent.explode) > 0.5) {
        p.explode = [parent.explode[0], parent.explode[1], parent.explode[2] + 20];
      }
    }
    return;
  }
  // Spread along the axis the parts are most stacked on, in order of position.
  const size = bounds(parts);
  const spread = [0, 1, 2].map((i) => {
    const centres = parts.map((p) => p.position[i]);
    return Math.max(...centres) - Math.min(...centres);
  });
  const axis = spread.indexOf(Math.max(...spread));
  const centre = parts.reduce((s, p) => s + p.position[axis], 0) / parts.length;
  const reach = Math.max(size[axis], 40);
  for (const p of parts) {
    const offset = (p.position[axis] - centre) / (spread[axis] / 2 || 1);
    p.explode = [0, 0, 0];
    p.explode[axis] = offset * reach * 1.2;
  }
}
