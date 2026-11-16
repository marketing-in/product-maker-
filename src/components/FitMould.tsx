import { useMemo } from 'react';

import { fitReport, mouldNotes, type FitStatus } from '../lib/fit';
import type { Teardown } from '../lib/types';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const STATUS: Record<FitStatus, string> = {
  inside: 'Fits',
  tight: 'Tight',
  'through-wall': 'Crosses wall',
  outside: 'Outside',
};

const n1 = (v: number) => v.toFixed(1);

export default function FitMould({ td, selectedId, onSelect }: Props) {
  const moulds = useMemo(() => mouldNotes(td), [td]);
  const fit = useMemo(() => fitReport(td), [td]);

  if (!fit.hasHousing) {
    return (
      <div className="tab-empty">
        <h2>No housing in this teardown</h2>
        <p>Fit and mould checks need at least one enclosure part. Describe the case or add a photo of it, then update.</p>
      </div>
    );
  }

  const problems = fit.rows.filter((r) => r.status !== 'inside');
  const order: FitStatus[] = ['outside', 'through-wall', 'tight', 'inside'];
  const rows = [...fit.rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.clearance - b.clearance);

  return (
    <div className="worktab">
      <header className="worktab-head">
        <div>
          <h2>Fit and mould</h2>
          <p className="hint">
            How each housing part would be moulded, and whether everything inside fits. Worked out from the part sizes
            and positions with standard rules of thumb.
          </p>
        </div>
      </header>

      <dl className="facts">
        <div><dt>Housing envelope</dt><dd className="num">{fit.envelope.map(n1).join(' × ')} mm</dd></div>
        <div><dt>Thinnest wall</dt><dd className="num">{fit.wall ? `${fit.wall} mm` : '–'}</dd></div>
        <div><dt>Parts checked</dt><dd className="num">{fit.rows.length}</dd></div>
        <div><dt>Need attention</dt><dd className="num">{problems.length}</dd></div>
        <div><dt>Part clashes</dt><dd className="num">{fit.clashes.length}</dd></div>
      </dl>

      <section className="loads">
        <h2>Mould design, per housing part</h2>
        <div className="cards">
          {moulds.map((m) => (
            <article key={m.part.id} className={`card${m.part.id === selectedId ? ' is-selected' : ''}`}>
              <h3>
                <button type="button" className="link" onClick={() => onSelect(m.part.id)}>{m.part.name}</button>
              </h3>
              <p className="hint">{m.part.process ?? (m.moulded ? 'Injection moulding assumed' : 'Process not stated')}</p>
              {m.moulded ? (
                <dl className="kv">
                  <dt>Material</dt><dd>{m.resin}</dd>
                  <dt>Wall</dt><dd className="num">{n1(m.wall)} mm</dd>
                  <dt>Tool opens along</dt><dd className="num">{m.pullSign}{m.pullAxis.toUpperCase()}, {n1(m.depth)} mm deep</dd>
                  <dt>Draft</dt><dd className="num">{m.draftDeg}° per side, {m.draftTaperMm.toFixed(2)} mm taper</dd>
                  <dt>Ribs</dt><dd className="num">{n1(m.ribMm[0])} to {n1(m.ribMm[1])} mm thick</dd>
                  <dt>Shrink allowance</dt><dd className="num">{m.shrinkPct}%, cavity {m.cavityMm.map((v) => v.toFixed(2)).join(' × ')} mm</dd>
                  <dt>Part volume, mass</dt><dd className="num">{n1(m.volumeCm3)} cm³, {n1(m.massG)} g</dd>
                  <dt>Clamp force</dt><dd className="num">about {Math.max(1, Math.round(m.clampTonnes))} t ({n1(m.projectedCm2)} cm² projected)</dd>
                  <dt>Cooling time</dt><dd className="num">about {Math.round(m.coolingS)} s</dd>
                  <dt>Tool</dt><dd>{m.sideAction ? 'Two-plate with side action' : 'Two-plate, straight pull'}</dd>
                </dl>
              ) : (
                <dl className="kv">
                  <dt>Material</dt><dd>{m.part.material ?? 'Not stated'}</dd>
                  <dt>Thickness</dt><dd className="num">{n1(m.wall)} mm</dd>
                  <dt>Mass</dt><dd className="num">not estimated</dd>
                </dl>
              )}
              <ul className="notes">{m.notes.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="loads">
        <h2>Does everything fit?</h2>
        <p className="hint">
          Gap from each part to the inside face of the housing. Connectors, switches and displays are expected to reach
          the wall, where they need a cut-out.
        </p>
        <table className="loads-table wide">
          <thead>
            <tr><th scope="col">Part</th><th scope="col">Result</th><th scope="col" className="r">Gap</th><th scope="col">What it means</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.part.id} aria-selected={r.part.id === selectedId} onClick={() => onSelect(r.part.id)}>
                <th scope="row">{r.part.refDes && <span className="ref">{r.part.refDes}</span>}{r.part.name}</th>
                <td><span className={`tag tag-${r.status}`}>{STATUS[r.status]}</span></td>
                <td className="r num">{Number.isFinite(r.clearance) ? `${n1(r.clearance)} mm` : '–'}</td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="loads">
        <h2>Parts that overlap each other</h2>
        {fit.clashes.length === 0 ? (
          <p className="hint">None. No two parts occupy the same space, apart from parts sitting on their own board.</p>
        ) : (
          <table className="loads-table wide">
            <thead><tr><th scope="col">Part</th><th scope="col">Overlaps</th><th scope="col" className="r">By</th><th scope="col">Along</th></tr></thead>
            <tbody>
              {fit.clashes.map((c, i) => (
                <tr key={i} onClick={() => onSelect(c.a.id)}>
                  <th scope="row">{c.a.name}</th>
                  <td>{c.b.name}</td>
                  <td className="r num">{n1(c.depth)} mm</td>
                  <td className="num">{c.axis.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="fineprint">
        Parts are checked as boxes, so a round part reads slightly larger than it is. Clamp force, cooling time and
        shrink are textbook figures for the resin named. A toolmaker will refine all of them.
      </p>
    </div>
  );
}
