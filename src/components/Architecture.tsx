import { useMemo } from 'react';

import { connValues, fmtV } from '../lib/power';
import { archLayout as layout, BH, BW, clip, PAD } from '../lib/archLayout';
import { KIND_LABEL, type ConnectionKind, type Teardown } from '../lib/types';
import { KIND_COLOR } from './Viewer3D';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function Architecture({ td, selectedId, onSelect }: Props) {
  const L = useMemo(() => layout(td), [td]);
  const pos = new Map(L.blocks.map((b) => [b.id, b]));
  const frame = new Map(L.frames.map((f) => [f.id, f]));

  if (L.edges.length === 0) {
    return (
      <div className="tab-empty">
        <h2>No connections yet</h2>
        <p>The architecture is drawn from the connections between parts. Add a photo of the board, then update.</p>
      </div>
    );
  }

  // Where an edge meets a block or a board frame.
  const anchor = (id: string) => {
    const b = pos.get(id);
    if (b) return { x: b.x + BW / 2, y: b.y + BH / 2, hw: BW / 2 };
    const f = frame.get(id);
    return f ? { x: f.x + f.w / 2, y: f.y + 12, hw: f.w / 2 } : null;
  };

  const rails = [...new Set(L.edges.filter((e) => e.kind === 'power' && e.voltageV != null).map((e) => e.voltageV!))].sort((a, b) => b - a);
  const buses = [...new Set(L.edges.filter((e) => e.kind !== 'power' && e.protocol).map((e) => e.protocol!))];
  const counts = (Object.keys(KIND_LABEL) as ConnectionKind[]).filter((k) => k !== 'mechanical').map((k) => ({ k, n: L.edges.filter((e) => e.kind === k).length }));
  const name = (id: string) => { const p = L.byId.get(id); return p ? `${p.refDes ? `${p.refDes} ` : ''}${p.name}` : id; };

  return (
    <div className="worktab">
      <header className="worktab-head">
        <div>
          <h2>Board-level architecture</h2>
          <p className="hint">
            Each board and the blocks on it, with what feeds them on the left and what they drive on the right. Lines are
            coloured by kind. Click a block to see only its links and their names.
          </p>
        </div>
      </header>

      <dl className="facts">
        <div><dt>Boards</dt><dd className="num">{L.frames.length}</dd></div>
        <div><dt>Blocks</dt><dd className="num">{L.blocks.length}</dd></div>
        <div><dt>Supply rails</dt><dd className="num">{rails.length ? rails.map((v) => fmtV(v)).join(', ') : '–'}</dd></div>
        {counts.map(({ k, n }) => (
          <div key={k}>
            <dt><span className="kind-dot" style={{ background: KIND_COLOR[k] }} aria-hidden="true" /> {KIND_LABEL[k]}</dt>
            <dd className="num">{n}</dd>
          </div>
        ))}
      </dl>

      <div className="board-scroll">
        <svg className="arch" viewBox={`0 0 ${L.width} ${L.height}`} width={L.width} height={L.height} role="group" aria-label="Block diagram">
          {L.frames.map((f) => (
            <g key={f.id} className={`arch-frame${f.id === selectedId ? ' is-selected' : ''}`} onClick={() => onSelect(f.id === selectedId ? null : f.id)}>
              <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={8} />
              <text x={f.x + PAD} y={f.y + 19}>{clip(f.label, 40)}</text>
            </g>
          ))}
          {L.edges.map((e) => {
            const a = anchor(e.from);
            const b = anchor(e.to);
            if (!a || !b) return null;
            const active = !selectedId || e.from === selectedId || e.to === selectedId;
            const dir = b.x >= a.x ? 1 : -1;
            const sameCol = Math.abs(a.x - b.x) < 4;
            const x1 = a.x + (sameCol ? a.hw : dir * a.hw);
            const x2 = b.x + (sameCol ? b.hw : -dir * b.hw);
            const bend = sameCol ? 34 : Math.max(24, Math.abs(x2 - x1) / 2);
            const d = sameCol
              ? `M${x1},${a.y} C${x1 + bend},${a.y} ${x2 + bend},${b.y} ${x2},${b.y}`
              : `M${x1},${a.y} C${x1 + dir * bend},${a.y} ${x2 - dir * bend},${b.y} ${x2},${b.y}`;
            const mx = sameCol ? x1 + bend * 0.75 : (x1 + x2) / 2;
            return (
              <g key={e.id} className={`arch-edge${active ? '' : ' is-dim'}`}>
                <path d={d} stroke={KIND_COLOR[e.kind]} strokeWidth={e.kind === 'power' ? 2.4 : 1.5} />
                <circle cx={x2} cy={b.y} r={3} fill={KIND_COLOR[e.kind]} />
                {selectedId && active && <text x={mx} y={(a.y + b.y) / 2 - 4} textAnchor="middle">{clip(e.label, 24)}</text>}
                <title>{e.label} {connValues(e)}</title>
              </g>
            );
          })}
          {L.blocks.map((b) => {
            const p = L.byId.get(b.id)!;
            const sel = b.id === selectedId;
            return (
              <g
                key={b.id}
                className={`pt-node${sel ? ' is-selected' : ''}`}
                transform={`translate(${b.x},${b.y})`}
                role="button"
                tabIndex={0}
                aria-label={name(b.id)}
                onClick={() => onSelect(sel ? null : b.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(sel ? null : b.id); } }}
              >
                <rect width={BW} height={BH} rx={6} />
                <text x={10} y={17} className="pt-node-name">{clip(name(b.id), 21)}</text>
                <text x={10} y={33} className="pt-node-sub">{clip(p.package ?? p.category, 20)}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <section className="loads">
        <h2>Interfaces</h2>
        {buses.length > 0 && <p className="hint">Buses and signal types found: {buses.join(' · ')}.</p>}
        <table className="loads-table wide">
          <thead>
            <tr>
              <th scope="col">From</th><th scope="col">To</th><th scope="col">Kind</th><th scope="col">Name</th>
              <th scope="col">Protocol or medium</th><th scope="col" className="r">Values</th>
            </tr>
          </thead>
          <tbody>
            {L.edges.map((e) => (
              <tr key={e.id} aria-selected={e.from === selectedId || e.to === selectedId} onClick={() => onSelect(e.from)}>
                <th scope="row">{name(e.from)}</th>
                <td>{name(e.to)}</td>
                <td className="nowrap"><span className="kind-dot" style={{ background: KIND_COLOR[e.kind] }} aria-hidden="true" /> {KIND_LABEL[e.kind]}</td>
                <td>{e.label}</td>
                <td>{e.protocol ?? e.medium ?? ''}</td>
                <td className="r num">{connValues(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
