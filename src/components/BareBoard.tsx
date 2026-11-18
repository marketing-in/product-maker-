import { apiFetch } from '../lib/api';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { boards } from '../lib/board';
import { buildGerberSet, downloadBytes, zip } from '../lib/exportGerber';
import { buildPcbProject } from '../lib/exportPcbProject';
import { routeBoard } from '../lib/route';
import { slug } from '../lib/geometry';
import type { Teardown } from '../lib/types';
import Viewer3D, { KIND_COLOR, LAYERS, layerGap, type LayerKey } from './Viewer3D';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function BareBoard({ td, selectedId, onSelect }: Props) {
  const all = useMemo(() => boards(td), [td]);
  const [index, setIndex] = useState(0);
  const [side, setSide] = useState<'top' | 'bottom'>('top');
  const [showNets, setShowNets] = useState(false);
  const [showCopper, setShowCopper] = useState(true);
  const [bare, setBare] = useState(false);
  const [mode, setMode] = useState<'layout' | '3d' | 'fab'>('layout');
  const [fab, setFab] = useState<{ top: string; bottom: string } | null>(null);
  const [fabError, setFabError] = useState('');
  const [shownLayers, setShownLayers] = useState<Record<LayerKey, boolean>>(() => Object.fromEntries(LAYERS.map((l) => [l.key, true])) as Record<LayerKey, boolean>);
  const [spread, setSpread] = useState(0);
  const layerView = useMemo(() => ({ show: shownLayers, spread }), [shownLayers, spread]);
  const current = all[Math.min(index, all.length - 1)];

  // The board and what is mounted on it, as a small teardown of its own for the 3D view.
  const board3d = useMemo(() => {
    if (!current) return null;
    const ids = new Set([current.part.id, ...current.footprints.map((f) => f.partId)]);
    const c = current.part.position;
    // Parts lift off with the layers when they are spread: above the top silkscreen, below the bottom one.
    const n = current.axes.n;
    const lift = layerGap(current) * 4.5;
    return {
      ...td,
      product: { ...td.product, name: `${td.product.name} ${current.part.id}` },
      parts: td.parts.filter((p) => ids.has(p.id)).map((p) => ({
        ...p,
        position: [p.position[0] - c[0], p.position[1] - c[1], p.position[2] - c[2]] as [number, number, number],
        copies: p.copies?.map((q) => [q[0] - c[0], q[1] - c[1], q[2] - c[2]] as [number, number, number]),
        explode: (() => {
          const e: [number, number, number] = [0, 0, 0];
          if (p.id !== current.part.id) e[n] = p.position[n] >= c[n] ? lift : -lift;
          return e;
        })(),
      })),
      connections: td.connections.filter((x) => ids.has(x.from) && ids.has(x.to)),
    };
  }, [td, current]);

  // The fabrication preview is drawn from the Gerber files themselves, by the renderer Kitspace uses.
  useEffect(() => {
    if (mode !== 'fab' || !current) return;
    let live = true;
    setFab(null);
    setFabError('');
    apiFetch('/api/board-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: buildGerberSet(current, td.product.name) }),
    })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || String(r.status)))))
      .then((j) => { if (live) setFab(j); })
      .catch((e) => { if (live) setFabError(e instanceof TypeError ? 'The local server is not reachable. Start it with “npm run dev”.' : e.message); });
    return () => { live = false; };
  }, [mode, current, td.product.name]);
  const b = all[Math.min(index, all.length - 1)];

  if (!b) {
    return (
      <div className="tab-empty">
        <h2>No circuit board in this teardown</h2>
        <p>Add a photo of the opened product, or say what board it has, then update the teardown.</p>
      </div>
    );
  }

  const pad = 6;
  const scale = Math.min(9, Math.max(2, 760 / (b.width + pad * 2)));
  const W = (b.width + pad * 2) * scale;
  const H = (b.height + pad * 2) * scale;
  // Board y runs up, SVG y runs down. The bottom side is drawn mirrored, as if the board were flipped.
  const px = (x: number) => (pad + (side === 'top' ? x : b.width - x)) * scale;
  const py = (y: number) => (pad + b.height - y) * scale;
  const shown = b.footprints.filter((f) => f.side === side);
  const centre = new Map<string, { x: number; y: number }>();
  shown.forEach((f) => { if (!centre.has(f.partId)) centre.set(f.partId, { x: px(f.x), y: py(f.y) }); });
  const counts = { top: b.footprints.filter((f) => f.side === 'top').length, bottom: b.footprints.filter((f) => f.side === 'bottom').length };

  const routing = useMemo(() => (current ? routeBoard(current) : null), [current]);

  const exportProject = () => {
    downloadBytes(`${slug(td.product.name)}-pcb-project.zip`, zip(buildPcbProject(td, all)), 'application/zip');
  };
  const exportGerbers = () => {
    const files = buildGerberSet(b, td.product.name);
    downloadBytes(`${slug(td.product.name)}-${slug(b.part.refDes ?? b.part.id)}-gerbers.zip`, zip(files), 'application/zip');
  };

  return (
    <div className="worktab">
      <header className="worktab-head">
        <div>
          <h2>{b.part.refDes ? `${b.part.refDes} ` : ''}{b.part.name}</h2>
          <p className="hint">
            The board on its own, seen from the {side} side: outline, mounting holes, where each part sits and what
            connects to what. Click a part to see its details.
          </p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" onClick={exportGerbers}>
            <Download size={15} />
            Gerber set <span className="ext">.zip</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={exportProject}>
            <Download size={15} />
            KiCad and Kitspace project <span className="ext">.zip</span>
          </button>
        </div>
      </header>

      <div className="toolbar">
        {all.length > 1 && (
          <div className="kinds" role="group" aria-label="Board">
            {all.map((x, i) => (
              <button key={x.part.id} type="button" className="chip" aria-pressed={i === index} onClick={() => setIndex(i)}>
                {x.part.refDes ?? x.part.name}
              </button>
            ))}
          </div>
        )}
        <div className="kinds" role="group" aria-label="Side">
          <button type="button" className="chip" aria-pressed={side === 'top'} onClick={() => setSide('top')}>Top · {counts.top}</button>
          <button type="button" className="chip" aria-pressed={side === 'bottom'} onClick={() => setSide('bottom')}>Bottom · {counts.bottom}</button>
        </div>
        <div className="kinds" role="group" aria-label="Drawing">
          <button type="button" className="chip" aria-pressed={mode === 'layout'} onClick={() => setMode('layout')}>Layout</button>
          <button type="button" className="chip" aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>3D</button>
          <button type="button" className="chip" aria-pressed={mode === 'fab'} onClick={() => setMode('fab')}>Fabrication preview</button>
        </div>
        {mode === '3d' && (
          <div className="kinds layer-chips" role="group" aria-label="Board layers">
            {LAYERS.map((l) => (
              <button key={l.key} type="button" className="chip" aria-pressed={shownLayers[l.key]} onClick={() => setShownLayers((v) => ({ ...v, [l.key]: !v[l.key] }))}>
                {l.label}
              </button>
            ))}
            <label className="range-row">
              <span>Spread the layers</span>
              <input type="range" min={0} max={1} step={0.01} value={spread} onChange={(e) => setSpread(Number(e.target.value))} />
            </label>
          </div>
        )}
        {mode === 'layout' && <div className="kinds">
          <button type="button" className="chip" aria-pressed={bare} onClick={() => setBare((v) => !v)}>Bare board only</button>
          <button type="button" className="chip" aria-pressed={showCopper} onClick={() => setShowCopper((v) => !v)}>Copper traces</button>
          <button type="button" className="chip" aria-pressed={showNets} onClick={() => setShowNets((v) => !v)}>Connections</button>
        </div>}
      </div>

      <dl className="facts">
        <div><dt>Outline</dt><dd className="num">{b.width} × {b.height} mm</dd></div>
        <div><dt>Thickness</dt><dd className="num">{b.thickness} mm</dd></div>
        <div><dt>Area</dt><dd className="num">{((b.width * b.height) / 100).toFixed(1)} cm²</dd></div>
        <div><dt>Placements</dt><dd className="num">{b.footprints.length}</dd></div>
        <div><dt>Mounting holes</dt><dd className="num">{b.holes.length}</dd></div>
        <div><dt>On-board nets</dt><dd className="num">{b.nets.length}</dd></div>
        {routing && b.nets.length > 0 && (
          <div className={routing.failed.length ? 'is-over' : ''}>
            <dt>Routed in copper</dt>
            <dd className="num">{routing.routed} of {routing.routed + routing.failed.length}</dd>
            <dd className="fact-sub">{routing.length} mm of trace, {routing.vias.length} vias</dd>
          </div>
        )}
      </dl>

      {mode === '3d' && board3d && (
        <div className="board-3d">
          <Viewer3D
            td={board3d}
            explode={spread}
            layers={layerView}
            keepView
            selectedId={selectedId}
            onSelect={onSelect}
            kinds={{ power: showNets, ground: false, signal: showNets, rf: showNets, mechanical: false }}
            showValues={false}
            xray={false}
            resetSignal={index}
          />
        </div>
      )}

      {mode === 'fab' && (
        <div className="fab">
          {fabError && <p className="error" role="alert">{fabError}</p>}
          {!fab && !fabError && <p className="hint" role="status">Rendering the Gerber files…</p>}
          {fab && <div className="fab-svg" role="img" aria-label={`Fabrication preview, ${side} side`} dangerouslySetInnerHTML={{ __html: side === 'top' ? fab.top : fab.bottom }} />}
          <p className="fineprint">
            Drawn from the generated Gerber files by pcb-stackup, the renderer kitspace.org uses. This is what a board
            house would make from them: board, pads, the autorouted copper traces under the solder mask, and part outlines.
          </p>
        </div>
      )}

      {mode === 'layout' && <div className="board-scroll">
        <svg className="board" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label={`${b.part.name}, ${side} side`}>
          <rect x={pad * scale} y={pad * scale} width={b.width * scale} height={b.height * scale} rx={1.2 * scale} className="board-fr4" style={{ fill: b.part.color }} />
          {b.holes.map((h, i) => (
            <g key={i}>
              <circle cx={px(h.x)} cy={py(h.y)} r={((h.d + 1.6) / 2) * scale} className="board-pad" />
              <circle cx={px(h.x)} cy={py(h.y)} r={(h.d / 2) * scale} className="board-hole" />
            </g>
          ))}
          {shown.map((f) => f.pads.map((p, i) => (
            <rect
              key={`${f.key}-${i}`}
              x={px(f.x + (side === 'top' ? p.x : -p.x)) - (p.w * scale) / 2}
              y={py(f.y + p.y) - (p.h * scale) / 2}
              width={p.w * scale}
              height={p.h * scale}
              rx={f.round ? (p.w * scale) / 2 : 0.6}
              className="board-pad"
            />
          )))}
          {showCopper && routing && (
            <g className="board-copper">
              {/* The far side shows faintly through the board, as it does on a real one held to the light. */}
              {routing.traces.filter((t) => t.layer !== side).map((t, i) => (
                <polyline key={`o${i}`} className="is-far" points={t.points.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} strokeWidth={Math.max(1, t.width * scale)} />
              ))}
              {routing.traces.filter((t) => t.layer === side).map((t, i) => {
                const active = !selectedId || routing.ends.get(t.net)?.some((e) => e.partId === selectedId);
                return (
                  <polyline key={i} className={active ? '' : 'is-dim'} points={t.points.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} strokeWidth={Math.max(1.2, t.width * scale)}>
                    <title>{b.nets.find((n) => n.id === t.net)?.label}</title>
                  </polyline>
                );
              })}
              {routing.vias.map((v, i) => (
                <g key={`v${i}`}>
                  <circle cx={px(v.x)} cy={py(v.y)} r={(v.pad / 2) * scale} className="board-pad" />
                  <circle cx={px(v.x)} cy={py(v.y)} r={(v.drill / 2) * scale} className="board-hole" />
                </g>
              ))}
            </g>
          )}
          {!bare && b.nets.filter((n) => showNets || (showCopper && routing?.failed.includes(n.id))).map((n) => {
            const a = centre.get(n.from);
            const c = centre.get(n.to);
            if (!a || !c) return null;
            const active = !selectedId || n.from === selectedId || n.to === selectedId;
            return <line key={n.id} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke={KIND_COLOR[n.kind]} className={`board-net${active ? '' : ' is-dim'}`}><title>{n.label} {n.values}</title></line>;
          })}
          {!bare && shown.map((f) => {
            const sel = f.partId === selectedId;
            const w = f.w * scale;
            const h = f.h * scale;
            return (
              <g
                key={f.key}
                className={`board-part${sel ? ' is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${f.ref} ${f.name}`}
                onClick={() => onSelect(sel ? null : f.partId)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(sel ? null : f.partId); } }}
              >
                <title>{f.ref} {f.name}</title>
                {f.round
                  ? <circle cx={px(f.x)} cy={py(f.y)} r={w / 2} />
                  : <rect x={px(f.x) - w / 2} y={py(f.y) - h / 2} width={w} height={h} rx={1.5} />}
                {Math.max(w, h) > 26 && <text x={px(f.x)} y={py(f.y) + 4} textAnchor="middle">{f.ref}</text>}
              </g>
            );
          })}
        </svg>
      </div>}

      <section className="loads">
        <h2>Placement</h2>
        <p className="hint">Position of each part, measured from the lower-left corner of the board, top view.</p>
        <table className="loads-table">
          <thead>
            <tr>
              <th scope="col">Ref</th><th scope="col">Part</th><th scope="col">Side</th>
              <th scope="col" className="r">X</th><th scope="col" className="r">Y</th><th scope="col" className="r">Size</th>
            </tr>
          </thead>
          <tbody>
            {b.footprints.map((f) => (
              <tr key={f.key} aria-selected={f.partId === selectedId} onClick={() => onSelect(f.partId)}>
                <td className="ref">{f.ref}</td>
                <th scope="row">{f.name}</th>
                <td>{f.side}</td>
                <td className="r num">{f.x.toFixed(1)}</td>
                <td className="r num">{f.y.toFixed(1)}</td>
                <td className="r num">{f.w.toFixed(1)} × {f.h.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="callout">
        <strong>About the copper traces.</strong> They are drawn by an autorouter: a first pass that connects the pads
        on two layers, keeps clear of other nets and uses wider traces for power. For a product that was photographed
        this is not the original board's routing, which a photo does not show. The pads are typical for each part
        class, not measured, and nothing is checked for current, impedance or noise. The traces are in the Gerber and
        KiCad downloads as a starting point. Review and re-route in KiCad before sending anything to a board house.
      </p>
    </div>
  );
}
