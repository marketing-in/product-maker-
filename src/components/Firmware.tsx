import { apiFetch } from '../lib/api';
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';

import type { FirmwareBundle, Teardown } from '../lib/types';
import WriteFirmware from './WriteFirmware';
import { fileSize } from './bits';

export interface ReaStatus { available: boolean; version?: string; command?: string }

interface Run {
  title: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  pretty?: string;
  text?: string;
  stderr?: string;
}

interface Result {
  file: { name: string; size: number };
  rea: { available: boolean; version?: string; runs: Run[] };
  interpretation: string | null;
  interpretationError: string | null;
  hasKey: boolean;
}

interface Props {
  td: Teardown;
  rea: ReaStatus | null;
  canGenerate: boolean;
  onFirmware: (fw: FirmwareBundle | undefined) => void;
}

export default function Firmware({ td, rea, canGenerate, onFirmware }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const inspect = async (file: File) => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('teardown', JSON.stringify({ parts: td.parts.map(({ id, name, refDes, candidates }) => ({ id, name, refDes, candidates })) }));
      const res = await apiFetch('/api/firmware', { method: 'POST', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `The server answered ${res.status}.`);
      setResult(json as Result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The inspection failed.');
    } finally {
      setBusy(false);
    }
  };

  const missing = rea ? !rea.available : false;

  return (
    <div className="fwtab">
      <WriteFirmware td={td} canGenerate={canGenerate} onFirmware={onFirmware} />

      <h2 className="fw-inspect-head">Inspect existing firmware</h2>
      <p className="lede">
        Photos explain the hardware. If you also have something that runs on it, such as a firmware update file, a flash
        dump read from the memory chip or the companion app, <a href="https://github.com/morluto/rea" target="_blank" rel="noreferrer">rea</a> can
        inspect it on this computer and Claude ties the findings back to the chips in this teardown.
      </p>

      {missing && (
        <div className="callout" role="status">
          <h3>rea is not set up on this computer</h3>
          <p>
            Set it up once inside this project, then restart Teardown Lab. It brings its own Node (rea needs 24.22.1 or
            newer), so no global install or administrator password is needed:
          </p>
          <pre><code>npm run setup:rea</code></pre>
          <p>
            Region scans of raw firmware also need Binwalk on Linux. Point rea at it with
            {' '}<code>REA_BINWALK_COMMAND=/usr/bin/binwalk</code>. Container formats rea reads natively need nothing extra.
          </p>
        </div>
      )}

      <div className="fw-pick">
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            if (f) void inspect(f);
            ev.target.value = '';
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy || missing} onClick={() => fileRef.current?.click()}>
          <FileUp size={15} />
          {busy ? 'Inspecting…' : 'Choose a file to inspect'}
        </button>
        <span className="hint">
          {rea?.available ? `rea ${rea.version ?? ''} found. ` : ''}
          The file stays on this computer. Only rea’s report is sent to Claude.
        </span>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <div className="fw-result">
          <h3>
            {result.file.name} <span className="dim num">{fileSize(result.file.size)}</span>
          </h3>

          {result.interpretation && (
            <section className="fw-reading">
              <h4>What it tells us</h4>
              {result.interpretation.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
            </section>
          )}
          {!result.interpretation && result.rea.available && (
            <p className="hint">
              {result.interpretationError
                ? `Claude could not read the report: ${result.interpretationError}`
                : result.hasKey
                  ? 'rea returned nothing Claude could interpret. The raw output is below.'
                  : 'Add a Claude API key to get a plain-language reading of this report. The raw output is below.'}
            </p>
          )}

          {result.rea.runs.map((run) => (
            <details key={run.command} className="fw-run" open={!run.ok}>
              <summary>
                <span>{run.title}</span>
                <span className={run.ok ? 'run-ok' : 'run-fail'}>{run.ok ? 'Completed' : 'Did not complete'}</span>
              </summary>
              <p className="num dim">{run.command}</p>
              {run.stderr && <pre className="fw-out fw-err">{run.stderr}</pre>}
              {(run.pretty || run.text) && <pre className="fw-out">{run.pretty ?? run.text}</pre>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
