import { useEffect, useMemo, useRef, useState } from 'react';

import { fitReport, mouldNotes, type FitStatus } from '../lib/fit';
import type { ConnectionKind, Part, Teardown, Vec3 } from '../lib/types';
import Viewer3D from './Viewer3D';

const NO_WIRES: Record<ConnectionKind, boolean> = { power: false, ground: false, signal: false, rf: false, mechanical: false };

// Colours for the fit view. Each says one thing; the legend repeats it in words.
const FIT_COLOR = {
  inside: '#3f8f62',
  tight: '#e07a52',
  cutout: '#2f7de1',
  wall: '#c4421c',
  clash: '#9b4dca',
} as const;
const FIT_LABEL: Record<keyof typeof FIT_COLOR, string> = {
  inside: 'Fits',
  tight: 'Tight, under 0.5 mm',
  cutout: 'Reaches the wall: needs a cut-out',
  wall: 'Crosses the wall or sits outside',
  clash: 'Overlaps another part',
};
const MEANT_TO_PASS = ['connector', 'display', 'electromech', 'sensor', 'antenna'];

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
  const [byFit, setByFit] = useState(true);
  const [xray, setXray] = useState(true);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const amountRef = useRef(0);
  amountRef.current = amount;

  // The mould opens and closes smoothly.
  useEffect(() => {
    const from = amountRef.current;
    const to = open ? 1 : 0;
    if (from === to) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setAmount(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setAmount(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  /** What each part's colour means in the fit view. */
  const fitClass = useMemo(() => {
    const m = new Map<string, keyof typeof FIT_COLOR>();
    for (const r of fit.rows) {
      m.set(r.part.id, r.status === 'inside' ? 'inside' : r.status === 'tight' ? 'tight'
        : r.status === 'through-wall' && MEANT_TO_PASS.includes(r.part.category) ? 'cutout' : 'wall');
    }
    for (const c of fit.clashes) { m.set(c.a.id, 'clash'); m.set(c.b.id, 'clash'); }
    return m;
  }, [fit]);

  // The model as the fit view draws it: parts in their fit colour, and each housing part
  // pulled away from the centre along the direction its tool opens.
  const view = useMemo<Teardown>(() => {
    const housing = td.parts.filter((p) => p.category === 'enclosure');
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const h of housing) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], h.position[i] - h.size[i] / 2); hi[i] = Math.max(hi[i], h.position[i] + h.size[i] / 2); }
    const mid = lo.map((v, i) => (v + hi[i]) / 2);
    const pull = new Map(moulds.map((m) => [m.part.id, m]));
    const parts: Part[] = td.parts.map((p) => {
      const explode: Vec3 = [0, 0, 0];
      const m = pull.get(p.id);
      if (m) {
        const ai = ['x', 'y', 'z'].indexOf(m.pullAxis);
        const off = p.position[ai] - mid[ai];
        const sign = Math.abs(off) > 0.5 ? Math.sign(off) : m.pullSign === '-' ? -1 : 1;
        explode[ai] = sign * Math.max(30, (hi[ai] - lo[ai]) * 0.7);
      }
      const cls = fitClass.get(p.id);
      return {
        ...p,
        explode,
        color: byFit && cls ? FIT_COLOR[cls] : p.color,
        shapes: byFit && cls ? p.shapes?.map((s) => ({ ...s, color: undefined })) : p.shapes,
      };
    });
    return { ...td, parts, connections: [] };
  }, [td, moulds, fitClass, byFit]);
  const used = [...new Set(fitClass.values())];

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

      <section className="fit-3d-wrap" aria-label="Fit in 3D">
        <div className="fit-3d">
          <Viewer3D
            td={view}
            explode={amount}
            selectedId={selectedId}
            onSelect={onSelect}
            kinds={NO_WIRES}
            showValues={false}
            xray={xray}
            resetSignal={0}
          />
        </div>
        <div className="fit-3d-bar">
          <button type="button" className="btn" aria-pressed={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Close the mould' : 'Open the mould'}
          </button>
          <button type="button" className="chip" aria-pressed={byFit} onClick={() => setByFit((v) => !v)}>Colour by fit</button>
          <button type="button" className="chip" aria-pressed={xray} onClick={() => setXray((v) => !v)}>See-through housing</button>
          {byFit && (
            <ul className="fit-legend">
              {(Object.keys(FIT_COLOR) as (keyof typeof FIT_COLOR)[]).filter((k) => used.includes(k)).map((k) => (
                <li key={k}><span className="swatch" style={{ background: FIT_COLOR[k] }} aria-hidden="true" />{FIT_LABEL[k]}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="hint">
          “Open the mould” slides each housing part away along the direction its tool opens. Click a part to see its
          details; the tables below follow.
        </p>
      </section>

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
