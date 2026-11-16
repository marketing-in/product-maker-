import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Everything Claude generates is kept on disk, so it is never paid for twice.
//
//   data/generations/<kind>-<hash>.json   one file per API result, keyed by the exact request
//   data/projects/<id>.json               a whole project: plan, answers, design, edits, chat
//
// The folder is in .gitignore. Delete a file to forget it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const GEN = join(ROOT, 'generations');
const PROJECTS = join(ROOT, 'projects');
const ID = /^[a-z0-9][a-z0-9-]{5,63}$/;

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  // Write beside the target, then swap, so a crash never leaves half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** A stable key for a request: same model, same words, same photos give the same key. */
export function requestKey(kind, model, payload) {
  const hash = createHash('sha256').update(JSON.stringify([kind, model, payload])).digest('hex').slice(0, 32);
  return `${kind}-${hash}`;
}

export async function cacheGet(key) {
  const hit = await readJson(join(GEN, `${key}.json`));
  return hit?.result ?? null;
}

/** Saved as soon as the result arrives, before it is sent to the browser. */
export async function cachePut(key, { request, result, usage, model }) {
  try {
    await writeJson(join(GEN, `${key}.json`), { savedAt: new Date().toISOString(), model, request, usage, result });
  } catch (err) {
    console.error('[store] could not save a generation:', err?.message);
  }
}

export async function cacheStats() {
  try {
    return (await readdir(GEN)).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

export const validId = (id) => typeof id === 'string' && ID.test(id);

export async function listProjects() {
  let files = [];
  try {
    files = (await readdir(PROJECTS)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const rows = await Promise.all(files.map(async (f) => {
    const p = await readJson(join(PROJECTS, f));
    if (!p?.id) return null;
    return {
      id: p.id,
      title: p.title || 'Untitled',
      prompt: typeof p.project?.prompt === 'string' ? p.project.prompt.slice(0, 160) : '',
      mode: p.project?.mode ?? 'design',
      stage: p.teardown ? 'design' : 'plan',
      parts: Array.isArray(p.teardown?.parts) ? p.teardown.parts.length : 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }));
  return rows.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(id) {
  return validId(id) ? readJson(join(PROJECTS, `${id}.json`)) : null;
}

export async function saveProject(id, body) {
  const file = join(PROJECTS, `${id}.json`);
  const before = await readJson(file);
  const now = new Date().toISOString();
  const doc = {
    id,
    title: typeof body.title === 'string' ? body.title.slice(0, 120) : 'Untitled',
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
    project: body.project ?? null,
    teardown: body.teardown ?? null,
    original: body.original ?? null,
  };
  await writeJson(file, doc);
  return { id, updatedAt: now };
}

export async function deleteProject(id) {
  if (!validId(id)) return false;
  try {
    await unlink(join(PROJECTS, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
