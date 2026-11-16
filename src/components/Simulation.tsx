import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { fmtA, fmtW } from '../lib/power';
import { defaults, simulate, sweep, type SimParams } from '../lib/simulate';
import type { Teardown } from '../lib/types';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function hours(h: number | null): string {
  if (h == null) return '–';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export default function Simulation({ td, selectedId, onSelect }: Props) {
  const base = useMemo(() => defaults(td), [td]);
  const [q, setQ] = useState<SimParams>(base);
  useEffect(() => setQ(base), [base]);

  const r = useMemo(() => simulate(td, q), [td, q]);
  const curve = useMemo(() => sweep(td, q), [td, q]);

  if (r.parts.length === 0) {
    return (
      <div className="tab-empty">
        <h2>Nothing to simulate yet</h2>
        <p>The simulation runs on the power paths. This teardown has none. Say how the product is powered, then update it.</p>
      </div>
    );
  }

  const slider = (
    key: keyof SimParams, label: string, min: number, max: number, step: number, show: (v: number) => string, help: string,
  ) => (
    <div className="param">
      <label htmlFor={`sim-${key}`}>{label}</label>
      <output htmlFor={`sim-${key}`} className="num">{show(q[key])}</output>
      <input
        id={`sim-${key}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={q[key]}
        style={{ '--fill': `${((q[key] - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(ev) => setQ((p) => ({ ...p, [key]: Number(ev.target.value) }))}
      />
      <p className="fineprint">{help}</p>
    </div>
  );

  // Chart: hottest part temperature against load.
  const CW = 520;
  const CH = 190;
  const m = { l: 44, r: 14, t: 12, b: 30 };
  const tMax = Math.max(100, ...curve.map((c) => c.tempC)) * 1.05;
  const tMin = Math.min(q.ambientC, 20);
  const cx = (load: number) => m.l + ((load - 0.1) / 1.4) * (CW - m.l - m.r);
  const cy = (t: number) => m.t + (1 - (t - tMin) / (tMax - tMin)) * (CH - m.t - m.b);
  const path = curve.map((c, i) => `${i ? 'L' : 'M'}${cx(c.load).toFixed(1)},${cy(c.tempC).toFixed(1)}`).join(' ');
  const limit = r.hottest?.limitC ?? 85;
  const maxTemp = Math.max(1, ...r.parts.map((p) => p.tempC - q.ambientC));

  return (
    <div className="worktab">
      <header className="worktab-head">
        <div>
          <h2>Parameter simulation</h2>
          <p className="hint">
            Move a slider and the numbers update: input current, heat in each part, a rough temperature for each part
            and battery runtime.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setQ(base)}>
          <RotateCcw size={15} />
          Reset
        </button>
      </header>

      <div className="sim-grid">
        <section className="params" aria-label="Parameters">
          {slider('load', 'Peak load', 0.1, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`, '100% is the peak stated in the teardown. Above that is an overload.')}
          {slider('duty', 'Time at peak', 0.05, 1, 0.05, (v) => `${Math.round(v * 100)}%`, 'Share of the time the product runs at that peak. Music is about 30%.')}
          {slider('supplyV', 'Supply voltage', 3, 24, 0.1, (v) => `${v.toFixed(1)} V`, 'Voltage at the input. Lower voltage means more current for the same power.')}
          {slider('ambientC', 'Ambient temperature', 0, 60, 1, (v) => `${v} °C`, 'Air temperature round the product.')}
          {r.battery && slider('capacityMah', 'Battery capacity', 200, 10000, 100, (v) => `${v} mAh`, 'Rated capacity of the cell or pack.')}
        </section>

        <section aria-label="Results">
          <dl className="facts facts-big">
            <div><dt>Input power, peak</dt><dd className="num">{fmtW(r.inputW)}</dd></div>
            <div><dt>Input current, peak</dt><dd className="num">{fmtA(r.inputA)}</dd></div>
            <div><dt>Heat inside, average</dt><dd className="num">{fmtW(r.heatW)}</dd></div>
            <div><dt>Air inside the housing</dt><dd className="num">+{r.airRiseC.toFixed(1)} °C</dd></div>
            {r.hottest && (
              <div className={r.hottest.over ? 'is-over' : ''}>
                <dt>Hottest part</dt>
                <dd className="num">{Math.round(r.hottest.tempC)} °C</dd>
                <dd className="fact-sub">{r.hottest.part.refDes ?? r.hottest.part.name}{r.hottest.over ? `, over its ${r.hottest.limitC} °C limit` : ''}</dd>
              </div>
            )}
            {r.battery && (
              <div className={r.battery.cRate > 2 ? 'is-over' : ''}>
                <dt>Battery runtime</dt>
                <dd className="num">{hours(r.battery.runtimeH)}</dd>
                <dd className="fact-sub">{fmtW(r.battery.avgDrawW)} average, {r.battery.cRate.toFixed(2)} C at peak</dd>
              </div>
            )}
          </dl>

          <figure className="chart">
            <figcaption>Hottest part against load, at {Math.round(q.duty * 100)}% time at peak</figcaption>
            <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" role="img" aria-label="Line chart of hottest part temperature against load">
              {[tMin, (tMin + tMax) / 2, tMax].map((t) => (
                <g key={t}>
                  <line x1={m.l} x2={CW - m.r} y1={cy(t)} y2={cy(t)} className="chart-grid" />
                  <text x={m.l - 6} y={cy(t) + 4} textAnchor="end" className="chart-tick">{Math.round(t)} °C</text>
                </g>
              ))}
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5].map((l) => (
                <text key={l} x={cx(l)} y={CH - 10} textAnchor="middle" className="chart-tick">{Math.round(l * 100)}%</text>
              ))}
              {limit < tMax && (
                <g>
                  <line x1={m.l} x2={CW - m.r} y1={cy(limit)} y2={cy(limit)} className="chart-limit" />
                  <text x={CW - m.r} y={cy(limit) - 5} textAnchor="end" className="chart-tick">limit {limit} °C</text>
                </g>
              )}
              <path d={path} className="chart-line" />
              <circle cx={cx(q.load)} cy={cy(r.hottest?.tempC ?? q.ambientC)} r={5} className="chart-dot" />
            </svg>
          </figure>
        </section>
      </div>

      <section className="loads">
        <h2>Heat and temperature, part by part</h2>
        <table className="loads-table wide">
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col" className="r">Heat at peak</th>
              <th scope="col" className="r">Heat, average</th>
              <th scope="col" className="r">Rise</th>
              <th scope="col" className="r">Temperature</th>
              <th scope="col" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {r.parts.map((p) => (
              <tr key={p.part.id} aria-selected={p.part.id === selectedId} onClick={() => onSelect(p.part.id)}>
                <th scope="row">{p.part.refDes && <span className="ref">{p.part.refDes}</span>}{p.part.name}</th>
                <td className="r num">{fmtW(p.heatW)}</td>
                <td className="r num">{fmtW(p.avgHeatW)}</td>
                <td className="r num">+{p.riseC.toFixed(1)} °C</td>
                <td className="r num">{p.over ? <span className="tag tag-outside">{Math.round(p.tempC)} °C</span> : `${Math.round(p.tempC)} °C`}</td>
                <td className="bar-cell" aria-hidden="true">
                  <span className="bar" style={{ width: `${Math.max(1.5, ((p.tempC - q.ambientC) / maxTemp) * 100)}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="fineprint">
        A first-order model: still air, each part cools through its own surface and some board copper, and the housing
        warms the air inside. Use it to rank parts and to see which way a change moves things. Confirm any part near
        its limit with a thermocouple or a thermal camera.
      </p>
    </div>
  );
}
