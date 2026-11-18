import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { connValues, fmtW, partPower } from '../lib/power';
import { CATEGORY_LABEL, KIND_LABEL, type Teardown } from '../lib/types';
import { Conf, usd } from './bits';
import { KIND_COLOR } from './Viewer3D';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="spec-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const mm = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, '');

export default function Inspector({ td, selectedId, onSelect }: Props) {
  const part = td.parts.find((p) => p.id === selectedId);
  const byId = new Map(td.parts.map((p) => [p.id, p]));

  if (!part) {
    const [x, y, z] = td.product.dimensionsMm;
    return (
      <aside className="inspector" aria-label="Product overview">
        <header className="inspector-head">
          <div>
            <p className="inspector-kind">{td.product.category}</p>
            <h2>{td.product.name}</h2>
          </div>
        </header>
        <div className="inspector-scroll">
          <p className="lede">{td.product.summary}</p>
          <dl className="spec">
            <Row label="Size">
              <span className="num">{mm(x)} × {mm(y)} × {mm(z)} mm</span>
            </Row>
            <Row label="Power in">{td.product.powerInput}</Row>
            <Row label="Source">
              {td.meta.source === 'sample' ? 'Built-in sample, illustrative only' : td.meta.source === 'board' ? 'Generated from your board file, no AI' : `Claude (${td.meta.model ?? 'model unknown'})`}
            </Row>
          </dl>

          {td.safety.length > 0 && (
            <section className="note-block note-safety">
              <h3>Before you open it</h3>
              <ul>{td.safety.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>
          )}
          {td.unknowns.length > 0 && (
            <section className="note-block">
              <h3>Still unknown</h3>
              <ul>{td.unknowns.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>
          )}
          {td.verifySteps.length > 0 && (
            <section className="note-block">
              <h3>How to confirm</h3>
              <ol>{td.verifySteps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>
          )}
          <p className="fineprint">
            Geometry and electrical values are estimates from the photos and description, not measurements. Select a part
            in the view or the list to see the evidence behind it.
          </p>
        </div>
      </aside>
    );
  }

  const power = partPower(td).get(part.id);
  const links = td.connections.filter((c) => c.from === part.id || c.to === part.id);
  const parent = part.parentId ? byId.get(part.parentId) : null;

  return (
    <aside className="inspector" aria-label="Selected part">
      <header className="inspector-head">
        <div>
          <p className="inspector-kind">
            {CATEGORY_LABEL[part.category]}
            {part.refDes && <span className="ref"> {part.refDes}</span>}
          </p>
          <h2>{part.name}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Close part details" onClick={() => onSelect(null)}>
          <X size={16} />
        </button>
      </header>

      <div className="inspector-scroll">
        <p className="lede">{part.function}</p>

        <dl className="spec">
          <Row label="Quantity">{part.qty > 1 ? <span className="num">{part.qty}</span> : null}</Row>
          <Row label="Package">{part.package}</Row>
          <Row label="Material">{part.material}</Row>
          <Row label="Process">{part.process}</Row>
          <Row label="Likely parts">
            {part.candidates?.length ? (
              <ul className="chips">{part.candidates.map((c) => <li key={c}>{c}</li>)}</ul>
            ) : null}
          </Row>
          <Row label="Mounted on">
            {parent ? (
              <button type="button" className="link" onClick={() => onSelect(parent.id)}>{parent.name}</button>
            ) : null}
          </Row>
          <Row label="Size">
            <span className="num">{mm(part.size[0])} × {mm(part.size[1])} × {mm(part.size[2])} mm</span>
          </Row>
          <Row label="Est. cost">
            {part.estCostUsd != null ? (
              <span className="num">
                {usd(part.estCostUsd)}
                {part.qty > 1 ? ` each, ${usd(part.estCostUsd * part.qty)} total` : ''}
              </span>
            ) : null}
          </Row>
        </dl>

        {power && (power.hasIn || power.hasOut) && (
          <section className="power-box">
            <h3>Power</h3>
            <dl className="power-figures">
              {power.hasIn && <div><dt>Receives</dt><dd className="num">{fmtW(power.inW)}</dd></div>}
              {power.hasOut && <div><dt>Passes on</dt><dd className="num">{fmtW(power.outW)}</dd></div>}
              {power.hasIn && (
                <div>
                  <dt>{part.category === 'battery' ? 'Stores' : 'Uses here'}</dt>
                  <dd className="num">{fmtW(power.usedW)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        <section className="evidence">
          <h3><Conf level={part.confidence} showLabel /></h3>
          <p>{part.evidence}</p>
          {part.unknowns && <p className="open-q"><strong>Open question.</strong> {part.unknowns}</p>}
        </section>

        {links.length > 0 && (
          <section className="links">
            <h3>Connections</h3>
            <ul>
              {links.map((c) => {
                const outgoing = c.from === part.id;
                const other = byId.get(outgoing ? c.to : c.from);
                const values = connValues(c);
                return (
                  <li key={c.id}>
                    <button type="button" className="linkrow" onClick={() => other && onSelect(other.id)}>
                      <span className="kind-dot" style={{ background: KIND_COLOR[c.kind] }} aria-hidden="true" />
                      <span className="linkrow-main">
                        <span className="linkrow-top">
                          <span className="linkrow-label">{c.label}</span>
                          {values && <span className="num">{values}</span>}
                        </span>
                        <span className="linkrow-sub">
                          {outgoing ? <ArrowRight size={12} aria-label="to" /> : <ArrowLeft size={12} aria-label="from" />}
                          {other?.name ?? 'Unknown part'}
                          <span className="dim"> · {KIND_LABEL[c.kind]}{c.protocol ? `, ${c.protocol}` : ''}</span>
                        </span>
                        {(c.medium || c.wire) && (
                          <span className="linkrow-sub dim">{[c.medium, c.wire].filter(Boolean).join(' · ')}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
