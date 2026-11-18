// Takes the screenshots used in the Teardown Lab overview PDF. Needs `npm run dev` running.
// Uses the built-in sample and saved projects only, so it never calls Claude.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = new URL('./shots/', import.meta.url).pathname;
const BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9401', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ov-'))}`, '--window-size=1600,1000', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch('http://127.0.0.1:9401/json')).json()).find((x) => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id) pending.get(j.id)?.(j); if (j.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
// A screenshot of one part of the screen (a CSS selector), or the whole window.
const shot = async (name, selector) => {
  const box = selector ? await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`) : null;
  for (let i = 0; i < 2; i++) {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(box ? { clip: { ...box, scale: 1 } } : {}) });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
    await sleep(250);
  }
  console.log('shot', name, selector ?? 'window');
};
const click = (text) => js(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return !!b; })()`);
const tab = (label) => js(`[...document.querySelectorAll('[role=tab]')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim() === ${JSON.stringify(label)})?.click()`);
const go = async (path) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(150); await send('Page.navigate', { url: BASE + path }); await sleep(3500); };
const openSaved = async (re) => { await go('/#start'); for (let i = 0; i < 20 && !(await js(`!!document.querySelector('.saved-open')`)); i++) await sleep(300); await js(`[...document.querySelectorAll('.saved-open')].find((b) => ${re}.test(b.textContent) && /Design/.test(b.textContent))?.click()`); await sleep(3000); };
await send('Runtime.enable'); await send('Page.enable');
// Twice the pixels, so the pictures stay sharp in print.
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });

// The example product is the sports-tracking camera teardown.
const CAMERA = '/sports tracking camera/i';
const setRange = (v) => js(`(() => { const r = document.querySelector('#explode-range'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '${v}'); r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const selectPart = async (re) => {
  await js(`(() => { const b = document.querySelector('.rail-btn[aria-pressed]'); if (b?.getAttribute('aria-pressed') === 'false') b.click(); })()`); await sleep(300);
  await js(`[...document.querySelectorAll('.partrow')].find((r) => ${re}.test(r.textContent))?.click()`); await sleep(900);
  await js(`document.querySelector('.rail-btn[aria-pressed="true"]')?.click()`);
};

// Start page, in "take apart a product I have" mode.
await go('/#start'); await click('Take apart a product I have'); await sleep(600);
// The overview is about the camera, so leave the other saved projects out of the picture.
await js(`document.querySelectorAll('.saved li').forEach((li) => { if (!/sports tracking camera/i.test(li.textContent)) li.style.display = 'none'; })`); await sleep(300);
await shot('start');
await shot('start-intake', '.start-form');

await openSaved(CAMERA);
await tab('Exploded view'); await sleep(800);
await setRange('0.8'); await sleep(800);
await click('Volts, amps, watts'); await sleep(1200); await shot('camera-exploded', '.stage .viewer'); await click('Volts, amps, watts');
await setRange('0.55'); await sleep(1500); await shot('camera-exploded-values', '.stage .viewer');
await tab('Design'); await sleep(1200);
await selectPart('/Main processor board/'); await sleep(600); await shot('camera-design', '.bench-main');
await tab('Simulator'); await sleep(1500);
await js(`[...document.querySelectorAll('.ctl-list .btn')].find((b) => b.textContent.trim() === 'Power')?.click()`); await sleep(1500);
await js(`document.querySelector('[aria-label="Camera"]')?.scrollIntoView({ block: 'start' })`); await sleep(800);
await shot('camera-simulator', '.bench-main');
await tab('Architecture'); await sleep(1200); await shot('camera-architecture', '.panel');
await tab('Power tree'); await sleep(1000); await shot('camera-power', '.powertree-scroll');
await tab('Bare board'); await sleep(1000);
await js(`[...document.querySelectorAll('.worktab .chip')].find((b) => /main/i.test(b.textContent))?.click()`); await sleep(800);
await js(`document.querySelector('.panel').scrollTop = 0`);
await click('3D'); await sleep(1800); await shot('camera-board-3d', '.board-3d');
await click('Layout'); await sleep(1000); await shot('camera-board-layout', '.board-scroll');
await tab('Fit and mould'); await sleep(1500); await click('Open the mould'); await sleep(1500); await shot('camera-fit', '.fit-3d-wrap');
await tab('Firmware'); await sleep(1200);
await js(`[...document.querySelectorAll('.fw-write [role=tab]')].find((b) => b.textContent === 'src/main.cpp')?.click()`); await sleep(400);
await js(`document.querySelector('pre.code').scrollIntoView({ block: 'center' })`); await sleep(500); await shot('camera-firmware-code', 'pre.code');
await tab('Make'); await sleep(1200); await shot('camera-make', '.panel');

// The camera's own product report and full download, for the outputs page.
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
for (const label of ['Download the report', 'Download everything']) {
  const had = new Set(readdirSync(OUT));
  await click(label);
  for (let i = 0; i < 60 && !readdirSync(OUT).some((f) => !had.has(f) && !f.endsWith('.crdownload')); i++) await sleep(250);
}
for (const f of readdirSync(OUT)) {
  if (f.endsWith('-report.pdf')) renameSync(join(OUT, f), join(OUT, 'camera-report.pdf'));
  if (f.endsWith('-everything.zip')) renameSync(join(OUT, f), join(OUT, 'camera-everything.zip'));
}
console.log('done');
process.exit(0);
