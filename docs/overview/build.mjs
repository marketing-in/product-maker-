// Prints docs/overview/overview.html to docs/teardown-lab-overview.pdf with headless Chrome.
// Run: node docs/overview/build.mjs   (refresh the screenshots first with capture.mjs if the app changed)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HTML = new URL('./overview.html', import.meta.url).href;
const OUT = new URL('../teardown-lab-overview.pdf', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9404', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ovp-'))}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch('http://127.0.0.1:9404/json')).json()).find((x) => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id) pending.get(j.id)?.(j); };
const send = (method, params = {}, ms = 60000) => new Promise((resolve, reject) => { const n = ++id; const timer = setTimeout(() => reject(new Error(`${method} timed out`)), ms); pending.set(n, (v) => { clearTimeout(timer); resolve(v); }); ws.send(JSON.stringify({ id: n, method, params })); });
console.log('browser up');
await send('Page.enable');
await send('Page.navigate', { url: HTML });
console.log('loaded', HTML);
await sleep(2500);
const fonts = (await send('Runtime.evaluate', { expression: 'Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]).then(() => [...document.fonts].map((f) => f.family + " " + f.weight + " " + f.status).join(", "))', awaitPromise: true, returnByValue: true })).result.result.value;
console.log('fonts:', fonts);
// Large documents come back as a stream, read in pieces; one big message stalls.
const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, transferMode: 'ReturnAsStream' }, 110000);
const chunks = [];
for (;;) {
  const piece = await send('IO.read', { handle: r.result.stream, size: 1 << 20 });
  chunks.push(Buffer.from(piece.result.data, piece.result.base64Encoded ? 'base64' : 'utf8'));
  if (piece.result.eof) break;
}
await send('IO.close', { handle: r.result.stream });
writeFileSync(OUT, Buffer.concat(chunks));
console.log(`wrote ${OUT} (${fonts} fonts loaded)`);
process.exit(0);
