import { Cpu, Download, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { apiFetch } from '../lib/api';
import { downloadBytes, zipCompressed } from '../lib/exportGerber';
import { firmwareFiles, platformioIni } from '../lib/firmware';
import { slug } from '../lib/geometry';
import type { FirmwareBundle, Teardown } from '../lib/types';

interface Props {
  td: Teardown;
  canGenerate: boolean;
  onFirmware: (fw: FirmwareBundle | undefined) => void;
}

const CONTROLLER = /mcu|microcontroller|esp32|esp8266|rp2040|rp2350|atmega|attiny|stm32|nrf5|samd|arduino|pico|soc|bluetooth audio|module/i;

export default function WriteFirmware({ td, canGenerate, onFirmware }: Props) {
  const fw = td.firmware;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(0);
  const hasController = td.parts.some((p) => (p.category === 'ic' || p.category === 'pcb') && CONTROLLER.test(`${p.name} ${p.package ?? ''} ${(p.candidates ?? []).join(' ')}`));

  const write = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { firmware: _old, meta: _meta, ...design } = td;
      void _old; void _meta;
      const res = await apiFetch('/api/firmware-gen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teardown: design }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `The server answered ${res.status}.`);
      onFirmware(json.firmware as FirmwareBundle);
      setFile(0);
      setNote(json.cached ? 'Loaded from storage. No tokens were used.' : 'Written and stored. Asking again for this design is free.');
    } catch (err) {
      setError(err instanceof TypeError ? 'The local server is not reachable. Start it with “npm run dev”.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!fw) return;
    const folder = `${slug(td.product.name)}-firmware`;
    downloadBytes(`${folder}.zip`, await zipCompressed(firmwareFiles(fw, td, folder)), 'application/zip');
  };

  if (!fw) {
    return (
      <section className="fw-write">
        <h2>Write the firmware</h2>
        <p className="lede">
          Claude writes the program that runs on this product’s controller: a complete PlatformIO project with a pin map
          that matches the board, code for every button, sensor and output, safe start-up and shut-down, and the steps
          to build, flash and test it.
        </p>
        {!hasController && (
          <p className="callout">No microcontroller was found in this design, so there may be nothing to program. You can still ask; Claude will say what it found.</p>
        )}
        <div className="fw-pick">
          <button type="button" className="btn btn-primary" onClick={() => void write()} disabled={!canGenerate || busy}>
            <Cpu size={15} />{busy ? 'Writing the firmware…' : 'Write the firmware'}
          </button>
          <span className="hint">
            {busy ? 'Usually one to three minutes. The result is stored the moment it arrives, so it is kept even if you leave this tab.' : 'One generation with Claude Opus 5.5, about $0.20 to $0.50, stored so it is never paid for twice.'}
          </span>
        </div>
        {!canGenerate && <p className="hint">Needs the agent: an API key, and on the hosted site the access code.</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    );
  }

  const lines = fw.files.reduce((n, f) => n + f.content.split('\n').length, 0);
  const shown = [{ path: 'platformio.ini', content: platformioIni(fw) }, ...fw.files];
  const current = shown[Math.min(file, shown.length - 1)];
  return (
    <section className="fw-write">
      <header className="worktab-head">
        <div>
          <h2>Firmware</h2>
          <p className="lede">{fw.summary}</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn btn-primary" onClick={() => void download()}><Download size={15} />PlatformIO project <span className="ext">.zip</span></button>
          <button type="button" className="btn" onClick={() => { if (window.confirm('Remove this firmware from the design? Writing it again for an unchanged design is free.')) onFirmware(undefined); }}><RotateCcw size={15} />Remove</button>
        </div>
      </header>
      {note && <p className="hint" role="status">{note}</p>}
      <dl className="facts">
        <div><dt>Controller</dt><dd>{fw.controller}</dd></div>
        <div><dt>Framework</dt><dd className="num">{fw.framework}</dd></div>
        <div><dt>Board</dt><dd className="num">{fw.env.board}</dd></div>
        <div><dt>Pins used</dt><dd className="num">{fw.pins.length}</dd></div>
        <div><dt>Code</dt><dd className="num">{fw.files.length} files, {lines} lines</dd></div>
      </dl>

      <section className="loads">
        <h2>Pin map</h2>
        <table className="loads-table wide">
          <thead><tr><th scope="col">Pin</th><th scope="col">Signal</th><th scope="col">Direction</th><th scope="col">Connects to</th><th scope="col">Note</th></tr></thead>
          <tbody>
            {fw.pins.map((p, i) => (
              <tr key={i}><td className="ref">{p.pin}</td><th scope="row">{p.signal}</th><td>{p.direction}</td><td>{p.connectsTo}</td><td>{p.note}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="loads">
        <h2>Code</h2>
        <div className="kinds" role="tablist" aria-label="Files">
          {shown.map((f, i) => (
            <button key={f.path} type="button" role="tab" className="chip" aria-selected={i === file} aria-pressed={i === file} onClick={() => setFile(i)}>{f.path}</button>
          ))}
        </div>
        <pre className="code" tabIndex={0} aria-label={current.path}><code>{current.content}</code></pre>
      </section>

      <div className="cards">
        <article className="card"><h3>Build and flash</h3><ol className="notes">{fw.build.map((s, i) => <li key={i}>{s}</li>)}</ol></article>
        <article className="card"><h3>Test on the bench</h3><ol className="notes">{fw.test.map((s, i) => <li key={i}>{s}</li>)}</ol></article>
        <article className="card"><h3>Assumptions</h3><ul className="notes">{fw.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul></article>
      </div>
      <p className="fineprint">
        Written from the design, not compiled or run on hardware here. Check the pin map against your real board, build it
        with PlatformIO, and run the bench tests with the motors or loads disconnected first.
      </p>
    </section>
  );
}
