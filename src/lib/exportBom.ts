import { partPower } from './power';
import { CATEGORY_LABEL, type Teardown } from './types';

const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildBomCsv(td: Teardown): string {
  const power = partPower(td);
  const head = [
    'Ref', 'Part', 'Category', 'Qty', 'Function', 'Package', 'Material', 'Process',
    'Candidate part numbers', 'Est. unit cost (USD)', 'Power in (W)', 'Power used (W)',
    'Confidence', 'Evidence', 'Open questions',
  ];
  const rows = td.parts.map((p) => {
    const pw = power.get(p.id);
    return [
      p.refDes, p.name, CATEGORY_LABEL[p.category], p.qty, p.function, p.package, p.material, p.process,
      (p.candidates ?? []).join(' / '), p.estCostUsd,
      pw?.hasIn ? pw.inW.toFixed(3) : '', pw?.hasIn ? pw.usedW.toFixed(3) : '',
      p.confidence, p.evidence, p.unknowns,
    ].map(cell).join(',');
  });
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function download(filename: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
