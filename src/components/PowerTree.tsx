import { useMemo } from 'react';

import { connPower, connValues, fmtW, partPower, powerTree } from '../lib/power';
import type { Teardown } from '../lib/types';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const NODE_W = 188;
const NODE_H = 52;
const COL_GAP = 44;
const LEVEL_GAP = 76;
const PAD = 16;

export default function PowerTree({ td, selectedId, onSelect }: Props) {
  const layout = useMemo(() => powerTree(td), [td]);
  const power = useMemo(() => partPower(td), [td]);
  const byId = useMemo(() => new Map(td.parts.map((p) => [p.id, p])), [td]);

  if (layout.edges.length === 0) {
    return (
      <div className="tab-empty">
        <h2>No power paths yet</h2>
        <p>This teardown has no power connections. Add a photo of the board or say how the product is powered, then update it.</p>
      </div>
    );
  }

  // Top to bottom: the input at the top, each conversion stage a level down.
  const perLevel = new Map<number, number>();
  layout.nodes.forEach((n) => perLevel.set(n.depth, Math.max(perLevel.get(n.depth) ?? 0, n.row + 1)));
  const fullW = layout.rowCount * NODE_W + (layout.rowCount - 1) * COL_GAP;
  const pos = new Map(
    layout.nodes.map((n) => {
      const count = perLevel.get(n.depth) ?? 1;
      const levelW = count * NODE_W + (count - 1) * COL_GAP;
      return [n.id, {
        x: PAD + (fullW - levelW) / 2 + n.row * (NODE_W + COL_GAP),
        y: PAD + n.depth * (NODE_H + LEVEL_GAP),
      }];
    }),
  );
  const width = PAD * 2 + fullW;
  const height = PAD * 2 + layout.depthCount * NODE_H + (layout.depthCount - 1) * LEVEL_GAP;
  const maxW = Math.max(0.001, ...layout.edges.map((e) => connPower(e) ?? 0));

  const loads = [...power.entries()]
    .filter(([, v]) => v.hasIn)
    .map(([id, v]) => ({ id, ...v, part: byId.get(id) }))
    .filter((r) => r.part)
    .sort((a, b) => b.usedW - a.usedW);
  const maxUsed = Math.max(0.001, ...loads.map((l) => l.usedW));

  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  return (
    <div className="powertab">
      <div className="powertree-scroll">
        <svg
          className="powertree"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="group"
          aria-label="Power tree, from the input at the top to the loads at the bottom"
        >
          {layout.edges.map((e) => {
            const a = pos.get(e.from)!;
            const b = pos.get(e.to)!;
            const x1 = a.x + NODE_W / 2;
            const y1 = a.y + NODE_H;
            const x2 = b.x + NODE_W / 2;
            const y2 = b.y;
            const dy = y2 > y1 ? (y2 - y1) / 2 : 50;
            const d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
            const w = connPower(e) ?? 0;
            const active = !selectedId || e.from === selectedId || e.to === selectedId;
            const values = connValues(e);
            return (
              <g key={e.id} className={`pt-edge${active ? '' : ' is-dim'}`}>
                <path d={d} strokeWidth={1.5 + (w / maxW) * 7} />
                <text x={x2} y={y2 - 25} textAnchor="middle" className="pt-edge-name">
                  {clip(e.label, 22)}
                </text>
                {values && (
                  <text x={x2} y={y2 - 10} textAnchor="middle" className="pt-edge-values">
                    {values}
                  </text>
                )}
              </g>
            );
          })}
          {layout.nodes.map((n) => {
            const p = byId.get(n.id);
            const xy = pos.get(n.id)!;
            const pw = power.get(n.id);
            const sub = !pw?.hasIn
              ? `Source · supplies ${fmtW(pw?.outW ?? 0)}`
              : pw.hasOut
                ? `In ${fmtW(pw.inW)} · out ${fmtW(pw.outW)}`
                : `Load · ${fmtW(pw.inW)}`;
            return (
              <g
                key={n.id}
                className={`pt-node${n.id === selectedId ? ' is-selected' : ''}`}
                transform={`translate(${xy.x},${xy.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${p?.name ?? n.id}. ${sub}`}
                onClick={() => onSelect(n.id === selectedId ? null : n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onSelect(n.id === selectedId ? null : n.id);
                  }
                }}
              >
                <rect width={NODE_W} height={NODE_H} rx={6} />
                <text x={12} y={21} className="pt-node-name">
                  {clip(`${p?.refDes ? `${p.refDes} ` : ''}${p?.name ?? n.id}`, 25)}
                </text>
                <text x={12} y={39} className="pt-node-sub">{sub}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <section className="loads" aria-label="Where the power goes">
        <h2>Where the power goes</h2>
        <p className="hint">
          Peak figures for each path. “Uses here” is what a part receives minus what it passes on: heat in a regulator,
          sound in a driver, light in an LED.
        </p>
        <table className="loads-table">
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col" className="r">Receives</th>
              <th scope="col" className="r">Passes on</th>
              <th scope="col" className="r">Uses here</th>
              <th scope="col" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => (
              <tr key={l.id} aria-selected={l.id === selectedId} onClick={() => onSelect(l.id)}>
                <th scope="row">
                  <button type="button" className="link" onClick={(ev) => { ev.stopPropagation(); onSelect(l.id); }}>
                    {l.part!.refDes && <span className="ref">{l.part!.refDes}</span>}
                    {l.part!.name}
                  </button>
                </th>
                <td className="r num">{fmtW(l.inW)}</td>
                <td className="r num">{l.hasOut ? fmtW(l.outW) : '–'}</td>
                <td className="r num">{l.part!.category === 'battery' ? 'stores' : fmtW(l.usedW)}</td>
                <td className="bar-cell" aria-hidden="true">
                  {l.usedW > 0 && (
                    <span className="bar" style={{ width: `${Math.max(1.5, (l.usedW / maxUsed) * 100)}%` }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
