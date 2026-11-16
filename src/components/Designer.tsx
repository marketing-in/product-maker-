import { RotateCcw, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { centreInHousing, movePart, scaleHousing, setPosition, setSize, setWall } from '../lib/edit';
import { fitReport, type FitStatus } from '../lib/fit';
import type { ConnectionKind, Teardown, Vec3 } from '../lib/types';
import Viewer3D from './Viewer3D';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: Teardown) => void;
  onUndo: () => void;
  canUndo: boolean;
  onReset: () => void;
  canReset: boolean;
}

const NO_WIRES: Record<ConnectionKind, boolean> = { power: false, ground: false, signal: false, rf: false, mechanical: false };
const AX = ['X', 'Y', 'Z'] as const;
const STATUS: Record<FitStatus, string> = { inside: 'Fits', tight: 'Tight', 'through-wall': 'Crosses wall', outside: 'Outside' };

function Num({ label, value, onCommit, step = 0.5, min }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number }) {
  return (
    <label className="numfield">
      <span>{label}</span>
      <input
        type="number"
        className="num"
        value={value}
        step={step}
        min={min}
        onChange={(ev) => { const v = Number(ev.target.value); if (ev.target.value !== '' && Number.isFinite(v)) onCommit(v); }}
      />
    </label>
  );
}

export default function Designer({ td, selectedId, onSelect, onChange, onUndo, canUndo, onReset, canReset }: Props) {
  const [xray, setXray] = useState(true);
  const [withMounted, setWithMounted] = useState(true);
  const [explode, setExplode] = useState(0);
  const fit = useMemo(() => fitReport(td), [td]);
  const part = td.parts.find((p) => p.id === selectedId) ?? null;
  const row = part ? fit.rows.find((r) => r.part.id === part.id) : null;
  const clashes = part ? fit.clashes.filter((c) => c.a.id === part.id || c.b.id === part.id) : [];
  const issues = fit.rows.filter((r) => r.status === 'tight' || r.status === 'outside').length + fit.clashes.length;
  const mounted = part ? td.parts.filter((p) => p.parentId === part.id).length : 0;

  return (
    <div className="design">
      <div className="design-stage">
        <Viewer3D
          td={td}
          explode={explode}
          selectedId={selectedId}
          onSelect={onSelect}
          kinds={NO_WIRES}
          showValues={false}
          xray={xray}
          resetSignal={0}
          keepView
          onMovePart={(id, delta) => onChange(movePart(td, id, delta, withMounted))}
        />
        <div className="design-bar">
          <button type="button" className="chip" aria-pressed={xray} onClick={() => setXray((v) => !v)}>See-through housing</button>
          <button type="button" className="chip" aria-pressed={explode > 0} onClick={() => setExplode((v) => (v > 0 ? 0 : 0.6))}>Pull apart</button>
          <span className={`tag ${issues ? 'tag-tight' : 'tag-inside'}`}>{issues ? `${issues} fit ${issues === 1 ? 'problem' : 'problems'}` : 'Everything fits'}</span>
          <span className="design-bar-end">
            <button type="button" className="btn" onClick={onUndo} disabled={!canUndo}><Undo2 size={15} />Undo</button>
            <button type="button" className="btn" onClick={onReset} disabled={!canReset}><RotateCcw size={15} />Reset all</button>
          </span>
        </div>
      </div>

      <div className="design-panel">
        {!part ? (
          <>
            <div>
              <h2>Redesign it</h2>
              <p className="hint">
                Click a part, then drag it to slide it, or type exact numbers here. Turn the view to slide it in a different direction. Select a housing part to change the
                mould: its size and wall. The fit check, board files, mould notes and exports all follow your changes.
              </p>
            </div>
            {fit.hasHousing && (
              <fieldset className="fields">
                <legend>Whole housing, {td.product.dimensionsMm.map((v) => v.toFixed(0)).join(' × ')} mm</legend>
                {([0, 1, 2] as const).map((a) => (
                  <div key={a} className="stepper">
                    <span>{AX[a]}</span>
                    <button type="button" className="btn" onClick={() => onChange(scaleHousing(td, a, -2))} aria-label={`Shrink housing along ${AX[a]} by 2 mm`}>− 2 mm</button>
                    <button type="button" className="btn" onClick={() => onChange(scaleHousing(td, a, 2))} aria-label={`Grow housing along ${AX[a]} by 2 mm`}>+ 2 mm</button>
                  </div>
                ))}
              </fieldset>
            )}
          </>
        ) : (
          <>
            <div>
              <h2>{part.refDes ? <span className="ref">{part.refDes}</span> : null}{part.name}</h2>
              <p className="hint">
                {row && <><span className={`tag tag-${row.status}`}>{STATUS[row.status]}</span> {row.note} </>}
                {clashes.map((c) => `Overlaps ${c.a.id === part.id ? c.b.name : c.a.name} by ${c.depth.toFixed(1)} mm. `)}
                {part.category === 'enclosure' && 'Housing part: change its size or wall to redesign the mould.'}
              </p>
            </div>
            <fieldset className="fields">
              <legend>Position, mm</legend>
              {([0, 1, 2] as const).map((a) => (
                <Num key={a} label={AX[a]} value={part.position[a]} onCommit={(v) => onChange(setPosition(td, part.id, a, v, withMounted))} />
              ))}
            </fieldset>
            <fieldset className="fields">
              <legend>Size, mm</legend>
              {([0, 1, 2] as const).map((a) => (
                <Num key={a} label={AX[a]} value={part.size[a]} min={0.2} onCommit={(v) => onChange(setSize(td, part.id, a, v))} />
              ))}
              {part.shape === 'shell' && <Num label="Wall" value={part.wall ?? 2} step={0.1} min={0.4} onCommit={(v) => onChange(setWall(td, part.id, v))} />}
            </fieldset>
            <fieldset className="fields">
              <legend>Place</legend>
              {fit.hasHousing && part.category !== 'enclosure' && ([0, 1, 2] as const).map((a) => (
                <button key={a} type="button" className="btn" onClick={() => onChange(centreInHousing(td, part.id, a))}>Centre on {AX[a]}</button>
              ))}
              {([[0, 0, 1], [0, 0, -1]] as Vec3[]).map((d) => (
                <button key={d[2]} type="button" className="btn" onClick={() => onChange(movePart(td, part.id, d, withMounted))}>{d[2] > 0 ? 'Up' : 'Down'} 1 mm</button>
              ))}
              {mounted > 0 && (
                <label className="check">
                  <input type="checkbox" checked={withMounted} onChange={(ev) => setWithMounted(ev.target.checked)} />
                  Move the {mounted} mounted {mounted === 1 ? 'part' : 'parts'} with it
                </label>
              )}
            </fieldset>
          </>
        )}
      </div>
    </div>
  );
}
