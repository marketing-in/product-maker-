import { useEffect, useRef, useState } from 'react';

import { tally, type Brief, type Check, type ImportedBoard } from '../lib/validate';
import type { Teardown } from '../lib/types';
import { Checks } from './Make';
import type { TabId } from './Guide';
import Intake from './Intake';

export type Phase = 'briefing' | 'plan' | 'designing' | 'ready' | 'error';

export interface Project {
  /** Name of the file it is saved under. */
  id: string;
  /** True when the last result came from storage, not a new generation. */
  fromStore?: boolean;
  mode: 'design' | 'teardown' | 'board';
  /** Swarm build: the sub-assemblies and how far each agent has got. */
  zones?: { id: string; name: string; status: 'wait' | 'work' | 'done' | 'failed'; parts: number }[];
  /** What the swarm is doing right now. */
  note?: string;
  /** The uploaded board, when the project is a housing for one. */
  board?: ImportedBoard | null;
  prompt: string;
  images: string[];
  phase: Phase;
  brief: Brief | null;
  answers: Record<string, string>;
  /** When the current long step started, for the clock. */
  since: number;
  error: string;
  /** Follow-up turns after the first design. */
  turns: { who: 'you' | 'agent'; text: string }[];
}

interface Props {
  project: Project | null;
  td: Teardown | null;
  checks: Check[];
  busy: boolean;
  canAnalyse: boolean;
  onAnswer: (id: string, option: string) => void;
  onBuild: () => void;
  onRefine: (text: string, images: string[]) => void;
  onOpen: (tab: TabId) => void;
  onRetry: () => void;
}

function Clock({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return <span className="num">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

const DESIGN_STEPS = [
  [0, 'Choosing parts for each block'],
  [60, 'Sizing the board and the housing'],
  [150, 'Placing every part so it fits'],
  [240, 'Wiring power and signals'],
  [330, 'Describing the controls and checking the result'],
] as const;

function DesignProgress({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 2000);
    return () => window.clearInterval(t);
  }, []);
  const s = (Date.now() - since) / 1000;
  const at = DESIGN_STEPS.reduce((k, [from], i) => (s >= from ? i : k), 0);
  return (
    <ol className="progress">
      {DESIGN_STEPS.map(([, label], i) => (
        <li key={label} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>{label}</li>
      ))}
    </ol>
  );
}

