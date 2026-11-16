import { add, instances, partPrims, scale, type Prim } from './geometry';
import type { Axis, Teardown, Vec3 } from './types';

// A small STEP (ISO 10303-21, AP214) writer. Every part becomes one or more
// named, coloured solids with planar faces. Cylinders are written as 32-sided
// prisms, which every CAD package opens; re-draw them as true cylinders if you
// need exact round faces.

const SEGMENTS = 32;

interface Poly { verts: Vec3[]; faces: number[][] }

function boxPoly(size: Vec3, c: Vec3): Poly {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const verts: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    verts.push([
      c[0] + (i & 1 ? hx : -hx),
      c[1] + (i & 2 ? hy : -hy),
      c[2] + (i & 4 ? hz : -hz),
    ]);
  }
  // Each loop runs counter-clockwise seen from outside.
  const faces = [
    [0, 2, 3, 1], [4, 5, 7, 6],
    [0, 1, 5, 4], [2, 6, 7, 3],
    [0, 4, 6, 2], [1, 3, 7, 5],
  ];
  return { verts, faces };
}

function prismPoly(radius: number, length: number, axis: Axis, c: Vec3): Poly {
  // Right-handed frame (u, v, w) with w along the cylinder axis.
  const frames: Record<Axis, [Vec3, Vec3, Vec3]> = {
    x: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    y: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    z: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  };
  const [u, v, w] = frames[axis];
  const n = SEGMENTS;
  const verts: Vec3[] = [];
  for (const end of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const cu = Math.cos(a) * radius;
      const sv = Math.sin(a) * radius;
      verts.push([
        c[0] + cu * u[0] + sv * v[0] + (end * length / 2) * w[0],
        c[1] + cu * u[1] + sv * v[1] + (end * length / 2) * w[1],
        c[2] + cu * u[2] + sv * v[2] + (end * length / 2) * w[2],
      ]);
    }
  }
  const faces: number[][] = [];
  faces.push(Array.from({ length: n }, (_, i) => n - 1 - i));
  faces.push(Array.from({ length: n }, (_, i) => n + i));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, j + n, i + n]);
  }
  return { verts, faces };
}

function primPoly(prim: Prim, origin: Vec3): Poly {
  const c = add(origin, prim.center);
  return prim.kind === 'box' ? boxPoly(prim.size, c) : prismPoly(prim.radius, prim.length, prim.axis, c);
}

const num = (n: number): string => {
  const r = Math.abs(n) < 1e-9 ? 0 : n;
  let s = r.toFixed(5).replace(/0+$/, '');
  if (s.endsWith('.')) return s;
  if (!s.includes('.')) s += '.';
  return s;
};

