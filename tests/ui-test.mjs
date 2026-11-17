// Full UI test. Drives the running app (npm run dev) in headless Chrome and reports what breaks.
// It never calls Claude: it uses the built-in sample, the saved projects and free endpoints only.
//
//   node tests/ui-test.mjs [outDir]
//
// Writes screenshots and downloads to outDir (default: a temp folder) and exits 1 on any failure.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.UI_BASE ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'tl-ui-'));
const DL = join(OUT, 'downloads');
mkdirSync(DL, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9350 + Math.floor(Math.random() * 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const notes = [];
let checks = 0;
const ok = (cond, what) => { checks++; if (!cond) failures.push(what); return cond; };

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tl-cdp-'))}`,
  '--window-size=1600,1000', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
let where = 'start';
const pageErrors = [];
const badResponses = [];
ws.onmessage = (m) => {
  const j = JSON.parse(m.data);
  if (j.id) pending.get(j.id)?.(j);
  if (j.method === 'Page.javascriptDialogOpening') { dialogs.push(`[${where}] ${j.params.type}: ${j.params.message.slice(0, 80)}`); send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); }
  if (j.method === 'Runtime.exceptionThrown') pageErrors.push(`[${where}] ${j.params.exceptionDetails.exception?.description?.split('\n')[0] ?? j.params.exceptionDetails.text}`);
  if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') {
    const text = j.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (!/Download the React DevTools/.test(text)) pageErrors.push(`[${where}] console: ${text.slice(0, 200)}`);
  }
  if (j.method === 'Network.responseReceived') {
    const { url, status } = j.params.response;
    if (status >= 400 && url.includes('/api/') && !EXPECTED.some((e) => url.includes(e.path) && status === e.status)) badResponses.push(`[${where}] ${status} ${url.replace(BASE, '')}`);
  }
};
// Answers the app is supposed to give in some states.
const EXPECTED = [{ path: '/api/board-import', status: 422 }];
// Every browser command has a time limit, so a hang is reported with where it happened.
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const timer = setTimeout(() => { pending.delete(n); reject(new Error(`timed out after 30 s: ${method} at ${where}`)); }, 30000);
  pending.set(n, (v) => { clearTimeout(timer); pending.delete(n); resolve(v); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
// A dialog (an access-code prompt, a confirm) would block the page. Answer it and note it.
const dialogs = [];
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed at ${where}: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
};
const shot = async (name) => {
  for (let i = 0; i < 2; i++) { writeFileSync(join(OUT, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); await sleep(120); }
};
const click = async (text, scope = 'document') => js(`(() => {
  const b = [...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled);
  if (!b) return false; b.click(); return true; })()`);
const tab = async (label) => js(`(() => { const b = [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
/** Waits until a condition in the page is true, so a slow machine is not mistaken for a broken app. */
const waitFor = async (expr, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await js(expr)) return true; } catch { /* page still loading */ }
    if (Date.now() > end) return false;
    await sleep(200);
  }
};
const go = async (path) => {
  if (process.env.UI_VERBOSE) console.log('…', where, path);
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await send('Page.navigate', { url: BASE + path });
  // Ready when the start page or a design is on screen and the status call has had time to answer.
  await waitFor(`!!document.querySelector('.start, .bench') && (!!document.querySelector('.saved, .callout, .topbar-product') || performance.now() > 4000)`, 20000);
  if (path.startsWith('/#sample')) await waitFor(`!!document.querySelector('.panel')?.children.length`);
  await sleep(500);
};
const setWidth = async (w, h = 1000) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });

/** Layout problems a person would see. */
const layout = async (label) => {
  const r = await js(`(() => {
    const doc = document.documentElement;
    const problems = [];
    if (doc.scrollWidth > doc.clientWidth + 1) problems.push('page scrolls sideways by ' + (doc.scrollWidth - doc.clientWidth) + 'px');
    // Buttons and chips whose text spills out of them.
    for (const el of document.querySelectorAll('button, .chip, .tag')) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === 'visible') problems.push('text spills out of "' + el.textContent.trim().slice(0, 40) + '"');
    }
    // Things that are drawn off the right edge of the window.
    for (const el of document.querySelectorAll('button, input, select, textarea, h1, h2, h3, p, dd, td, th')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > window.innerWidth + 2 && !el.closest('.board-scroll, .powertree-scroll, .tabs, .bomtab, .bom, table')) problems.push((el.textContent || el.tagName).trim().slice(0, 40) + ' runs off the right edge');
    }
    // Boxes that grew a sideways scrollbar they were not meant to have.
    const SCROLLERS = '.tabs, .board-scroll, .powertree-scroll, .bomtab, .panel, .stages, .viewer, .viewer-canvas';
    for (const el of document.querySelectorAll('div, section, ol, ul')) {
      const st = getComputedStyle(el);
      if (!/(auto|scroll)/.test(st.overflowX) || el.matches(SCROLLERS) || el.closest('.board-scroll, .powertree-scroll, .bomtab')) continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.getBoundingClientRect().width > 0) problems.push('sideways scrollbar in .' + (el.className || el.tagName).toString().split(' ')[0] + ' (' + (el.scrollWidth - el.clientWidth) + 'px)');
    }
    // Images and canvases that failed or have no size.
    for (const img of document.querySelectorAll('img')) if (img.complete && !img.naturalWidth) problems.push('broken image ' + (img.alt || img.src.slice(0, 40)));
    for (const cv of document.querySelectorAll('.viewer-canvas canvas')) { const r = cv.getBoundingClientRect(); if (r.width < 20 || r.height < 20) problems.push('3D view has no size (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')'); }
    return [...new Set(problems)].slice(0, 8);
  })()`);
  for (const p of r) failures.push(`[${label}] ${p}`);
  checks++;
  return r;
};

setTimeout(() => { console.log(`UI test stopped: no finish after 15 minutes (last step: ${where}).`); chrome.kill(); process.exit(2); }, 15 * 60 * 1000).unref();
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

// ---------------------------------------------------------------- start page
where = 'start';
await go('/');
const status = await js(`fetch('/api/status').then((r) => r.json()).catch(() => null)`);
ok(status, 'API /api/status answers');
ok(await js(`document.querySelector('h1')?.textContent.includes('What do you want to build')`), 'start page heading');
await layout('start');
await shot('01-start');
for (const [chip, expect] of [['Take apart a product I have', 'Take it apart'], ['Make a housing for my board', 'Read the board'], ['Design something new', 'Start']]) {
  await click(chip);
  await sleep(300);
  ok(await js(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(expect)})`), `start mode "${chip}" shows "${expect}"`);
}
const saved = await js(`[...document.querySelectorAll('.saved-open strong')].map((s) => s.textContent)`);
notes.push(`${saved.length} saved projects listed on the start page`);
ok(await js(`!document.querySelector('.examples .chip') || [...document.querySelectorAll('.examples .chip')].every((b) => b.disabled === !${Boolean(status?.hasKey)})`), 'example chips enabled only when the agent can run');