export default function Agent({ project, td, checks, busy, canAnalyse, onAnswer, onBuild, onRefine, onOpen, onRetry }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const phase = project?.phase;
  const turns = project?.turns.length ?? 0;
  // Scroll the chat box to its newest message. scrollIntoView would scroll the whole page on a
  // narrow screen, where the chat sits below the model.
  useEffect(() => { const box = end.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; }, [phase, turns, td]);

  const t = tally(checks);
  const problems = checks.filter((c) => c.status === 'warn' || c.status === 'fail');
  const b = project?.brief;

  return (
    <section className="agent" aria-label="Agent">
      <div className="agent-scroll">
        {!project && td && (
          <div className="msg msg-agent">
            <p>This is the built-in sample. It shows what you get for any product: a 3D model you can edit, a simulator, the board and the files to make it.</p>
            <p>To build your own, press <strong>New project</strong> and say what you want.</p>
          </div>
        )}

        {project && (
          <div className="msg msg-you">
            <p>{project.prompt || 'See the photos.'}</p>
            {project.images.length > 0 && <p className="msg-meta">{project.images.length} photo{project.images.length === 1 ? '' : 's'} attached</p>}
          </div>
        )}

        {project?.mode === 'design' && phase === 'briefing' && (
          <div className="msg msg-agent" role="status">
            <p className="working">Working out what this needs <Clock since={project.since} /></p>
            <p className="msg-meta">Usually under a minute.</p>
          </div>
        )}

        {b && (
          <div className="msg msg-agent">
            <p>{b.understanding}</p>
            {b.questions.length > 0 && (
              <>
                <p className="msg-meta">A few choices. I picked one for each. Change any you like.</p>
                {b.questions.map((q) => (
                  <fieldset key={q.id} className="question" disabled={phase !== 'plan'}>
                    <legend>{q.question}</legend>
                    <div className="kinds">
                      {q.options.map((o) => (
                        <button key={o} type="button" className="chip" aria-pressed={(project!.answers[q.id] ?? q.assumed) === o} onClick={() => onAnswer(q.id, o)}>
                          {o}
                        </button>
                      ))}
                    </div>
                    {q.why && <p className="msg-meta">{q.why}</p>}
                  </fieldset>
                ))}
              </>
            )}
            {b.blocks.length > 0 ? (
              <>
                <p>
                  The plan has {b.requirements.length} requirements and {b.blocks.length} blocks
                  {b.costLowUsd != null && b.costHighUsd != null ? `, about $${Math.round(b.costLowUsd)} to $${Math.round(b.costHighUsd)} in parts` : ''}. It is on the right.
                </p>
                {phase === 'plan' && (
                  <button type="button" className="btn btn-primary" onClick={onBuild} disabled={!canAnalyse}>Build the design</button>
                )}
              </>
            ) : (
              <p className="msg-meta">There is nothing to build from this yet. Start a new project and describe a physical product.</p>
            )}
          </div>
        )}

        {project?.board && (
          <div className="msg msg-agent">
            <p>
              I read <strong>{project.board.name}</strong>: a {project.board.board.width} × {project.board.board.height} mm board,{' '}
              {project.board.layers || 2} copper layers, {project.board.components.length} parts
              {project.board.mounting.length ? `, ${project.board.mounting.length} mounting holes` : ', no mounting holes'}
              {project.board.nets ? `, ${project.board.nets} nets` : ''}.
            </p>
            {project.board.notes.map((n) => <p key={n} className="msg-meta">{n}</p>)}
            {td?.meta.source === 'board' && (
              <p>
                I generated <strong>{td.parts.filter((x) => x.parentId).reduce((s, x) => s + x.qty, 0)} parts</strong> on it from the pad patterns: chips, passives, connectors and switches, each with a body
                and height typical for its package. They are in the 3D view now; this step is free.
              </p>
            )}
            <p>Next, if you want, I work out what the board does and design a two-piece housing round it: walls, clearance, screw bosses and an opening for each connector and switch.</p>
            {phase === 'plan' && (
              <button type="button" className="btn btn-primary" onClick={onBuild} disabled={!canAnalyse}>Understand it and design the housing</button>
            )}
          </div>
        )}

        {phase === 'designing' && project && (
          <div className="msg msg-agent" role="status">
            <p className="working">{project.mode === 'design' ? 'Designing it' : project.mode === 'board' ? 'Reading the board and designing the housing' : 'Taking it apart'} <Clock since={project.since} /></p>
            {project.zones?.length ? (
              <>
                <ol className="progress">
                  {project.zones.map((z) => (
                    <li key={z.id} className={z.status === 'done' ? 'is-done' : z.status === 'work' ? 'is-now' : ''}>
                      {z.name}
                      <span className="msg-meta"> {z.status === 'done' ? `· ${z.parts} parts` : z.status === 'work' ? '· an agent is on it' : z.status === 'failed' ? '· failed' : ''}</span>
                    </li>
                  ))}
                </ol>
                <p className="msg-meta">{project.zones.length} agents are working at the same time. Each piece appears on the right when its agent finishes.</p>
              </>
            ) : project.mode === 'design' && !project.board ? (
              <p className="msg-meta">{project.note ?? 'Starting the team of agents'}</p>
            ) : (
              <DesignProgress since={project.since} />
            )}
            {project.zones?.length ? <p className="msg-meta">{project.note}</p> : null}
            <p className="msg-meta">
              {project.mode === 'design' && !project.board ? 'A team build takes a few minutes.' : 'A full design takes several minutes, up to ten for a product with many parts.'} The
              result is saved the moment it arrives, so nothing is lost if this tab closes.
            </p>
          </div>
        )}

        {phase === 'error' && project && (
          <div className="msg msg-agent msg-error" role="alert">
            <p>{project.error}</p>
            <button type="button" className="btn" onClick={onRetry}>Try again</button>
          </div>
        )}

        {td && (!project || phase === 'ready') && (
          <div className="msg msg-agent">
            <p>
              <strong>{project ? 'The design is ready.' : td.product.name}</strong>{' '}
              {td.parts.length} part lines, {td.connections.length} connections
              {td.parts.some((p) => p.estCostUsd != null) ? `, about $${td.parts.reduce((s, p) => s + (p.estCostUsd ?? 0) * p.qty, 0).toFixed(2)} in materials` : ''}.
            </p>
            <p>
              <strong>Checked:</strong> {t.pass} of {t.scored} pass{problems.length ? `, ${problems.length} to look at.` : '.'}
            </p>
            {project?.fromStore && <p className="msg-meta">Loaded from storage. No tokens were used.</p>}
            <Checks checks={problems} onOpen={onOpen} compact />
            <div className="kinds">
              <button type="button" className="chip" onClick={() => onOpen('run')}>Operate it</button>
              <button type="button" className="chip" onClick={() => onOpen('design')}>Edit the design</button>
              <button type="button" className="chip" onClick={() => onOpen('make')}>Cost and files</button>
            </div>
          </div>
        )}

        {project?.turns.map((m, i) => (
          <div key={i} className={`msg ${m.who === 'you' ? 'msg-you' : 'msg-agent'}`}><p>{m.text}</p></div>
        ))}
        {busy && phase === 'ready' && project && (
          <div className="msg msg-agent" role="status">
            <p className="working">Updating the design <Clock since={project.since} /></p>
          </div>
        )}
        <div ref={end} />
      </div>

      {td && (
        <div className="agent-input">
          {canAnalyse ? (
            <Intake
              variant="refine"
              busy={busy}
              canAnalyse
              onSubmit={onRefine}
              labels={{ field: 'Ask for a change', placeholder: 'For example: add a second battery. Make it 20 mm shorter. Use a cheaper motor driver.', submit: 'Send', busy: 'Working…' }}
            />
          ) : (
            <p className="hint">Changes by chat need a Claude API key in <code>.env</code>. Editing in the Design tab works without one.</p>
          )}
        </div>
      )}
    </section>
  );
}
