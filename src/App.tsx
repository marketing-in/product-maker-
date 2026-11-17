import { apiFetch, setHosted } from './lib/api';
import { ChevronDown, Download, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import Agent, { type Project } from './components/Agent';
import Architecture from './components/Architecture';
import BareBoard from './components/BareBoard';
import BomTable from './components/BomTable';
import Designer from './components/Designer';
import Firmware, { type ReaStatus } from './components/Firmware';
import FitMould from './components/FitMould';
import Guide, { type TabId } from './components/Guide';
import Inspector from './components/Inspector';
import Intake from './components/Intake';
import { BoardPreview, Make, Plan, type ExportKind } from './components/Make';
import PartList from './components/PartList';
import PowerTree from './components/PowerTree';
import Simulation from './components/Simulation';
import Simulator from './components/Simulator';
import Viewer3D, { KIND_COLOR, type AgentCursor } from './components/Viewer3D';

// One colour per agent cursor. Distinct from the selection amber and the wire colours.
const AGENT_COLORS = ['#7c5cff', '#0f9d8a', '#e0457b', '#2f7de1', '#d9822b', '#5a9e2f'];
import { buildBlenderScript } from './lib/exportBlender';
import { boards } from './lib/board';
import { buildBomCsv, download } from './lib/exportBom';
import { buildGerberSet, downloadBytes, zip } from './lib/exportGerber';
import { buildPcbProject } from './lib/exportPcbProject';
import { buildStep } from './lib/exportStep';
import { slug } from './lib/geometry';
import { SAMPLE } from './lib/sample';
import { validate, type Brief, type ImportedBoard } from './lib/validate';

/** Draws an SVG to a PNG in the browser, so the model can look at the board. */
async function svgToPng(svg: string, maxEdge = 1600): Promise<string | null> {
  try {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    const k = maxEdge / Math.max(img.naturalWidth || 800, img.naturalHeight || 600);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((img.naturalWidth || 800) * k);
    canvas.height = Math.round((img.naturalHeight || 600) * k);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

interface Saved { id: string; title: string; prompt: string; mode: string; stage: 'plan' | 'design'; parts: number; updatedAt: string }
const PENDING = 'teardown-lab:building';
const newId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
import { KIND_LABEL, type ConnectionKind, type Part, type Teardown, type Vec3 } from './lib/types';

interface Status { hasKey: boolean; model: string; stored?: number; hosted?: boolean; locked?: boolean; rea: ReaStatus }
type Tab = TabId;

const TABS: { id: Tab; label: string }[] = [
  { id: 'view', label: 'Exploded view' },
  { id: 'design', label: 'Design' },
  { id: 'run', label: 'Simulator' },
  { id: 'arch', label: 'Architecture' },
  { id: 'board', label: 'Bare board' },
  { id: 'fit', label: 'Fit and mould' },
  { id: 'sim', label: 'Parameters' },
  { id: 'power', label: 'Power tree' },
  { id: 'bom', label: 'Bill of materials' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'make', label: 'Make' },
  { id: 'guide', label: 'Guide' },
];

const DEFAULT_KINDS: Record<ConnectionKind, boolean> = {
  power: true, ground: true, signal: true, rf: true, mechanical: false,
};
const START_KINDS: Record<ConnectionKind, boolean> = { ...DEFAULT_KINDS, ground: false };

const EXAMPLES = [
  'I need a robot',
  'A plant monitor that beeps when the soil is dry',
  'A bedside sound machine with a volume knob',
  'A desk fan with a USB-C plug and one button',
];

function Mark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="mark">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <path d="M4 8.2 12 4l8 4.2-8 4.2z" />
        <path d="M4 12.6l8 4.2 8-4.2" opacity=".7" />
        <path d="M4 17l8 4.2 8-4.2" opacity=".4" />
      </g>
    </svg>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [td, setTd] = useState<Teardown | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('view');
  const [explode, setExplode] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [kinds, setKinds] = useState(DEFAULT_KINDS);
  const [showValues, setShowValues] = useState(true);
  const [xray, setXray] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [mode, setMode] = useState<'design' | 'teardown' | 'board'>('design');
  const [importError, setImportError] = useState('');
  // The model as it stands while a team of agents is still building it.
  const [live, setLive] = useState<Teardown | null>(null);
  const [liveZones, setLiveZones] = useState<{ id: string; name: string; center: Vec3; size: Vec3 }[]>([]);
  const [leftView, setLeftView] = useState<'agent' | 'parts'>('agent');
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveNote, setSaveNote] = useState('');
  const refreshSaved = useCallback(() => {
    apiFetch('/api/projects').then((r) => (r.ok ? r.json() : { projects: [] })).then((j) => setSaved(j.projects ?? [])).catch(() => {});
  }, []);
  useEffect(refreshSaved, [refreshSaved]);
  const patch = useCallback((p: Partial<Project>) => setProject((prev) => (prev ? { ...prev, ...p } : prev)), []);
  const [, setError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  // Design edits: the teardown as it was opened, and the steps back to it.
  const [original, setOriginal] = useState<Teardown | null>(null);
  const [history, setHistory] = useState<Teardown[]>([]);
  const exportRef = useRef<HTMLDivElement>(null);
  const explodeRef = useRef(explode);
  explodeRef.current = explode;

  useEffect(() => {
    apiFetch('/api/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Status) => { setHosted(Boolean(s.hosted)); setStatus(s); if (s.hosted) refreshSaved(); })
      .catch(() => setStatusFailed(true));
  }, []);

  // A link such as /#sample:board opens the sample on that tab.
  useEffect(() => {
    const m = /^#sample(?::(\w+))?$/.exec(window.location.hash);
    if (!m) return;
    setTd(SAMPLE);
    setOriginal(SAMPLE);
    if (TABS.some((t) => t.id === m[1])) setTab(m[1] as Tab);
  }, []);

  // Animate the explode slider when Play is pressed.
  useEffect(() => {
    if (!playing) return;
    const from = explodeRef.current;
    const to = from > 0.5 ? 0 : 1;
    const t0 = performance.now();
    const dur = 1300;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(2, -9 * k);
      setExplode(k >= 1 ? to : from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (ev: Event) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !exportRef.current?.contains(ev.target as Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [exportOpen]);

  const edit = useCallback((next: Teardown) => {
    setTd((prev) => {
      if (prev && prev !== next) setHistory((h) => [...h.slice(-49), prev]);
      return next;
    });
  }, []);
  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length) setTd(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const open = useCallback((next: Teardown) => {
    setTd(next);
    setOriginal(next);
    setHistory([]);
    setSelectedId(null);
    setTab('view');
    setExplode(0);
    setResetSignal((n) => n + 1);
    setPlaying(true);
  }, []);

  const post = useCallback(async (url: string, body: unknown) => {
    try {
      const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `The server answered ${res.status}.`);
      return json;
    } catch (err) {
      throw new Error(
        err instanceof TypeError
          ? 'The local server is not reachable. Start it with “npm run dev” and try again.'
          : err instanceof Error ? err.message : 'That did not work.',
      );
    }
  }, []);

  /** Swarm build: reads the stream of events and grows the live model as each agent finishes. */
  const buildWithSwarm = useCallback(async (description: string, title: string): Promise<{ teardown: Teardown; cached: boolean }> => {
    const res = await apiFetch('/api/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description }) })
      .catch(() => { throw new Error('The local server is not reachable. Start it with “npm run dev” and try again.'); });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `The server answered ${res.status}.`);
    type Zone = { id: string; name: string; center: Vec3; size: Vec3 };
    let zones: Zone[] = [];
    const done = new Map<string, Part[]>();
    let shell: Teardown | null = null;
    const redraw = () => {
      if (!shell) return;
      // A sub-assembly still being designed is drawn as a ghost box where it will go.
      const ghosts: Part[] = zones.filter((z) => !done.has(z.id)).map((z) => ({
        id: `ghost-${z.id}`, name: `${z.name} (being designed)`, category: 'enclosure', qty: 1, function: '', confidence: 'assumed',
        evidence: '', shape: 'box', size: z.size, position: z.center, explode: [0, 0, 0], color: '#8f8a7f',
      }));
      setLive({ ...shell, parts: [...[...done.values()].flat(), ...ghosts] });
    };
    const num3 = (v: unknown, d: Vec3): Vec3 => (Array.isArray(v) && v.length >= 3 && v.every((n) => Number.isFinite(n)) ? [v[0], v[1], v[2]] : d);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === 'status') patch({ note: ev.text });
        if (ev.type === 'layout') {
          zones = (ev.zones as Zone[]).map((z) => ({ ...z, center: num3(z.center, [0, 0, 0]), size: num3(z.size, [20, 20, 20]).map((n) => Math.max(1, Math.abs(n))) as Vec3 }));
          shell = {
            product: { name: title, category: '', summary: '', dimensionsMm: num3(ev.product?.dimensionsMm, [100, 100, 50]) },
            parts: [], connections: [], unknowns: [], verifySteps: [], safety: [],
            meta: { source: 'claude', createdAt: new Date().toISOString() },
          };
          setLiveZones(zones);
          patch({ zones: zones.map((z) => ({ id: z.id, name: z.name, status: 'wait', parts: 0 })), note: 'The agents have their briefs' });
          redraw();
        }
        if (ev.type === 'zone-start' || ev.type === 'zone-done' || ev.type === 'zone-failed') {
          if (ev.type === 'zone-done') { done.set(ev.id, ev.parts as Part[]); redraw(); }
          if (ev.type === 'zone-failed') { done.set(ev.id, []); redraw(); }
          const status = ev.type === 'zone-start' ? 'work' : ev.type === 'zone-done' ? 'done' : 'failed';
          setProject((prev) => (prev ? { ...prev, zones: prev.zones?.map((z) => (z.id === ev.id ? { ...z, status, parts: ev.parts?.length ?? z.parts } : z)) } : prev));
        }
        if (ev.type === 'error') throw new Error(ev.message);
        if (ev.type === 'done') return { teardown: ev.teardown as Teardown, cached: Boolean(ev.cached) };
      }
    }
    throw new Error('The connection closed before the build finished. Press “Try again”: the work so far is kept on the server.');
  }, [patch]);

  /** Design step: build the full model, from a plan or from photos of a real product. */
  const design = useCallback(async (p: Project) => {
    setBusy(true);
    setError('');
    setProject({ ...p, phase: 'designing', since: Date.now(), error: '', zones: undefined, note: undefined });
    setLive(null);
    // Remember the build in progress, so a reload or a closed tab picks it up again.
    try { localStorage.setItem(PENDING, JSON.stringify({ ...p, images: [], zones: undefined, note: undefined })); } catch { /* storage is optional */ }
    try {
      let description = p.prompt;
      let images = p.images;
      let board: unknown;
      if (p.board) {
        // The model gets the measured data as text and a picture of the board to read.
        const { svgTop, svgBottom, ...facts } = p.board;
        void svgBottom;
        board = facts;
        const png = svgTop ? await svgToPng(svgTop) : null;
        images = png ? [png] : [];
      }
      if (p.mode === 'design' && p.brief) {
        const b = p.brief;
        description = [
          `Idea: ${p.prompt}`,
          `Product: ${b.title}. ${b.understanding}`,
          'Choices made by the user:',
          ...b.questions.map((q) => `- ${q.question} ${p.answers[q.id] ?? q.assumed}`),
          'Requirements:', ...b.requirements.map((r) => `- ${r}`),
          'Blocks:', ...b.blocks.map((x) => `- ${x.name}: ${x.role}${x.parts ? ` (${x.parts})` : ''}`),
        ].join('\n');
      }
      // A new product is built by a team of agents in parallel. A real product or a board is one careful pass.
      const json = p.mode === 'design' && !p.board
        ? await buildWithSwarm(description, p.brief?.title ?? p.prompt.slice(0, 60))
        : await post('/api/analyze', { description, images, design: p.mode !== 'teardown', board });
      open(json.teardown as Teardown);
      setLive(null);
      patch({ phase: 'ready', fromStore: Boolean(json.cached) });
    } catch (err) {
      patch({ phase: 'error', error: (err as Error).message });
    } finally {
      try { localStorage.removeItem(PENDING); } catch { /* storage is optional */ }
      setBusy(false);
    }
  }, [buildWithSwarm, open, patch, post]);

  // A build that was running when the page closed or reloaded: join it again. The server kept
  // working, so this replays what is done and carries on, or returns the stored result at once.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !status?.hasKey) return;
    resumed.current = true;
    try {
      const raw = localStorage.getItem(PENDING);
      if (!raw || /^#sample/.test(window.location.hash)) return;
      const p = JSON.parse(raw) as Project;
      if (p?.id && (p.brief || p.board || p.mode === 'teardown')) void design(p);
    } catch { /* nothing to resume */ }
  }, [status, design]);

  /** Brainstorm step: questions and a plan for a new idea. Photos mean a real product, so that goes straight to design. */
  const start = useCallback(async (text: string, images: string[], as: 'design' | 'teardown' | 'board' = mode) => {
    const p: Project = {
      id: newId(), mode: as, prompt: text, images, phase: 'briefing', brief: null, answers: {}, since: Date.now(), error: '', turns: [],
    };
    setTd(null);
    setSelectedId(null);
    setLeftView('agent');
    if (as === 'teardown' || images.length > 0) {
      void design({ ...p, mode: 'teardown' });
      return;
    }
    setProject(p);
    setBusy(true);
    try {
      const json = await post('/api/brief', { idea: text });
      patch({ phase: 'plan', brief: json.brief as Brief, fromStore: Boolean(json.cached) });
    } catch (err) {
      patch({ phase: 'error', error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [design, mode, patch, post]);

  /** A Gerber set or KiCad board the user has: read it, then offer to design the housing. */
  const importBoard = useCallback(async (files: File[], note: string) => {
    if (!files.length) return;
    setBusy(true);
    setImportError('');
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      const res = await apiFetch('/api/board-import', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `The server answered ${res.status}.`);
      const board = json.board as ImportedBoard;
      setTd(null);
      setSelectedId(null);
      setLeftView('agent');
      setProject({
        id: newId(), mode: 'board', board, prompt: note || `Design a housing for my board (${board.name}).`, images: [],
        phase: 'plan', brief: null, answers: {}, since: Date.now(), error: '', turns: [],
      });
    } catch (err) {
      setImportError(err instanceof TypeError ? 'The local server is not reachable. Start it with “npm run dev”.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  /** A change asked for in the chat, once a design exists. */
  const refine = useCallback(async (text: string, images: string[]) => {
    if (!td) return;
    const say = (who: 'you' | 'agent', line: string) => setProject((prev) => {
      const base: Project = prev ?? {
        id: newId(), mode: 'teardown', prompt: td.product.name, images: [], phase: 'ready', brief: null, answers: {}, since: Date.now(), error: '', turns: [],
      };
      return { ...base, since: who === 'you' ? Date.now() : base.since, turns: [...base.turns, { who, text: line }] };
    });
    say('you', text || 'See the photos.');
    setBusy(true);
    try {
      const json = await post('/api/analyze', { instruction: text, images, previous: { ...td, meta: undefined } });
      const next = { ...(json.teardown as Teardown), firmware: td.firmware };
      setTd(next);
      setOriginal(next);
      setHistory([]);
      setSelectedId((id) => (next.parts.some((x) => x.id === id) ? id : null));
      const diff = next.parts.length - td.parts.length;
      say('agent', `Done. The design now has ${next.parts.length} part lines${diff ? ` (${diff > 0 ? '+' : ''}${diff})` : ''} and ${next.connections.length} connections. The checks have been re-run.`);
    } catch (err) {
      say('agent', `That did not work: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [post, td]);

  const checks = useMemo(() => (td ? validate(td) : []), [td]);

  // A cursor for each agent in the swarm, over the piece it is building. When every builder is
  // done, an integrator cursor hops between the pieces while it wires them together.
  const zoneStates = project?.zones;
  const cursors = useMemo<AgentCursor[]>(() => {
    if (!live || !zoneStates?.length) return [];
    const short = (name: string) => name.split(/[\s,]+/).filter((w) => !/^(and|the|of|with|for|&)$/i.test(w)).slice(0, 2).join(' ');
    const list: AgentCursor[] = liveZones.flatMap((z, i) => {
      const st = zoneStates.find((s) => s.id === z.id)?.status ?? 'wait';
      if (st === 'done' || st === 'failed') return [];
      return [{ id: z.id, name: short(z.name), color: AGENT_COLORS[i % AGENT_COLORS.length], mode: st === 'work' ? 'work' as const : 'wait' as const, center: z.center, size: z.size }];
    });
    if (zoneStates.every((s) => s.status === 'done' || s.status === 'failed')) {
      list.push({ id: 'integrator', name: 'Wiring', color: '#c4421c', mode: 'roam', center: [0, 0, 0], size: [1, 1, 1], stops: liveZones.map((z) => z.center) });
    }
    return list;
  }, [live, liveZones, zoneStates]);

  // Save the project a moment after anything changes: plan, answers, design, edits, chat.
  // Photos are left out to keep the file small. Opening a project is not a change: what was
  // last loaded or saved is remembered, and the same content is never written again.
  const lastSaved = useRef('');
  const contentKey = (p: Project, t: Teardown | null, o: Teardown | null) =>
    JSON.stringify([p.id, p.prompt, p.brief, p.answers, p.turns, p.board?.name ?? null, t, o]);
  useEffect(() => {
    if (!project || (!project.brief && !project.board && !td) || project.phase === 'briefing' || project.phase === 'designing') return;
    const key = contentKey(project, td, original);
    if (key === lastSaved.current) return;
    const t = window.setTimeout(() => {
      lastSaved.current = key;
      apiFetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: td?.product.name ?? project.brief?.title ?? (project.board ? `Housing for ${project.board.name}` : project.prompt.slice(0, 60)),
          project: { ...project, images: [], error: '' },
          teardown: td,
          original,
        }),
      })
        .then((r) => setSaveNote(r.ok ? 'Saved' : 'Not saved'))
        .catch(() => setSaveNote('Not saved'));
    }, 700);
    return () => window.clearTimeout(t);
  }, [project, td, original]);

  const openSaved = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/api/projects/${id}`);
      if (!res.ok) throw new Error();
      const doc = await res.json() as { project: Project | null; teardown: Teardown | null; original: Teardown | null };
      const next = doc.teardown;
      const loaded = doc.project ? { ...doc.project, id, images: [], phase: next ? 'ready' as const : 'plan' as const, error: '', fromStore: true } : null;
      if (loaded) lastSaved.current = contentKey(loaded, next, doc.original ?? next);
      setProject(loaded);
      setTd(next);
      setOriginal(doc.original ?? next);
      setHistory([]);
      setSelectedId(null);
      setExplode(0);
      setTab(next ? 'view' : 'plan');
      setLeftView('agent');
    } catch {
      setSaveNote('That project could not be opened.');
    }
  }, []);

  const closeProject = () => { setTd(null); setLive(null); setProject(null); setError(''); setSaveNote(''); refreshSaved(); };

  const [working, setWorking] = useState('');
  const exportAs = (kind: ExportKind) => {
    if (!td) return;
    const base = slug(td.product.name);
    if (kind === 'everything' || kind === 'report') {
      setExportOpen(false);
      if (working) return;
      // Loaded only when asked for: the PDF library is large.
      setWorking(kind === 'report' ? 'Writing the product report' : 'Preparing the download');
      void (async () => {
        try {
          if (kind === 'report') {
            const { buildReport } = await import('./lib/report');
            downloadBytes(`${base}-report.pdf`, await buildReport(td), 'application/pdf');
          } else {
            const { buildEverything } = await import('./lib/exportAll');
            const out = await buildEverything(td, setWorking);
            downloadBytes(out.name, out.bytes, 'application/zip');
          }
        } catch (err) {
          console.error('[export]', err);
          window.alert(`The download could not be made: ${(err as Error).message}`);
        } finally {
          setWorking('');
        }
      })();
      return;
    }
    if (kind === 'step') download(`${base}.step`, buildStep(td, 0), 'model/step');
    if (kind === 'step-exploded') download(`${base}-exploded.step`, buildStep(td, 1), 'model/step');
    if (kind === 'blender') download(`${base}-blender.py`, buildBlenderScript(td), 'text/x-python');
    if (kind === 'gerber') {
      const files = boards(td).flatMap((b, _i, all) =>
        buildGerberSet(b, td.product.name).map((f) => (all.length > 1 ? { ...f, name: `${slug(b.part.refDes ?? b.part.id)}/${f.name}` } : f)),
      );
      downloadBytes(`${base}-gerbers.zip`, zip(files), 'application/zip');
    }
    if (kind === 'pcb-project') downloadBytes(`${base}-pcb-project.zip`, zip(buildPcbProject(td, boards(td))), 'application/zip');
    if (kind === 'bom') download(`${base}-bom.csv`, buildBomCsv(td), 'text/csv');
    if (kind === 'json') download(`${base}-teardown.json`, JSON.stringify(td, null, 2), 'application/json');
    setExportOpen(false);
  };

  const canAnalyse = Boolean(status?.hasKey) && !status?.locked;
  const onThisComputer = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Mark />
          <span>Teardown Lab</span>
        </div>
        {(td || project) && (
          <p className="topbar-product" title={td?.product.name ?? project?.brief?.title}>{td?.product.name ?? project?.brief?.title ?? 'New project'}</p>
        )}
        {(td || project) && (
          <ol className="stages" aria-label="Stage">
            {([
              [project?.board ? 'Board' : 'Brainstorm', !td, Boolean(project?.brief || project?.board), () => setTab('plan')],
              ['Design', Boolean(td) && tab !== 'make' && tab !== 'plan', Boolean(td), () => setTab('view')],
              ['Make', Boolean(td) && tab === 'make', Boolean(td), () => setTab('make')],
            ] as const).map(([label, current, enabled, go], i) => (
              <li key={label}>
                <button type="button" aria-current={current || (i === 0 && tab === 'plan') ? 'step' : undefined} disabled={!enabled || !td} onClick={go}>
                  <span className="num">{i + 1}</span>{label}
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="topbar-actions">
          {saveNote && (td || project) && <span className="save-note" role="status">{saveNote}</span>}
          {working && <span className="save-note" role="status">{working}…</span>}
          {td && (
            <div className="menu" ref={exportRef}>
              <button
                type="button"
                className="btn"
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                onClick={() => setExportOpen((v) => !v)}
              >
                <Download size={15} />
                Export
                <ChevronDown size={14} />
              </button>
              {exportOpen && (
                <div className="menu-pop" role="menu">
                  <button type="button" role="menuitem" onClick={() => exportAs('everything')}>
                    <span><strong>Everything</strong>: report, CAD, boards, data</span><span className="ext">.zip</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => exportAs('report')}>
                    <span>Product report</span><span className="ext">.pdf</span>
                  </button>
                  <hr className="menu-rule" />
                  <button type="button" role="menuitem" onClick={() => exportAs('step')}>
                    <span>CAD model, assembled</span><span className="ext">.step</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => exportAs('step-exploded')}>
                    <span>CAD model, exploded</span><span className="ext">.step</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => exportAs('blender')}>
                    <span>Blender scene, realistic render</span><span className="ext">.py</span>
                  </button>
                  {td.parts.some((p) => p.category === 'pcb') && (
                    <button type="button" role="menuitem" onClick={() => exportAs('gerber')}>
                      <span>Gerber set, all boards</span><span className="ext">.zip</span>
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={() => exportAs('bom')}>
                    <span>Bill of materials</span><span className="ext">.csv</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => exportAs('json')}>
                    <span>Teardown data</span><span className="ext">.json</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {(td || project) && (
            <button type="button" className="btn" onClick={closeProject} disabled={busy && !td}>
              <Plus size={15} />
              New project
            </button>
          )}
        </div>
      </header>

      {!td && !project ? (
        <main className="start">
          <section className="start-form">
            <h1>What do you want to build?</h1>
            <p className="start-lede">
              Say it in a sentence. The agent asks what it needs to know, plans it, designs the parts, the board and the
              housing, checks the result, and hands you the files to make it.
            </p>

            <div className="kinds" role="group" aria-label="What to do">
              <button type="button" className="chip" aria-pressed={mode === 'design'} onClick={() => setMode('design')}>Design something new</button>
              <button type="button" className="chip" aria-pressed={mode === 'teardown'} onClick={() => setMode('teardown')}>Take apart a product I have</button>
              <button type="button" className="chip" aria-pressed={mode === 'board'} onClick={() => setMode('board')}>Make a housing for my board</button>
            </div>

            {mode === 'board' && (
              <form
                className="intake intake-start"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const data = new FormData(ev.currentTarget);
                  void importBoard(data.getAll('files').filter((f): f is File => f instanceof File && f.size > 0), String(data.get('note') ?? '').trim());
                }}
              >
                <label className="field-label" htmlFor="board-files">Your board files</label>
                <input id="board-files" name="files" type="file" multiple required accept=".zip,.gbr,.ger,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gtp,.gbp,.gko,.gm1,.drl,.xln,.txt,.csv,.pos,.kicad_pcb" />
                <p className="hint">
                  A Gerber set (the files, or the .zip you would send to a board house) or a KiCad board file
                  (<code>.kicad_pcb</code>). A placement file in the same upload names the parts.
                </p>
                <label className="field-label" htmlFor="board-note">Anything the housing must do (optional)</label>
                <textarea id="board-note" name="note" rows={2} placeholder="For example: wall mounted, splash proof, the USB port must be reachable from the side." />
                <div className="intake-actions">
                  <span />
                  <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Reading…' : 'Read the board'}</button>
                </div>
                {importError && <p className="error" role="alert">{importError}</p>}
              </form>
            )}

            {mode !== 'board' && <Intake
              key={mode}
              variant="start"
              busy={busy}
              canAnalyse={canAnalyse}
              onSubmit={(t, imgs) => void start(t, imgs)}
              labels={mode === 'design'
                ? { field: 'Your idea', placeholder: 'For example: I need a small robot that follows a line on the floor.', submit: 'Start', hint: 'No photos needed. Add them only if you have a sketch or a product to copy the shape of.' }
                : { submit: 'Take it apart' }}
            />}

            {mode === 'design' && (
              <div className="examples">
                <span className="hint">Or try one:</span>
                {EXAMPLES.map((e) => (
                  <button key={e} type="button" className="chip" disabled={!canAnalyse || busy} onClick={() => void start(e, [], 'design')}>{e}</button>
                ))}
              </div>
            )}

            <ol className="start-steps">
              <li><strong>Brainstorm.</strong> The agent asks a few questions with ready answers and writes a plan: requirements, blocks, parts, risks. Under a minute.</li>
              <li><strong>Design.</strong> It builds the 3D model, the board, the wiring and the controls, then runs electrical, fit, heat and battery checks. Several minutes.</li>
              <li><strong>Make.</strong> Cost, and files for KiCad, a board house, CAD and Blender. Edit anything by hand or by asking.</li>
              <li><strong>Kept.</strong> Every result is stored on this computer. Reopening a project or repeating a request costs nothing.</li>
            </ol>

            {saved.length > 0 && (
              <section className="saved" aria-label="Your projects">
                <h2>Your projects</h2>
                <p className="hint">Stored on this computer. Opening one uses no tokens.</p>
                <ul>
                  {saved.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="saved-open" data-id={p.id} onClick={() => void openSaved(p.id)}>
                        <strong>{p.title}</strong>
                        <span className="hint">
                          {p.stage === 'design' ? `Design, ${p.parts} parts` : 'Plan only'} · {new Date(p.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete ${p.title}`}
                        onClick={() => {
                          if (window.confirm(`Delete “${p.title}” from this computer? This cannot be undone.`)) {
                            void apiFetch(`/api/projects/${p.id}`, { method: 'DELETE' }).then(refreshSaved);
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {statusFailed && (
              <p className="callout" role="status">
                {onThisComputer
                  ? <>The local API is not running, so the agent is off. Start both parts with <code>npm run dev</code>. The sample still works.</>
                  : <>The API of this site is not answering, so the agent is off. The sample still works. If you run this site, check the deployment logs.</>}
              </p>
            )}
            {status?.locked && (
              <p className="callout" role="status">
                The agent is switched off on this site because no access code is set. If you run this site, add
                {' '}<code>APP_PASSWORD</code> in its settings and redeploy. The sample works without it.
              </p>
            )}
            {status?.hosted && !status.locked && status.hasKey && (
              <p className="hint">This is a hosted copy. The agent asks for the access code once. Your projects are kept in this browser.</p>
            )}
            {status && !status.hasKey && (
              <p className="callout" role="status">
                {onThisComputer
                  ? <>No Claude API key is set, so the agent is off. Put <code>ANTHROPIC_API_KEY=…</code> in the <code>.env</code> file and restart. The sample works without it.</>
                  : <>No Claude API key is set on this site, so the agent is off. If you run it, add <code>ANTHROPIC_API_KEY</code> in its settings and redeploy. The sample works without it.</>}
              </p>
            )}
          </section>

          <section className="start-sample" aria-label="Sample teardown">
            <div className="start-sample-view">
              <Viewer3D
                td={SAMPLE}
                explode={0.8}
                selectedId={null}
                onSelect={(id) => { if (id) open(SAMPLE); }}
                kinds={START_KINDS}
                showValues={false}
                xray
                resetSignal={0}
                autoRotate
              />
            </div>
            <div className="start-sample-foot">
              <p>
                <strong>Sample.</strong> A generic Bluetooth speaker: {SAMPLE.parts.length} part lines,{' '}
                {SAMPLE.connections.length} connections, power traced from the USB-C port to each driver.
              </p>
              <button type="button" className="btn" onClick={() => open(SAMPLE)}>Open the sample</button>
            </div>
          </section>
        </main>
      ) : (
        <main className={`bench${td ? '' : ' is-planning'}`}>
          <div className="bench-left">
            <div className="left-switch" role="tablist" aria-label="Left panel">
              <button type="button" role="tab" aria-selected={leftView === 'agent'} onClick={() => setLeftView('agent')}>Agent</button>
              <button type="button" role="tab" aria-selected={leftView === 'parts'} onClick={() => setLeftView('parts')} disabled={!td}>
                Parts{td ? ` · ${td.parts.length}` : ''}
              </button>
            </div>
            {leftView === 'parts' && td ? (
              <PartList td={td} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <Agent
                project={project}
                td={td}
                checks={checks}
                busy={busy}
                canAnalyse={canAnalyse}
                onAnswer={(id, option) => setProject((p) => (p ? { ...p, answers: { ...p.answers, [id]: option } } : p))}
                onBuild={() => { if (project) void design(project); }}
                onRefine={(t, imgs) => void refine(t, imgs)}
                onOpen={setTab}
                onRetry={() => { if (project) void (project.brief || project.board || project.mode === 'teardown' ? design(project) : start(project.prompt, project.images, 'design')); }}
              />
            )}
          </div>

          {!td ? (
            <div className={`bench-main bench-plan${live ? ' is-live' : ''}`}>
              {live ? (
                <div className="live">
                  <Viewer3D
                    td={live}
                    explode={0}
                    selectedId={null}
                    onSelect={() => {}}
                    kinds={{ power: false, ground: false, signal: false, rf: false, mechanical: false }}
                    showValues={false}
                    xray
                    resetSignal={0}
                    keepView
                    cursors={cursors}
                  />
                  <p className="live-note" role="status">
                    <strong>Building.</strong>{' '}
                    {project?.zones ? `${project.zones.filter((z) => z.status === 'done').length} of ${project.zones.length} sub-assemblies done, ${live.parts.filter((x) => !x.id.startsWith('ghost-')).length} parts so far.` : ''}{' '}
                    Grey boxes are pieces still being designed.
                  </p>
                </div>
              ) : project?.board ? (
                <BoardPreview board={project.board} designing={project.phase === 'designing'} />
              ) : project?.brief ? (
                <Plan brief={project.brief} td={null} designing={project.phase === 'designing'} />
              ) : (
                <div className="tab-empty">
                  <h2>{project?.phase === 'error' ? 'That did not work' : project?.mode === 'teardown' ? 'Taking it apart' : 'Planning'}</h2>
                  <p>
                    {project?.phase === 'error'
                      ? 'See the message on the left.'
                      : project?.mode === 'teardown'
                        ? 'The 3D model, board and simulator open here when the analysis is done. It takes several minutes.'
                        : 'The plan appears here in under a minute.'}
                  </p>
                </div>
              )}
            </div>
          ) : (
          <div className="bench-main">
            <div className="tabs" role="tablist" aria-label="Views">
              {(project?.brief ? [{ id: 'plan' as Tab, label: 'Plan' }, ...TABS] : project?.board ? [{ id: 'plan' as Tab, label: 'Your board' }, ...TABS] : TABS).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'view' && (
                <div className="stage">
                  <Viewer3D
                    td={td}
                    explode={explode}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    kinds={kinds}
                    showValues={showValues}
                    xray={xray}
                    resetSignal={resetSignal}
                  />
                  <div className="stage-controls">
                    <div className="explode">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={playing ? 'Pause' : explode > 0.5 ? 'Assemble' : 'Explode'}
                        onClick={() => setPlaying((p) => !p)}
                      >
                        {playing ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <label htmlFor="explode-range">Explode</label>
                      <input
                        id="explode-range"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={explode}
                        style={{ '--fill': `${explode * 100}%` } as CSSProperties}
                        onChange={(ev) => { setPlaying(false); setExplode(Number(ev.target.value)); }}
                      />
                      <output htmlFor="explode-range" className="num">{Math.round(explode * 100)}%</output>
                    </div>

                    <div className="kinds" role="group" aria-label="Wiring shown">
                      {(Object.keys(KIND_LABEL) as ConnectionKind[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          className="chip"
                          aria-pressed={kinds[k]}
                          onClick={() => setKinds((prev) => ({ ...prev, [k]: !prev[k] }))}
                        >
                          <span className="kind-dot" style={{ background: KIND_COLOR[k] }} aria-hidden="true" />
                          {KIND_LABEL[k]}
                        </button>
                      ))}
                    </div>

                    <div className="toggles">
                      <button type="button" className="chip" aria-pressed={showValues} onClick={() => setShowValues((v) => !v)}>
                        Volts, amps, watts
                      </button>
                      <button type="button" className="chip" aria-pressed={xray} onClick={() => setXray((v) => !v)}>
                        See-through housing
                      </button>
                      <button type="button" className="icon-btn" aria-label="Reset the view" onClick={() => setResetSignal((n) => n + 1)}>
                        <RotateCcw size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {tab === 'design' && (
                <Designer
                  td={td}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onChange={edit}
                  onUndo={undo}
                  canUndo={history.length > 0}
                  onReset={() => { if (original) edit(original); }}
                  canReset={Boolean(original) && td !== original}
                />
              )}
              {tab === 'run' && <Simulator td={td} selectedId={selectedId} onSelect={setSelectedId} />}
              {tab === 'plan' && project?.brief && <Plan brief={project.brief} td={td} designing={false} />}
              {tab === 'plan' && project?.board && <BoardPreview board={project.board} designing={false} />}
              {tab === 'make' && <Make td={td} checks={checks} onOpen={setTab} onExport={exportAs} working={working} />}
              {tab === 'guide' && <Guide td={td} onOpen={setTab} />}
              {tab === 'arch' && <Architecture td={td} selectedId={selectedId} onSelect={setSelectedId} />}
              {tab === 'board' && <BareBoard td={td} selectedId={selectedId} onSelect={setSelectedId} />}
              {tab === 'fit' && <FitMould td={td} selectedId={selectedId} onSelect={setSelectedId} />}
              {tab === 'sim' && <Simulation td={td} selectedId={selectedId} onSelect={setSelectedId} />}
              {tab === 'power' && <PowerTree td={td} selectedId={selectedId} onSelect={setSelectedId} />}
              {tab === 'bom' && <BomTable td={td} selectedId={selectedId} onSelect={setSelectedId} />}
              {tab === 'firmware' && <Firmware td={td} rea={status?.rea ?? null} canGenerate={canAnalyse} onFirmware={(fw) => edit({ ...td, firmware: fw })} />}
            </div>
          </div>

          )}

          {td && <Inspector td={td} selectedId={selectedId} onSelect={setSelectedId} />}
        </main>
      )}
    </div>
  );
}