// Board import with a bad file: should explain, not crash.
await click('Make a housing for my board');
await sleep(300);
{
  const doc = (await send('DOM.getDocument')).result.root.nodeId;
  const input = (await send('DOM.querySelector', { nodeId: doc, selector: '#board-files' })).result.nodeId;
  const bad = join(OUT, 'not-a-board.txt');
  writeFileSync(bad, 'hello');
  await send('DOM.setFileInputFiles', { nodeId: input, files: [bad] });
  await click('Read the board');
  await sleep(1500);
  ok(await js(`!!document.querySelector('.intake .error')?.textContent`), 'board import explains a file it cannot read');
}

// ---------------------------------------------------------------- sample, every tab
const TABS = ['Exploded view', 'Design', 'Simulator', 'Architecture', 'Bare board', 'Fit and mould', 'Parameters', 'Power tree', 'Bill of materials', 'Firmware', 'Make', 'Guide'];
const visitTabs = async (label, prefix) => {
  for (const t of TABS) {
    where = `${label} › ${t}`;
    if (!(await tab(t))) { failures.push(`[${label}] tab "${t}" missing`); continue; }
    await waitFor(`(document.querySelector('.panel')?.innerText.trim().length ?? 0) > 0 || !!document.querySelector('.panel canvas')`, 8000);
    await sleep(t === 'Exploded view' || t === 'Design' || t === 'Simulator' ? 700 : 250);
    ok(await js(`!!document.querySelector('.panel')?.children.length`), `[${where}] panel renders`);
    ok(await js(`document.querySelector('.panel')?.innerText.trim().length > 0 || !!document.querySelector('.panel canvas')`), `[${where}] panel is not empty`);
    await layout(where);
    if (prefix) await shot(`${prefix}-${t.toLowerCase().replace(/\s+/g, '-')}`);
  }
};
where = 'sample';
await go('/#sample:view');
ok(await js(`document.querySelector('.topbar-product')?.textContent.includes('sample')`), 'sample opens from #sample');
await visitTabs('sample', '10');