const str = (s: string): string =>
  s.replace(/[^\x20-\x7e]/g, '').replace(/\\/g, '/').replace(/'/g, "''").trim();

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function hexRgb(hex: string): Vec3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0x888888;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Build a STEP file. `explode` 0 writes the assembled product, 1 the exploded layout. */
export function buildStep(td: Teardown, explode = 0): string {
  const out: string[] = [];
  let id = 0;
  const emit = (body: string): number => {
    id += 1;
    out.push(`#${id}=${body};`);
    return id;
  };
  const ref = (n: number) => `#${n}`;
  const list = (ns: number[]) => `(${ns.map(ref).join(',')})`;
  const point = (p: Vec3) => emit(`CARTESIAN_POINT('',(${num(p[0])},${num(p[1])},${num(p[2])}))`);
  const dir = (d: Vec3) => emit(`DIRECTION('',(${num(d[0])},${num(d[1])},${num(d[2])}))`);

  const appCtx = emit(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  emit(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ref(appCtx)})`);
  const prodCtx = emit(`PRODUCT_CONTEXT('',${ref(appCtx)},'mechanical')`);
  const name = str(td.product.name) || 'Teardown';
  const product = emit(`PRODUCT('${name}','${name}','',(${ref(prodCtx)}))`);
  const formation = emit(`PRODUCT_DEFINITION_FORMATION('','',${ref(product)})`);
  const defCtx = emit(`PRODUCT_DEFINITION_CONTEXT('part definition',${ref(appCtx)},'design')`);
  const def = emit(`PRODUCT_DEFINITION('design','',${ref(formation)},${ref(defCtx)})`);
  const defShape = emit(`PRODUCT_DEFINITION_SHAPE('','',${ref(def)})`);
  const mm = emit(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const rad = emit(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const sr = emit(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = emit(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),${ref(mm)},'distance_accuracy_value','')`);
  const geoCtx = emit(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${ref(unc)}))` +
    `GLOBAL_UNIT_ASSIGNED_CONTEXT((${ref(mm)},${ref(rad)},${ref(sr)}))REPRESENTATION_CONTEXT('',''))`,
  );

  const solids: number[] = [];
  const styled: number[] = [];

  const writeSolid = (poly: Poly, label: string, rgb: Vec3) => {
    const pts = poly.verts.map(point);
    const vps = pts.map((p) => emit(`VERTEX_POINT('',${ref(p)})`));
    const edges = new Map<string, number>();
    const edge = (a: number, b: number): { id: number; same: boolean } => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}-${hi}`;
      let e = edges.get(key);
      if (e == null) {
        const d = sub(poly.verts[hi], poly.verts[lo]);
        const len = Math.hypot(d[0], d[1], d[2]);
        const vec = emit(`VECTOR('',${ref(dir(norm(d)))},${num(len)})`);
        const line = emit(`LINE('',${ref(pts[lo])},${ref(vec)})`);
        e = emit(`EDGE_CURVE('',${ref(vps[lo])},${ref(vps[hi])},${ref(line)},.T.)`);
        edges.set(key, e);
      }
      return { id: e, same: a === lo };
    };

    const faceIds = poly.faces.map((loop) => {
      const oriented = loop.map((a, i) => {
        const b = loop[(i + 1) % loop.length];
        const e = edge(a, b);
        return emit(`ORIENTED_EDGE('',*,*,${ref(e.id)},${e.same ? '.T.' : '.F.'})`);
      });
      const edgeLoop = emit(`EDGE_LOOP('',${list(oriented)})`);
      const bound = emit(`FACE_OUTER_BOUND('',${ref(edgeLoop)},.T.)`);
      const p0 = poly.verts[loop[0]];
      const p1 = poly.verts[loop[1]];
      const p2 = poly.verts[loop[2]];
      const xAxis = norm(sub(p1, p0));
      const normal = norm(cross(sub(p1, p0), sub(p2, p1)));
      const placement = emit(`AXIS2_PLACEMENT_3D('',${ref(pts[loop[0]])},${ref(dir(normal))},${ref(dir(xAxis))})`);
      const plane = emit(`PLANE('',${ref(placement)})`);
      return emit(`ADVANCED_FACE('',(${ref(bound)}),${ref(plane)},.T.)`);
    });

    const shell = emit(`CLOSED_SHELL('',${list(faceIds)})`);
    const solid = emit(`MANIFOLD_SOLID_BREP('${str(label)}',${ref(shell)})`);
    solids.push(solid);

    const colour = emit(`COLOUR_RGB('',${num(rgb[0])},${num(rgb[1])},${num(rgb[2])})`);
    const fillColour = emit(`FILL_AREA_STYLE_COLOUR('',${ref(colour)})`);
    const fill = emit(`FILL_AREA_STYLE('',(${ref(fillColour)}))`);
    const surfFill = emit(`SURFACE_STYLE_FILL_AREA(${ref(fill)})`);
    const side = emit(`SURFACE_SIDE_STYLE('',(${ref(surfFill)}))`);
    const usage = emit(`SURFACE_STYLE_USAGE(.BOTH.,${ref(side)})`);
    const assign = emit(`PRESENTATION_STYLE_ASSIGNMENT((${ref(usage)}))`);
    styled.push(emit(`STYLED_ITEM('',(${ref(assign)}),${ref(solid)})`));
  };

  for (const part of td.parts) {
    const prims = partPrims(part);
    const rgb = hexRgb(part.color);
    const centres = instances(part);
    centres.forEach((centre, ci) => {
      const origin = add(centre, scale(part.explode, explode));
      prims.forEach((prim, pi) => {
        const base = part.refDes ? `${part.refDes} ${part.name}` : part.name;
        const suffix =
          (centres.length > 1 ? ` #${ci + 1}` : '') + (prims.length > 1 ? ` wall ${pi + 1}` : '');
        writeSolid(primPoly(prim, origin), base + suffix, rgb);
      });
    });
  }

  const origin = emit(
    `AXIS2_PLACEMENT_3D('',${ref(point([0, 0, 0]))},${ref(dir([0, 0, 1]))},${ref(dir([1, 0, 0]))})`,
  );
  const rep = emit(`ADVANCED_BREP_SHAPE_REPRESENTATION('',${list([origin, ...solids])},${ref(geoCtx)})`);
  emit(`SHAPE_DEFINITION_REPRESENTATION(${ref(defShape)},${ref(rep)})`);
  emit(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',${list(styled)},${ref(geoCtx)})`);

  const stamp = td.meta.createdAt.slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Approximate teardown geometry from Teardown Lab'),'2;1');`,
    `FILE_NAME('${name}.step','${stamp}',('Teardown Lab'),(''),'Teardown Lab','Teardown Lab','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
    'ENDSEC;',
    'DATA;',
    ...out,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
