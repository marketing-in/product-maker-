import type { BoardModel } from './board';
import { buildGerberSet, type GerberFile } from './exportGerber';
import { slug } from './geometry';
import { routeBoard } from './route';
import type { Teardown } from './types';

// A PCB project folder built from a reconstructed board:
//   - a native KiCad board file (.kicad_pcb, KiCad 6 format, opens in 6 and newer)
//     with the outline, one footprint per part, pads and nets, so KiCad draws
//     the ratsnest and the board is ready to route;
//   - the Gerber set;
//   - the files Kitspace (kitspace.org) reads to publish a project:
//     kitspace.yaml and 1-click-bom.tsv.
//
// Same limits as the Gerbers: positions are estimates, pads are typical for the
// part class, and there is no routing.

const q = (s: string) => `"${s.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** A stable UUID-shaped id from a string, so the file is the same on every export. */
function uuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2246822519) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const OX = 100;
const OY = 100;

export function buildKicadPcb(b: BoardModel, product: string): string {
  // KiCad's Y axis points down. The board's lower-left corner lands at (OX, OY + height).
  const X = (x: number) => n(OX + x);
  const Y = (y: number) => n(OY + b.height - y);

  // One net per connection. Each end takes the next free pad on its part.
  const netNames = new Map<string, number>();
  const nets: string[] = [];
  const padNet = new Map<string, { code: number; name: string }[]>();
  for (const c of b.nets) {
    let name = c.label.replace(/[^\w+\-./ ]/g, '').trim().replace(/\s+/g, '_') || c.id;
    if (netNames.has(name)) name = `${name}_${c.id}`;
    const code = nets.length + 1;
    netNames.set(name, code);
    nets.push(name);
    for (const id of [c.from, c.to]) padNet.set(id, [...(padNet.get(id) ?? []), { code, name }]);
  }

  const font = '(effects (font (size 0.8 0.8) (thickness 0.12)))';
  const out: string[] = [
    '(kicad_pcb (version 20211014) (generator teardown-lab)',
    `  (general (thickness ${n(b.thickness)}))`,
    '  (paper "A4")',
    `  (title_block (title ${q(`${product} ${b.part.refDes ?? ''}`)}) (comment 1 "Reconstructed by Teardown Lab. Positions are estimates. No routing."))`,
    '  (layers',
    '    (0 "F.Cu" signal) (31 "B.Cu" signal)',
    '    (34 "B.Paste" user) (35 "F.Paste" user) (36 "B.SilkS" user) (37 "F.SilkS" user)',
    '    (38 "B.Mask" user) (39 "F.Mask" user) (44 "Edge.Cuts" user)',
    '    (46 "B.CrtYd" user) (47 "F.CrtYd" user) (48 "B.Fab" user) (49 "F.Fab" user)',
    '  )',
    '  (setup (pad_to_mask_clearance 0.05))',
    '  (net 0 "")',
    ...nets.map((name, i) => `  (net ${i + 1} ${q(name)})`),
  ];

  const first = new Set<string>();
  for (const f of b.footprints) {
    const S = f.side === 'top' ? 'F' : 'B';
    // Nets attach to the first placement of a part with several copies.
    const mine = first.has(f.partId) ? [] : (padNet.get(f.partId) ?? []);
    first.add(f.partId);
    const hw = f.w / 2;
    const hh = f.h / 2;
    out.push(
      `  (footprint ${q(`TeardownLab:${f.ref}`)} (layer "${S}.Cu") (tstamp ${uuid(`fp${b.part.id}${f.key}`)})`,
      `    (at ${X(f.x)} ${Y(f.y)})`,
      `    (descr ${q(f.name)})`,
      `    (attr ${f.round ? 'through_hole' : 'smd'})`,
      `    (fp_text reference ${q(f.ref)} (at 0 ${n(-hh - 1)}) (layer "${S}.SilkS") ${font} (tstamp ${uuid(`r${f.key}`)}))`,
      `    (fp_text value ${q(f.name)} (at 0 ${n(hh + 1)}) (layer "${S}.Fab") ${font} (tstamp ${uuid(`v${f.key}`)}))`,
      f.round
        ? `    (fp_circle (center 0 0) (end ${n(hw)} 0) (layer "${S}.SilkS") (width 0.12) (fill none) (tstamp ${uuid(`o${f.key}`)}))`
        : `    (fp_rect (start ${n(-hw)} ${n(-hh)}) (end ${n(hw)} ${n(hh)}) (layer "${S}.SilkS") (width 0.12) (fill none) (tstamp ${uuid(`o${f.key}`)}))`,
      `    (fp_rect (start ${n(-hw - 0.25)} ${n(-hh - 0.25)}) (end ${n(hw + 0.25)} ${n(hh + 0.25)}) (layer "${S}.CrtYd") (width 0.05) (fill none) (tstamp ${uuid(`c${f.key}`)}))`,
    );
    f.pads.forEach((p, i) => {
      const net = mine[i] ? ` (net ${mine[i].code} ${q(mine[i].name)})` : '';
      out.push(f.round
        ? `    (pad "${i + 1}" thru_hole circle (at ${n(p.x)} ${n(-p.y)}) (size ${n(p.w)} ${n(p.h)}) (drill ${n(p.w * 0.5)}) (layers "*.Cu" "*.Mask")${net} (tstamp ${uuid(`p${f.key}${i}`)}))`
        : `    (pad "${i + 1}" smd rect (at ${n(p.x)} ${n(-p.y)}) (size ${n(p.w)} ${n(p.h)}) (layers "${S}.Cu" "${S}.Paste" "${S}.Mask")${net} (tstamp ${uuid(`p${f.key}${i}`)}))`);
    });
    out.push('  )');
  }

  b.holes.forEach((h, i) => out.push(
    `  (footprint "TeardownLab:MountingHole" (layer "F.Cu") (tstamp ${uuid(`h${b.part.id}${i}`)})`,
    `    (at ${X(h.x)} ${Y(h.y)})`,
    '    (attr exclude_from_pos_files exclude_from_bom)',
    `    (fp_text reference ${q(`H${i + 1}`)} (at 0 ${n(-h.d)}) (layer "F.SilkS") ${font} (tstamp ${uuid(`hr${i}`)}))`,
    `    (fp_text value "MountingHole" (at 0 ${n(h.d)}) (layer "F.Fab") ${font} (tstamp ${uuid(`hv${i}`)}))`,
    `    (pad "" np_thru_hole circle (at 0 0) (size ${n(h.d)} ${n(h.d)}) (drill ${n(h.d)}) (layers "*.Cu" "*.Mask") (tstamp ${uuid(`hp${i}`)}))`,
    '  )',
  ));

  // Autorouted copper, on the nets declared above.
  const routing = routeBoard(b);
  const netOf = new Map(b.nets.map((c, i) => [c.id, i + 1]));
  routing.traces.forEach((t, ti) => {
    for (let i = 1; i < t.points.length; i++) {
      const [x0, y0] = t.points[i - 1];
      const [x1, y1] = t.points[i];
      out.push(`  (segment (start ${X(x0)} ${Y(y0)}) (end ${X(x1)} ${Y(y1)}) (width ${n(t.width)}) (layer "${t.layer === 'top' ? 'F' : 'B'}.Cu") (net ${netOf.get(t.net) ?? 0}) (tstamp ${uuid(`seg${b.part.id}${ti}-${i}`)}))`);
    }
  });
  routing.vias.forEach((v, i) => out.push(
    `  (via (at ${X(v.x)} ${Y(v.y)}) (size ${n(v.pad)}) (drill ${n(v.drill)}) (layers "F.Cu" "B.Cu") (net ${netOf.get(v.net) ?? 0}) (tstamp ${uuid(`via${b.part.id}${i}`)}))`,
  ));

  out.push(
    `  (gr_rect (start ${X(0)} ${Y(b.height)}) (end ${X(b.width)} ${Y(0)}) (layer "Edge.Cuts") (width 0.1) (fill none) (tstamp ${uuid(`edge${b.part.id}`)}))`,
    ')',
    '',
  );
  return out.join('\n');
}

/** Kitspace's 1-click BOM: tab-separated, one line per part, with a column per distributor. */
export function buildOneClickBom(td: Teardown): string {
  const cell = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  const head = ['References', 'Qty', 'Description', 'Digikey', 'Mouser', 'RS', 'Newark', 'Farnell', 'LCSC', 'Manufacturer', 'MPN'];
  const rows = td.parts
    .filter((p) => p.refDes && p.category !== 'pcb')
    .map((p) => [
      p.refDes ?? p.id, p.qty,
      [p.name, p.package, p.confidence === 'observed' ? '' : `(${p.confidence})`].filter(Boolean).join(', '),
      '', '', '', '', '', '', '', (p.candidates ?? [])[0] ?? '',
    ].map(cell).join('\t'));
  return [head.join('\t'), ...rows].join('\n') + '\n';
}

export function buildPcbProject(td: Teardown, all: BoardModel[]): GerberFile[] {
  const files: GerberFile[] = [];
  const multi = all.length > 1;
  for (const b of all) {
    const name = slug(b.part.refDes ?? b.part.id);
    const dir = multi ? `${name}/` : '';
    files.push({ name: `${dir}${slug(td.product.name)}-${name}.kicad_pcb`, text: buildKicadPcb(b, td.product.name) });
    for (const f of buildGerberSet(b, td.product.name)) files.push({ name: `${dir}gerbers/${f.name}`, text: f.text });
  }
  const main = all[0];
  const mainDir = multi && main ? `${slug(main.part.refDes ?? main.part.id)}/` : '';
  files.push({ name: '1-click-bom.tsv', text: buildOneClickBom(td) });
  files.push({
    name: 'kitspace.yaml',
    text: [
      `summary: ${JSON.stringify(td.product.summary.slice(0, 140))}`,
      `color: green`,
      `bom: 1-click-bom.tsv`,
      `gerbers: ${mainDir}gerbers`,
      ...(main ? ['eda:', '  type: kicad', `  pcb: ${mainDir}${slug(td.product.name)}-${slug(main.part.refDes ?? main.part.id)}.kicad_pcb`] : []),
      '',
    ].join('\n'),
  });
  files.push({
    name: 'README.md',
    text: `# ${td.product.name}: board reconstruction

Made by Teardown Lab from a description or photos. ${td.product.summary}

## What is here

| File | Use |
| --- | --- |
| \`*.kicad_pcb\` | Open in KiCad 6 or newer. Outline, one footprint per part, pads, nets, and autorouted traces and vias on two layers. |
| \`gerbers/\` | Gerber and drill files. See the README inside for the layer list. |
| \`1-click-bom.tsv\` | Parts list in the Kitspace 1-click BOM format. Fill in the distributor columns to buy the parts in one go. |
| \`kitspace.yaml\` | Lets kitspace.org show this folder as a project once it is in a public git repository. |

## Before you build anything

- Part positions and the outline are **estimates**. Measure the real board.
- Pads are **typical for each part class**, not the real land patterns. Replace each footprint with the right one from the KiCad library.
- The copper traces are an **autorouted first pass**, not checked for current, impedance or noise, and not the original routing of a photographed product. Review and re-route.
- Part numbers in the BOM are candidates until a marking is read.
`,
  });
  return files;
}
