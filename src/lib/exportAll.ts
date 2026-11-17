import { boards } from './board';
import { buildBlenderScript } from './exportBlender';
import { buildBomCsv } from './exportBom';
import type { GerberFile } from './exportGerber';
import { zipCompressed } from './exportGerber';
import { buildPcbProject } from './exportPcbProject';
import { firmwareFiles } from './firmware';
import { buildStep } from './exportStep';
import { slug } from './geometry';
import { buildReport } from './report';
import { snapshot } from './snapshot';
import type { Teardown } from './types';

// Everything for one design in a single zip: the report, CAD, render, board and data files.

const fromDataUrl = (url: string | null): Uint8Array | null => {
  if (!url) return null;
  const bin = atob(url.split(',')[1] ?? '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function buildEverything(td: Teardown, onStep: (what: string) => void = () => {}): Promise<{ name: string; bytes: Uint8Array; files: number }> {
  const base = slug(td.product.name);
  const files: GerberFile[] = [];
  const add = (name: string, text: string) => files.push({ name: `${base}/${name}`, text });
  const pause = () => new Promise((r) => setTimeout(r, 0));

  onStep('Writing the product report');
  await pause();
  files.push({ name: `${base}/${base}-report.pdf`, text: '', data: await buildReport(td) });

  onStep('Drawing the pictures');
  await pause();
  for (const [name, opts] of [['assembled', { explode: 0 }], ['exploded', { explode: 1 }]] as const) {
    const img = fromDataUrl(snapshot(td, opts));
    if (img) files.push({ name: `${base}/images/${base}-${name}.jpg`, text: '', data: img });
  }

  onStep('Writing the CAD and render files');
  await pause();
  add(`cad/${base}.step`, buildStep(td, 0));
  add(`cad/${base}-exploded.step`, buildStep(td, 1));
  add(`render/${base}-blender.py`, buildBlenderScript(td));

  onStep('Writing the board files');
  await pause();
  const brds = boards(td);
  if (brds.length) for (const f of buildPcbProject(td, brds)) add(`pcb/${f.name}`, f.text);

  if (td.firmware) for (const f of firmwareFiles(td.firmware, td, 'firmware')) add(f.name, f.text);
  add(`bom/${base}-bom.csv`, buildBomCsv(td));
  add(`data/${base}-teardown.json`, JSON.stringify(td, null, 2));
  add('README.txt', `${td.product.name}
Everything for this design, made by Teardown Lab on ${new Date().toISOString().slice(0, 10)}.

${base}-report.pdf      The product report: pictures, block diagram, power flow, control flow,
                        assembly order, boards, housing fit and mould, bill of materials, checks.
images/                 Pictures of the product, assembled and exploded.
cad/                    STEP models, assembled and exploded. Opens in FreeCAD, Fusion, SolidWorks, Onshape.
render/                 Blender scene script: Scripting tab, open, Run, then F12 for a product shot.
firmware/               ${td.firmware ? `PlatformIO project for ${td.firmware.controller}: pio run -t upload. Not compiled or tested by Teardown Lab.` : 'Not written yet. Use Write the firmware in the Firmware tab, then download again.'}
pcb/                    ${brds.length ? 'KiCad board files, Gerber and drill files for every board, and a Kitspace parts list.' : 'No circuit board in this design.'}
bom/                    Bill of materials (CSV).
data/                   The whole design as JSON. Keep it to reopen or compare later.

Sizes, part numbers and electrical values are engineering estimates until measured.
Board copper is an autorouted first pass. Review it in KiCad before ordering boards.
`);

  onStep('Packing the zip');
  await pause();
  return { name: `${base}-everything.zip`, bytes: await zipCompressed(files), files: files.length };
}
