import { CONFIDENCE_LABEL, type Confidence } from '../lib/types';

/** Confidence is coded by shape, not colour: full, half or empty disc. */
export function Conf({ level, showLabel = false }: { level: Confidence; showLabel?: boolean }) {
  return (
    <span className="conf" title={CONFIDENCE_LABEL[level]}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {level === 'observed' && <circle cx="6" cy="6" r="4.75" fill="currentColor" />}
        {level === 'inferred' && <path d="M6 1.25a4.75 4.75 0 0 0 0 9.5z" fill="currentColor" />}
      </svg>
      {showLabel ? <span>{CONFIDENCE_LABEL[level]}</span> : <span className="sr-only">{CONFIDENCE_LABEL[level]}</span>}
    </span>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} aria-hidden="true" />;
}

export function usd(n?: number): string {
  if (n == null) return '';
  return n < 0.1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
