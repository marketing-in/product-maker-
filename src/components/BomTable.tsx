import { CATEGORY_ORDER, type Teardown } from '../lib/types';
import { Conf, Swatch, usd } from './bits';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function BomTable({ td, selectedId, onSelect }: Props) {
  const rows = [...td.parts].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
  const priced = rows.filter((p) => p.estCostUsd != null);
  const total = priced.reduce((s, p) => s + (p.estCostUsd ?? 0) * p.qty, 0);

  return (
    <div className="bomtab">
      <table className="bom">
        <caption className="sr-only">Bill of materials</caption>
        <thead>
          <tr>
            <th scope="col">Ref</th>
            <th scope="col">Part</th>
            <th scope="col">Package or material</th>
            <th scope="col">Likely parts</th>
            <th scope="col" className="r">Qty</th>
            <th scope="col" className="r">Unit cost</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} aria-selected={p.id === selectedId} onClick={() => onSelect(p.id)}>
              <td className="ref">{p.refDes ?? ''}</td>
              <th scope="row">
                <button type="button" className="link bom-name" onClick={(ev) => { ev.stopPropagation(); onSelect(p.id); }}>
                  <Swatch color={p.color} />
                  {p.name}
                </button>
              </th>
              <td>{p.package ?? p.material ?? ''}</td>
              <td>{(p.candidates ?? []).join(', ')}</td>
              <td className="r num">{p.qty}</td>
              <td className="r num">{usd(p.estCostUsd)}</td>
              <td><Conf level={p.confidence} showLabel /></td>
            </tr>
          ))}
        </tbody>
        {priced.length > 0 && (
          <tfoot>
            <tr>
              <th scope="row" colSpan={5}>
                Estimated material cost, {priced.length} of {rows.length} lines priced
              </th>
              <td className="r num">{usd(total)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
      <p className="fineprint">
        Costs are rough volume estimates for comparison, not quotes. Part numbers are candidates until a marking is read.
      </p>
    </div>
  );
}
