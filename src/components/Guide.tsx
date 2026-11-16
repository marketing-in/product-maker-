import { useMemo } from 'react';

import { boards } from '../lib/board';
import { fitReport } from '../lib/fit';
import type { Teardown } from '../lib/types';

export type TabId = 'plan' | 'make' | 'guide' | 'view' | 'design' | 'run' | 'arch' | 'board' | 'fit' | 'sim' | 'power' | 'bom' | 'firmware';

interface Props { td: Teardown; onOpen: (tab: TabId) => void }

const STEPS: { tab: TabId; title: string; text: string }[] = [
  { tab: 'view', title: 'Exploded view', text: 'See every part in 3D. Drag the Explode slider to pull the product apart. Click a part to read what it is and how sure we are.' },
  { tab: 'design', title: 'Design', text: 'Redesign it. Drag a part to move it or type exact positions and sizes. Resize the housing and change its wall. The fit check updates as you go, and every export follows your changes.' },
  { tab: 'run', title: 'Simulator', text: 'Operate the product. Click a button on the 3D model and watch the press travel along the wiring to the parts that respond.' },
  { tab: 'arch', title: 'Architecture', text: 'A block diagram of each board: what feeds it, what it drives, and every bus and supply rail between the blocks.' },
  { tab: 'board', title: 'Bare board', text: 'The circuit board on its own: outline, holes, where each part sits. Download a Gerber set to start a redesign in KiCad.' },
  { tab: 'fit', title: 'Fit and mould', text: 'How each housing part would be moulded (draft, wall, ribs, clamp force) and whether everything inside fits.' },
  { tab: 'sim', title: 'Parameters', text: 'Change the load, supply voltage, ambient temperature and battery size. See current, heat, temperature and runtime.' },
  { tab: 'power', title: 'Power tree', text: 'Follow the power from the input to each load, with volts, amps and watts on every path.' },
  { tab: 'bom', title: 'Bill of materials', text: 'Every part with likely part numbers, quantity and a rough cost.' },
  { tab: 'firmware', title: 'Firmware', text: 'Upload a firmware or flash file from the product. It is inspected on this computer and tied back to the chips.' },
  { tab: 'make', title: 'Make', text: 'The checks the design passes and fails, what it costs, and every file for a board house, a toolmaker or a 3D printer.' },
];

export default function Guide({ td, onOpen }: Props) {
  const info = useMemo(() => {
    const b = boards(td);
    const fit = fitReport(td);
    return {
      boards: b.length,
      placements: b.reduce((s, x) => s + x.footprints.length, 0),
      fitIssues: fit.rows.filter((r) => r.status !== 'inside').length + fit.clashes.length,
      assumed: td.parts.filter((p) => p.confidence === 'assumed').length,
      hasBattery: td.parts.some((p) => p.category === 'battery'),
      hasHousing: fit.hasHousing,
    };
  }, [td]);

  const ideas: { title: string; text: string; tab?: TabId }[] = [
    { title: 'Repair it', text: 'Find the failed part in the exploded view, check its supply in the power tree, then order the candidate part from the bill of materials.', tab: 'power' },
    { title: 'Cost it', text: 'Export the bill of materials and compare the material cost with the selling price, or with your own design.', tab: 'bom' },
    ...(info.boards ? [{ title: 'Redesign the board', text: `Download the Gerber set (${info.placements} placements) and load it into KiCad as an underlay. Replace each footprint with the real one and route it.`, tab: 'board' as TabId }] : []),
    ...(info.hasHousing ? [{ title: 'Remake the housing', text: 'Export the STEP model, open it in FreeCAD or Fusion, and apply the draft, ribs and bosses from the mould notes. 3D print it to check the fit before cutting a tool.', tab: 'fit' as TabId }] : []),
    { title: 'Design your own version', text: 'Start from a one-line description of a product that does not exist yet. Then move the board, resize the housing and check the fit in the Design tab.', tab: 'design' },
    { title: 'Show how it works', text: 'Use the simulator in a demo or a lesson: press the buttons and the LEDs, speakers and motors respond.', tab: 'run' },
    { title: 'Render a realistic prototype', text: 'Export the Blender scene. It builds the model with real materials, studio lighting and a camera, ready to render a still or the exploding animation.' },
    { title: 'Try a change before building it', text: info.hasBattery ? 'Use the simulation to see what a bigger battery, a higher load or a hot day does to runtime and temperature.' : 'Use the simulation to see what a higher load, a lower supply voltage or a hot day does to current and temperature.', tab: 'sim' },
    { title: 'Check the software', text: 'Dump the flash chip or download an update file and run it through the firmware tab to see what the product runs.', tab: 'firmware' },
    { title: 'Teach with it', text: 'Use the architecture and the exploded view to explain how this class of product is built.', tab: 'arch' },
  ];

  return (
    <div className="worktab">
      <header className="worktab-head">
        <div>
          <h2>How to use this teardown</h2>
          <p className="hint">
            Everything here comes from one model of the product, so a part you select in one view is selected in all of
            them. Start at the top and work down, or jump to what you need.
          </p>
        </div>
      </header>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.tab}>
            <span className="step-n num">{i + 1}</span>
            <div>
              <h3><button type="button" className="link" onClick={() => onOpen(s.tab)}>{s.title}</button></h3>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="loads">
        <h2>What you can do with it</h2>
        <div className="cards">
          {ideas.map((it) => (
            <article key={it.title} className="card">
              <h3>{it.title}</h3>
              <p>{it.text}</p>
              {it.tab && <button type="button" className="btn" onClick={() => onOpen(it.tab!)}>Open</button>}
            </article>
          ))}
        </div>
      </section>

      <section className="loads">
        <h2>How far to trust it</h2>
        <ul className="notes">
          <li>
            {info.assumed} of {td.parts.length} parts are marked <strong>assumed</strong>: typical for this kind of product, not
            seen. The full, half and empty discs next to each part show which is which.
          </li>
          {info.fitIssues > 0 && <li>{info.fitIssues} fit items need a look. Some are cut-outs the product really has; some are size estimates that are off.</li>}
          <li>{td.unknowns.length} open questions and {td.verifySteps.length} measurements are listed in the panel on the right when nothing is selected.</li>
          <li>Sizes are scaled from a description or photos. Measure before you cut metal, order boards or quote a price.</li>
        </ul>
      </section>
    </div>
  );
}
