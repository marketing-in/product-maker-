// Every call to the app's own API goes through here.
//
// On this computer the API is open. On a hosted copy (Vercel) the owner sets an access
// code, because the API spends their Claude credit: the code is asked for once and kept
// in this browser. A hosted copy also has no disk of its own, so projects are kept in
// this browser instead of on the server.

const CODE = 'teardown-lab:code';
const PROJECTS = 'teardown-lab:projects';

let hosted = false;
export const setHosted = (value: boolean) => { hosted = value; };

const read = (): Record<string, { id: string; title: string; createdAt: string; updatedAt: string; project: unknown; teardown: { parts?: unknown[] } | null; original: unknown }> => {
  try { return JSON.parse(localStorage.getItem(PROJECTS) ?? '{}'); } catch { return {}; }
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Projects kept in the browser, answering the same requests the server would. */
function localProjects(url: string, init?: RequestInit): Response {
  const all = read();
  const id = url.split('/')[3];
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!id) {
    const projects = Object.values(all).map((p) => {
      const pr = p.project as { prompt?: string; mode?: string } | null;
      return { id: p.id, title: p.title, prompt: pr?.prompt ?? '', mode: pr?.mode ?? 'design', stage: p.teardown ? 'design' : 'plan', parts: p.teardown?.parts?.length ?? 0, createdAt: p.createdAt, updatedAt: p.updatedAt };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return json({ projects });
  }
  if (method === 'GET') return all[id] ? json(all[id]) : json({ error: 'That project is not saved in this browser.' }, 404);
  if (method === 'DELETE') { delete all[id]; }
  if (method === 'PUT') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const now = new Date().toISOString();
    all[id] = { id, title: body.title ?? 'Untitled', createdAt: all[id]?.createdAt ?? now, updatedAt: now, project: body.project ?? null, teardown: body.teardown ?? null, original: body.original ?? null };
  }
  try {
    localStorage.setItem(PROJECTS, JSON.stringify(all));
  } catch {
    // The browser's storage is full: drop the oldest project and try once more.
    const oldest = Object.values(all).filter((p) => p.id !== id).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    if (!oldest) return json({ error: 'This browser has no room to save the project.' }, 507);
    delete all[oldest.id];
    try { localStorage.setItem(PROJECTS, JSON.stringify(all)); } catch { return json({ error: 'This browser has no room to save the project.' }, 507); }
  }
  return json({ id, deleted: method === 'DELETE' });
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (hosted && url.startsWith('/api/projects')) return localProjects(url, init);
  const send = () => {
    const headers = new Headers(init.headers);
    let code = '';
    try { code = localStorage.getItem(CODE) ?? ''; } catch { /* storage is optional */ }
    if (code) headers.set('x-app-password', code);
    return fetch(url, { ...init, headers });
  };
  let res = await send();
  if (res.status === 401) {
    // Wrong or missing access code: ask once, then try again.
    const code = window.prompt('This site needs its access code to use the agent. Enter the code:');
    if (code) {
      try { localStorage.setItem(CODE, code.trim()); } catch { /* storage is optional */ }
      res = await send();
      if (res.status === 401) { try { localStorage.removeItem(CODE); } catch { /* storage is optional */ } }
    }
  }
  return res;
}
