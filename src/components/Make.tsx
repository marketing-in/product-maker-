import { Download } from 'lucide-react';
import { useMemo } from 'react';

import { tally, type Brief, type Check, type CheckStatus, type ImportedBoard } from '../lib/validate';
import { guessLabel } from '../lib/boardParts';
import { CATEGORY_LABEL, CATEGORY_ORDER, type Teardown } from '../lib/types';
import type { TabId } from './Guide';

const MARK: Record<CheckStatus, string> = { pass: 'Pass', warn: 'Check', fail: 'Fail', info: 'Note' };

export function Checks({ checks, onOpen, compact = false }: { checks: Check[]; onOpen: (tab: TabId) => void; compact?: boolean }) {
  if (!checks.length) return null;
  return (
    <ul className={`checks${compact ? ' is-compact' : ''}`}>
      {checks.map((c) => (
        <li key={c.id}>
          <span className={`tag check-${c.status}`}>{MARK[c.status]}</span>
          <div>
            <button type="button" className="link" onClick={() => onOpen(c.tab)}>{c.title}</button>
            <p>{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export type ExportKind = 'everything' | 'report' | 'step' | 'step-exploded' | 'blender' | 'gerber' | 'pcb-project' | 'bom' | 'json';

interface MakeProps { td: Teardown; checks: Check[]; onOpen: (tab: TabId) => void; onExport: (kind: ExportKind) => void; working?: string }

export function Make({ td, checks, onOpen, onExport, working = '' }: MakeProps) {
  const t = tally(checks);
  const cost = useMemo(() => {
    const rows = CATEGORY_ORDER.map((cat) => {
      const parts = td.parts.filter((p) => p.category === cat);
      return { cat, usd: parts.reduce((s, p) => s + (p.estCostUsd ?? 0) * p.qty, 0), lines: parts.length, pieces: parts.reduce((s, p) => s + p.qty, 0) };
    }).filter((r) => r.lines > 0);
    const total = rows.reduce((s, r) => s + r.usd, 0);
    const priced = td.parts.filter((p) => p.estCostUsd != null).length;
    return { rows, total, priced, max: Math.max(0.01, ...rows.map((r) => r.usd)) };
  }, [td]);
  const hasBoard = td.parts.some((p) => p.category === 'pcb');

  const files: { kind: ExportKind; title: string; ext: string; text: string; show: boolean }[] = [
    { kind: 'pcb-project', title: 'Board project', ext: '.zip', text: 'KiCad board file, Gerbers, drill and placement files, and a Kitspace parts list. For redesigning and routing the board.', show: hasBoard },
    { kind: 'gerber', title: 'Gerber set', ext: '.zip', text: 'Fabrication layers for every board, with the autorouted copper.', show: hasBoard },
    { kind: 'step', title: 'CAD model', ext: '.step', text: 'Every part as a named solid. Opens in FreeCAD, Fusion, SolidWorks and Onshape. For the housing and tooling.', show: true },
    { kind: 'step-exploded', title: 'CAD model, exploded', ext: '.step', text: 'The same model pulled apart, for assembly drawings.', show: true },
    { kind: 'blender', title: 'Realistic render', ext: '.py', text: 'A Blender scene with materials, lights and a camera. Press F12 for a product shot.', show: true },
    { kind: 'bom', title: 'Bill of materials', ext: '.csv', text: 'Every part with candidates, quantity, cost and power. For buying and costing.', show: true },
    { kind: 'json', title: 'Design data', ext: '.json', text: 'The whole model, including your edits. Keep it to reopen later.', show: true },
  ];

  return (
    <div className="worktab">
      <header className="worktab-head">
        <div>
          <h2>Make it</h2>
          <p className="hint">What the checks say, what it costs, and the files a board house, a toolmaker or a 3D printer needs.</p>
        </div>
      </header>

      <section className="make-hero" aria-label="Download everything">
        <article className="card card-hero">
          <h3>Everything <span className="ext">.zip</span></h3>
          <p>The product report, pictures, CAD, Blender render, board and Gerber files, bill of materials and the design data, in one download.</p>
          <button type="button" className="btn btn-primary" onClick={() => onExport('everything')} disabled={Boolean(working)}><Download size={15} />Download everything</button>
        </article>
        <article className="card card-hero">
          <h3>Product report <span className="ext">.pdf</span></h3>
          <p>Pictures, the system block diagram, power flow, control flow, assembly order, boards, housing fit and mould, bill of materials and checks.</p>
          <button type="button" className="btn" onClick={() => onExport('report')} disabled={Boolean(working)}><Download size={15} />Download the report</button>
        </article>
        {working && <p className="hint" role="status">{working}…</p>}
      </section>

      <dl className="facts facts-big">
        <div className={t.fail ? 'is-over' : ''}><dt>Checks passed</dt><dd className="num">{t.pass} of {t.scored}</dd></div>
        <div><dt>Material cost, one unit</dt><dd className="num">${cost.total.toFixed(2)}</dd><dd className="fact-sub">{cost.priced} of {td.parts.length} lines priced</dd></div>
        <div><dt>Parts</dt><dd className="num">{td.parts.reduce((s, p) => s + p.qty, 0)}</dd><dd className="fact-sub">{td.parts.length} different</dd></div>
      </dl>

      <section className="loads">
        <h2>Checks</h2>
        <p className="hint">Run on the design as it is now, including your edits. Click a name to go and look.</p>
        <Checks checks={checks} onOpen={onOpen} />
      </section>

      <section className="loads">
        <h2>Cost by group</h2>
        <table className="loads-table">
          <thead><tr><th scope="col">Group</th><th scope="col" className="r">Pieces</th><th scope="col" className="r">Cost</th><th scope="col" aria-hidden="true" /></tr></thead>
          <tbody>
            {cost.rows.map((r) => (
              <tr key={r.cat} onClick={() => onOpen('bom')}>
                <th scope="row">{CATEGORY_LABEL[r.cat]}</th>
                <td className="r num">{r.pieces}</td>
                <td className="r num">${r.usd.toFixed(2)}</td>
                <td className="bar-cell" aria-hidden="true">{r.usd > 0 && <span className="bar bar-ink" style={{ width: `${Math.max(1.5, (r.usd / cost.max) * 100)}%` }} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fineprint">Rough volume prices for comparison, not quotes. Stock and delivery times are not looked up: check them with your distributor.</p>
      </section>

      <section className="loads">
        <h2>Files</h2>
        <div className="cards">
          {files.filter((f) => f.show).map((f) => (
            <article key={f.kind} className="card">
              <h3>{f.title} <span className="ext">{f.ext}</span></h3>
              <p>{f.text}</p>
              <button type="button" className="btn" onClick={() => onExport(f.kind)}><Download size={15} />Download</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function BoardPreview({ board, designing }: { board: ImportedBoard; designing: boolean }) {
  const parts = [...board.components].sort((a, b) => b.w * b.h - a.w * a.h);
  return (
    <div className="worktab plan">
      <header className="worktab-head">
        <div>
          <h2>{board.name}</h2>
          <p className="hint">
            {board.kind === 'kicad'
              ? 'Read from the KiCad board file: the outline, every footprint with its reference and value, and the nets.'
              : 'Read from the Gerber files: the outline, the pads and the drill hits. Parts are found by grouping pads and recognised from their pattern.'}
          </p>
        </div>
      </header>
      {designing && <p className="callout">The housing is being designed round this board. The 3D model opens here when it is done.</p>}
      <dl className="facts">
        <div><dt>Outline</dt><dd className="num">{board.board.width} × {board.board.height} mm</dd></div>
        <div><dt>Thickness</dt><dd className="num">{board.board.thickness} mm</dd></div>
        <div><dt>Copper layers</dt><dd className="num">{board.layers || '–'}</dd></div>
        <div><dt>Parts</dt><dd className="num">{board.components.length}</dd></div>
        <div><dt>Mounting holes</dt><dd className="num">{board.mounting.length}</dd></div>
        <div><dt>Nets</dt><dd className="num">{board.nets || '–'}</dd></div>
      </dl>
      {board.svgTop && <div className="fab-svg" role="img" aria-label="The board, top side" dangerouslySetInnerHTML={{ __html: board.svgTop }} />}
      <section className="loads">
        <h2>Parts found</h2>
        <table className="loads-table wide">
          <thead>
            <tr>
              <th scope="col">Ref</th><th scope="col">Value</th><th scope="col">{board.kind === 'kicad' ? 'Footprint' : 'Looks like'}</th><th scope="col">Side</th>
              <th scope="col" className="r">X</th><th scope="col" className="r">Y</th><th scope="col" className="r">Size</th><th scope="col" className="r">Pads</th>
            </tr>
          </thead>
          <tbody>
            {parts.slice(0, 60).map((c, i) => (
              <tr key={i}>
                <td className="ref">{c.ref}</td><td>{c.value || '–'}</td><td>{c.footprint || guessLabel(c, board)}</td><td>{c.side}</td>
                <td className="r num">{c.x.toFixed(1)}</td><td className="r num">{c.y.toFixed(1)}</td>
                <td className="r num">{c.w.toFixed(1)} × {c.h.toFixed(1)}</td><td className="r num">{c.pads}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {parts.length > 60 && <p className="fineprint">The 60 largest of {parts.length} parts are shown.</p>}
      </section>
    </div>
  );
}

export function Plan({ brief, td, designing }: { brief: Brief; td: Teardown | null; designing: boolean }) {
  return (
    <div className="worktab plan">
      <header className="worktab-head">
        <div>
          <h2>{brief.title}</h2>
          <p className="hint">{brief.understanding}</p>
        </div>
      </header>
      {!td && (
        <p className="callout">
          {designing
            ? 'The design is being built from this plan. The 3D model, board and simulator open here when it is done.'
            : 'This is the plan. Change the choices on the left, then press “Build the design”.'}
        </p>
      )}

      <section className="loads">
        <h2>Requirements</h2>
        <ol className="reqs">{brief.requirements.map((r, i) => <li key={i}><span className="num">R{i + 1}</span>{r}</li>)}</ol>
      </section>

      <section className="loads">
        <h2>Blocks</h2>
        <ol className="blocks">
          {brief.blocks.map((b, i) => (
            <li key={i}>
              <h3>{b.name}</h3>
              <p>{b.role}</p>
              {b.parts && <p className="num">{b.parts}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section className="loads">
        <h2>Risks to check</h2>
        <ul className="notes">{brief.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </section>

      {brief.costLowUsd != null && brief.costHighUsd != null && (
        <p className="fineprint">Rough parts cost for one unit: ${Math.round(brief.costLowUsd)} to ${Math.round(brief.costHighUsd)}. The design step replaces this with a line-by-line estimate.</p>
      )}
    </div>
  );
}
