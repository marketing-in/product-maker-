import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CATEGORY_LABEL, CATEGORY_ORDER, type Part, type Teardown } from '../lib/types';
import { Conf, Swatch } from './bits';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function PartList({ td, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: Part) =>
      !q || [p.name, p.refDes, p.function, p.package, ...(p.candidates ?? [])].some((s) => s?.toLowerCase().includes(q));
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      parts: td.parts.filter((p) => p.category === cat && match(p)),
    })).filter((g) => g.parts.length > 0);
  }, [td, query]);

  const total = td.parts.reduce((s, p) => s + p.qty, 0);

  return (
    <section className="partlist" aria-label="Parts">
      <div className="partlist-head">
        <h2>Parts</h2>
        <span className="count">{td.parts.length} lines, {total} pieces</span>
      </div>
      <label className="search">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">Filter parts</span>
        <input
          type="search"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder="Filter by name, reference or chip"
        />
      </label>

      <div className="partlist-scroll">
        {groups.length === 0 && <p className="empty">No part matches “{query}”.</p>}
        {groups.map((g) => (
          <div key={g.cat} className="partgroup">
            <h3>{CATEGORY_LABEL[g.cat]}</h3>
            <ul>
              {g.parts.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="partrow"
                    aria-pressed={p.id === selectedId}
                    onClick={() => onSelect(p.id === selectedId ? null : p.id)}
                  >
                    <Swatch color={p.color} />
                    <span className="partrow-name">
                      {p.refDes && <span className="ref">{p.refDes}</span>}
                      {p.name}
                    </span>
                    {p.qty > 1 && <span className="qty">×{p.qty}</span>}
                    <Conf level={p.confidence} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="legend">
        <Conf level="observed" showLabel /> <Conf level="inferred" showLabel /> <Conf level="assumed" showLabel />
      </p>
    </section>
  );
}