// Fit and mould: the 3D view, the opening mould, and no plastic advice on non-plastic parts.
where = 'sample › fit and mould';
await go('/#sample:fit');
await sleep(800);
ok(await waitFor(`!!document.querySelector('.fit-3d .viewer-canvas canvas')`), 'fit: 3D view renders');
ok(await click('Open the mould'), 'fit: Open the mould');
await sleep(1200);
ok(await js(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Close the mould')`), 'fit: the button turns into Close the mould');
ok((await js(`document.querySelectorAll('.fit-legend li').length`)) >= 1, 'fit: legend explains the colours');
await shot('11-fit-open');
await click('Close the mould');
const sheetAdvice = async () => js(`[...document.querySelectorAll('.card')].filter((c) => /Not a moulded resin/.test(c.innerText) && /sink marks|draft|clamp/i.test(c.querySelector('.notes')?.innerText ?? '')).map((c) => c.querySelector('h3')?.textContent)`);
ok((await sheetAdvice()).length === 0, 'fit: no moulding advice on parts that are not moulded');

// Interactions on the sample.
where = 'sample › exploded view';
await tab('Exploded view');
await sleep(800);
await js(`(() => { const r = document.querySelector('#explode-range'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '0.7'); r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
ok((await js(`document.querySelector('.explode output')?.textContent`)) === '70%', 'explode slider moves to 70%');
for (const chip of ['Power', 'Ground', 'Volts, amps, watts', 'See-through housing']) { ok(await click(chip), `chip "${chip}" toggles`); await sleep(120); await click(chip); }
for (const v of ['Top', 'Front', 'Side', '3D']) { ok(await click(v), `view button ${v}`); await sleep(200); }
// Select a part from the list; the inspector follows.
await js(`(() => { const l = [...document.querySelectorAll('.left-switch button')].find((b) => b.textContent.startsWith('Parts')); l?.click(); })()`);
await sleep(300);
ok(await js(`(() => { const r = [...document.querySelectorAll('.partrow')].find((r) => r.textContent.includes('Class-D')); r?.click(); return !!r; })()`), 'part list row is clickable');
await sleep(400);
ok(await js(`document.querySelector('.inspector')?.innerText.includes('Class-D')`), 'inspector shows the selected part');
await js(`(() => { const s = document.querySelector('.search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(s, 'usb'); s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
ok((await js(`document.querySelectorAll('.partrow').length`)) >= 1 && (await js(`document.querySelectorAll('.partrow').length`)) < 26, 'part search filters the list');
await shot('20-sample-selected');

// Export menu: every item downloads a file.
where = 'sample › export';
const before = readdirSync(DL).length;
for (const item of ['CAD model, assembled', 'CAD model, exploded', 'Blender scene, realistic render', 'Gerber set, all boards', 'Bill of materials', 'Teardown data']) {
  await js(`[...document.querySelectorAll('.topbar-actions .btn')].find((b) => b.textContent.includes('Export'))?.click()`);
  await sleep(200);
  ok(await js(`(() => { const b = [...document.querySelectorAll('.menu-pop button')].find((b) => b.textContent.includes(${JSON.stringify(item)})); b?.click(); return !!b; })()`), `export menu has "${item}"`);
  await sleep(700);
}
for (let i = 0; i < 50 && readdirSync(DL).filter((f) => !f.endsWith('.crdownload')).length - before < 6; i++) await sleep(200);
const files = readdirSync(DL).filter((f) => !f.endsWith('.crdownload'));
ok(files.length - before >= 6, `export menu downloaded ${files.length - before} of 6 files`);
for (const f of files) ok(statSync(join(DL, f)).size > 200, `download ${f} is not empty`);

// Design tab: edit, undo, reset.
where = 'sample › design';
await go('/#sample:design');
await js(`(() => { [...document.querySelectorAll('.left-switch button')].find((b) => b.textContent.startsWith('Parts'))?.click(); })()`);
await sleep(300);
await js(`[...document.querySelectorAll('.partrow')].find((r) => r.textContent.includes('Main board'))?.click()`);
await sleep(500);
const z0 = await js(`document.querySelectorAll('.numfield input')[2]?.value`);
ok(await click('Down 1 mm'), 'design: Down 1 mm');
await sleep(400);
ok((await js(`document.querySelectorAll('.numfield input')[2]?.value`)) === String(Number(z0) - 1), 'design: the board moved down 1 mm');
ok(await click('Undo'), 'design: Undo');
await sleep(300);
ok((await js(`document.querySelectorAll('.numfield input')[2]?.value`)) === z0, 'design: Undo put it back');
await js(`(() => { const i = document.querySelectorAll('.numfield input')[3]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '90'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
ok((await js(`document.querySelectorAll('.numfield input')[3]?.value`)) === '90', 'design: typing a size works');
ok(await click('Reset all'), 'design: Reset all');
await sleep(300);
ok((await js(`document.querySelectorAll('.numfield input')[3]?.value`)) === '96', 'design: Reset all restores the size');
await js(`document.querySelector('.inspector-close, .inspector button[aria-label*="Close"]')?.click()`);

// Simulator: power, volume, sound panel.
where = 'sample › simulator';
await go('/#sample:run');
ok(await click('Power'), 'simulator: Power');
await sleep(500);
ok((await js(`document.querySelector('.design-bar .tag')?.textContent`)) === 'Running', 'simulator: product runs after Power');
ok(await click('Volume up'), 'simulator: Volume up');
await sleep(300);
ok(/80%/.test(await js(`document.querySelector('.design-bar')?.innerText`)), 'simulator: level rises to 80%');
ok(await click('White noise'), 'simulator: pick white noise');
await sleep(400);
ok(/white noise/.test(await js(`document.querySelector('.now-head')?.innerText ?? ''`)), 'simulator: sound panel shows white noise');
ok(await click('Sound on'), 'simulator: mute');
await sleep(300);
ok(/muted/.test(await js(`document.querySelector('.now-head')?.innerText ?? ''`)), 'simulator: shows muted');
await shot('21-sample-simulator');
await click('Power');

// Parameters: a slider changes the result.
where = 'sample › parameters';
await go('/#sample:sim');
const t1 = await js(`document.querySelector('.facts-big')?.innerText`);
await js(`(() => { const r = document.querySelector('#sim-load'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '1.5'); r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
ok(t1 !== (await js(`document.querySelector('.facts-big')?.innerText`)), 'parameters: moving the load slider changes the results');

// Bare board: modes and layers.
where = 'sample › bare board';
await go('/#sample:board');
for (const c of ['3D', 'Fabrication preview', 'Layout', 'Bottom · 0', 'Top · 13', 'PCB2', 'PCB1']) { ok(await click(c), `bare board: ${c}`); await sleep(c === 'Fabrication preview' ? 2500 : 600); }
await click('Fabrication preview');
await sleep(2500);
ok(await js(`!!document.querySelector('.fab-svg svg')`), 'bare board: fabrication preview draws');
ok(/Routed in copper/.test(await js(`document.querySelector('.facts')?.innerText`)), 'bare board: copper routing is reported');
await click('Layout');
await sleep(400);
ok((await js(`document.querySelectorAll('.board-copper polyline').length`)) > 3, 'bare board: copper traces drawn');

// Guide links jump to their tab.
where = 'sample › guide';
await go('/#sample:guide');
await js(`[...document.querySelectorAll('.steps .link')].find((b) => b.textContent === 'Simulator')?.click()`);
await sleep(600);
ok((await js(`document.querySelector('.tabs [aria-selected="true"]')?.textContent`)) === 'Simulator', 'guide: link opens the Simulator tab');

// Make tab: the downloads work.
where = 'sample › make';
await go('/#sample:make');
const n0 = readdirSync(DL).length;
await js(`(() => { const b = [...document.querySelectorAll('.card .btn')]; b.slice(0, 3).forEach((x, i) => setTimeout(() => x.click(), i * 400)); })()`);
await sleep(3000);
ok(readdirSync(DL).length > n0, 'make: download buttons save files');
ok(/Checks passed/.test(await js(`document.querySelector('.facts-big')?.innerText`)), 'make: checks summary shown');

// ---------------------------------------------------------------- every saved project, every tab
const projectsBefore = await js(`fetch('/api/projects').then((r) => r.json()).then((j) => j.projects.map((p) => p.id + '@' + p.updatedAt).sort().join())`);
if (saved.length) {
  await go('/');
  const projects = await js(`fetch('/api/projects').then((r) => r.json()).then((j) => j.projects)`);
  for (const [i, p] of projects.entries()) {
    where = `project "${p.title.slice(0, 30)}"`;
    await go('/');
    await waitFor(`!!document.querySelector('.saved-open[data-id=${JSON.stringify(p.id)}]')`);
    const opened = await js(`(() => { const b = document.querySelector('.saved-open[data-id=${JSON.stringify(p.id)}]'); b?.click(); return !!b; })()`);
    if (!ok(opened, `[${where}] opens from the start page`)) continue;
    await waitFor(`!!document.querySelector('.tabs, .bench-plan .worktab, .bench-plan .tab-empty')`);
    await sleep(600);
    if (p.stage === 'design') {
      ok(await js(`!!document.querySelector('.tabs')`), `[${where}] opens to the design`);
      ok(/Loaded from storage/.test(await js(`document.querySelector('.agent-scroll')?.innerText ?? ''`)), `[${where}] says it came from storage`);
      await visitTabs(`project ${i + 1}`, i < 2 ? `3${i}` : '');
      await tab('Fit and mould');
      await sleep(400);
      const wrong = await sheetAdvice();
      ok(wrong.length === 0, `[${where}] no moulding advice on non-moulded parts (${wrong.join(', ')})`);
    } else {
      ok(await js(`!!document.querySelector('.bench-plan .worktab, .bench-plan .tab-empty')`), `[${where}] shows its plan`);
      await layout(where);
    }
  }
}

// Opening a project must not rewrite it.
if (saved.length) {
  const after = await js(`fetch('/api/projects').then((r) => r.json()).then((j) => j.projects.map((p) => p.id + '@' + p.updatedAt).sort().join())`);
  ok(after === projectsBefore, 'opening saved projects does not re-save them');
}

// ---------------------------------------------------------------- narrower screens
for (const [w, name] of [[1180, 'laptop'], [820, 'tablet'], [390, 'phone']]) {
  await setWidth(w, w < 600 ? 844 : 900);
  for (const [path, label] of [['/', 'start'], ['/#sample:view', 'exploded view'], ['/#sample:run', 'simulator'], ['/#sample:board', 'bare board'], ['/#sample:make', 'make']]) {
    where = `${name} ${w}px › ${label}`;
    await go(path);
    await sleep(400);
    ok((await js(`window.scrollY`)) < 40, `[${where}] page opens at the top (it was scrolled to ${await js('Math.round(window.scrollY)')}px)`);
    await layout(where);
    await shot(`5-${name}-${label.replace(/\s+/g, '-')}`);
  }
}
await send('Emulation.clearDeviceMetricsOverride');

// ---------------------------------------------------------------- report
for (const d of dialogs) failures.push(`unexpected dialog ${d}`);
for (const e of [...new Set(pageErrors)]) failures.push(`page error ${e}`);
for (const e of [...new Set(badResponses)]) failures.push(`API error ${e}`);
console.log(`\nUI test: ${checks} checks, ${failures.length} problems. Screenshots in ${OUT}`);
for (const n of notes) console.log(`  note: ${n}`);
for (const f of failures) console.log(`  FAIL ${f}`);
ws.close();
chrome.kill();
process.exit(failures.length ? 1 : 0);
