import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Thin wrapper around the rea CLI (https://github.com/morluto/rea, npm
// package "rea-agents"). rea analyses software artefacts: firmware images,
// flash dumps, binaries, app bundles. Teardown Lab uses it for the firmware
// stage, when the user uploads a file that came out of the product.
//
// rea needs Node 24.22.1 or newer. `npm run setup:rea` installs rea and a Node it supports
// inside tools/rea, and bin/rea runs it; no global install is needed. REA_COMMAND overrides
// this with any other launcher, and a global `rea` on the PATH is the last resort.

const MAX_OUTPUT = 4 * 1024 * 1024;
const TIMEOUT_MS = 180_000;

const LOCAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rea');
const LOCAL_READY = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'rea', 'node_modules', 'rea-agents');
const command = () => process.env.REA_COMMAND
  || (process.platform !== 'win32' && existsSync(LOCAL_READY) ? LOCAL : null)
  || (process.platform === 'win32' ? 'rea.cmd' : 'rea');

function run(args, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ args, stdout, stderr: stderr.slice(-4000), ...result });
    };
    let child;
    let timer;
    try {
      // Arguments are passed as an array, never through a shell string. On
      // Windows a .cmd launcher needs the shell; the only variable argument
      // is a temp path this server generated (hex file name), quoted in case
      // the temp folder has spaces.
      const win = process.platform === 'win32';
      const argv = win ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
      child = spawn(command(), argv, { shell: win, windowsHide: true });
    } catch (err) {
      finish({ ok: false, missing: true, error: String(err.message ?? err) });
      return;
    }
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `rea did not finish within ${Math.round(timeoutMs / 1000)} s.` });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
    });
    child.on('error', (err) => {
      finish({ ok: false, missing: err.code === 'ENOENT', error: String(err.message ?? err) });
    });
    child.on('close', (code) => finish({ ok: code === 0, exitCode: code }));
  });
}

let cachedStatus = null;
let cachedAt = 0;

export async function reaStatus() {
  if (cachedStatus && Date.now() - cachedAt < 30_000) return cachedStatus;
  const res = await run(['--version'], 15_000);
  cachedStatus = res.ok
    ? { available: true, version: res.stdout.trim().split('\n')[0].slice(0, 60), command: command() }
    : { available: false, command: command() };
  cachedAt = Date.now();
  return cachedStatus;
}

function parse(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Inspect one uploaded file. `inspect-artifact` is built into rea and
 * recognises firmware containers and flash images; `inspect-firmware-regions`
 * adds a Binwalk scan when REA_BINWALK_COMMAND is configured (Linux).
 */
export async function inspectFirmware(path) {
  const status = await reaStatus();
  if (!status.available) return { available: false, command: status.command, runs: [] };

  const steps = [
    { title: 'Artifact inventory', args: ['inspect-artifact', path, '--json'] },
    { title: 'Firmware regions (Binwalk)', args: ['inspect-firmware-regions', path, '--json'] },
  ];
  const runs = [];
  for (const step of steps) {
    const res = await run(step.args);
    const json = parse(res.stdout);
    runs.push({
      title: step.title,
      command: `rea ${step.args.map((a) => (a === path ? '<file>' : a)).join(' ')}`,
      ok: res.ok,
      exitCode: res.exitCode ?? null,
      json,
      text: json ? undefined : res.stdout.slice(0, 20_000),
      stderr: res.ok ? undefined : (json?.message || res.stderr || res.error || '').split(path).join('<file>'),
    });
  }
  return { available: true, version: status.version, command: status.command, runs };
}
