import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Power, RotateCcw, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { abilities, rest, type Motion } from '../lib/abilities';
import { controls as findControls, live, outputs, press, START, type Control, type SimState } from '../lib/behaviour';
import { fmtW } from '../lib/power';
import { MODE_LABEL, SoundEngine, soundProfile, type SoundMode } from '../lib/sound';
import type { ConnectionKind, Teardown } from '../lib/types';
import Viewer3D from './Viewer3D';

interface Props {
  td: Teardown;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The right panel's slot: the controls render there, so the stage keeps the full width. */
  toolSlot?: HTMLElement | null;
}

/** What the product's camera sees: your webcam if you allow it, otherwise a moving test card. */
function CameraView({ on, name }: { on: boolean; name: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const card = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [note, setNote] = useState('');
  const [shots, setShots] = useState<string[]>([]);

  useEffect(() => { if (video.current) video.current.srcObject = stream; }, [stream]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  // The product is off: let go of the webcam.
  useEffect(() => { if (!on && stream) setStream(null); }, [on, stream]);

  // Test card: colour bars, a sweeping line and a running clock, so it is plainly a live picture.
  useEffect(() => {
    const c = card.current;
    if (!c || stream || !on) return;
    const g = c.getContext('2d')!;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const draw = (t: number) => {
      const bars = ['#c9c9c9', '#c9c62a', '#27c7c6', '#28c52c', '#c628c5', '#c62a2a', '#2a2cc6'];
      bars.forEach((b, i) => { g.fillStyle = b; g.fillRect((i * c.width) / 7, 0, c.width / 7 + 1, c.height * 0.72); });
      g.fillStyle = '#16181b';
      g.fillRect(0, c.height * 0.72, c.width, c.height * 0.28);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(((t / 12) % (c.width + 40)) - 20, 0, 3, c.height * 0.72);
      g.fillStyle = '#f2f1ec';
      g.font = '600 15px "Geist Mono", monospace';
      g.fillText('TEST PATTERN', 12, c.height * 0.72 + 24);
      g.font = '13px "Geist Mono", monospace';
      g.fillText(new Date().toLocaleTimeString(), 12, c.height * 0.72 + 44);
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [stream, on]);

  const useWebcam = async () => {
    setNote('');
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }));
    } catch {
      setNote('The webcam was not allowed or is not there. The test pattern stays on.');
    }
  };
  const snap = () => {
    const src = stream ? video.current : card.current;
    if (!src) return;
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    setShots((s) => [c.toDataURL('image/jpeg', 0.8), ...s].slice(0, 4));
  };

  return (
    <section className="now-playing is-live" aria-label="Camera">
      <div className="now-head">
        <h3>Camera</h3>
        <span className="num">{!on ? 'off' : stream ? 'live · your webcam' : 'live · test pattern'}</span>
      </div>
      <div className="camview">
        {!on ? <p>Switch the product on to see through {name}.</p>
          : stream ? <video ref={video} autoPlay playsInline muted />
            : <canvas ref={card} width={320} height={240} />}
      </div>
      <div className="kinds">
        <button type="button" className="btn" onClick={snap} disabled={!on}><Camera size={15} />Take a photo</button>
        {stream
          ? <button type="button" className="btn" onClick={() => setStream(null)}><VideoOff size={15} />Stop webcam</button>
          : <button type="button" className="btn" onClick={() => void useWebcam()} disabled={!on}><Video size={15} />Use my webcam</button>}
      </div>
      {shots.length > 0 && <div className="shots">{shots.map((s, i) => <img key={s.slice(-24) + i} src={s} alt={`Photo ${i + 1}`} />)}</div>}
      <p className="fineprint">{note || 'The webcam picture stays in this browser. It is not sent anywhere or saved.'}</p>
    </section>
  );
}

const WIRES: Record<ConnectionKind, boolean> = { power: true, ground: false, signal: true, rf: true, mechanical: false };

export default function Simulator({ td, selectedId, onSelect, toolSlot }: Props) {
  const place = (node: ReactNode) => (toolSlot ? createPortal(node, toolSlot) : node);
  const ctrls = useMemo(() => findControls(td), [td]);
  const outs = useMemo(() => outputs(td), [td]);
  const [state, setState] = useState<SimState>(START);
  const [pulse, setPulse] = useState<{ parts: string[]; wires: string[]; control?: string }>({ parts: [], wires: [] });
  const [log, setLog] = useState<string[]>([]);
  const timer = useRef(0);

  // What the product can do: drive, spin, see.
  const able = useMemo(() => abilities(td), [td]);
  const motion = useRef<Motion>(rest(able.drive?.floorZ ?? NaN));
  const keys = useRef({ f: 0, b: 0, l: 0, r: 0 });
  const [trip, setTrip] = useState({ metres: 0, speed: 0 });
  const stateRef = useRef(START);
  const canMove = Boolean(able.drive) || able.spinners.length > 0;
  useEffect(() => { motion.current = rest(able.drive?.floorZ ?? NaN); setTrip({ metres: 0, speed: 0 }); }, [able]);

  // Drive loop: turns held keys into speed, speed into position and wheel rotation.
  useEffect(() => {
    if (!canMove) return;
    let raf = 0;
    let last = performance.now();
    let metres = 0;
    let shown = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const m = motion.current;
      const d = able.drive;
      let v = 0;
      if (d && s.on) {
        const k = keys.current;
        v = (k.f - k.b) * 320 * Math.max(0.25, s.level);
        const w = (k.l - k.r) * 2.4 * Math.max(0.25, s.level);
        m.heading += w * dt;
        // Forward is one horizontal axis of the product, turned by the heading.
        const [fx, fy] = d.forward === 1 ? [0, 1] : [1, 0];
        m.x += (fx * Math.cos(m.heading) - fy * Math.sin(m.heading)) * v * dt;
        m.y += (fx * Math.sin(m.heading) + fy * Math.cos(m.heading)) * v * dt;
        const turnSign = d.forward === 1 ? 1 : -1;
        for (const wheel of d.wheels) {
          const rim = v + turnSign * wheel.side * w * (d.track / 2);
          const prev = m.spin[wheel.part.id]?.angle ?? 0;
          // Top of the wheel moves the way the product is going.
          m.spin[wheel.part.id] = { axis: wheel.axis, angle: prev + (wheel.axis === 0 ? -1 : 1) * (rim / wheel.radius) * dt };
        }
        metres += Math.abs(v) * dt / 1000;
      }
      for (const sp of able.spinners) {
        const prev = m.spin[sp.part.id]?.angle ?? 0;
        m.spin[sp.part.id] = { axis: sp.axis, angle: s.on && s.level > 0 ? prev + 18 * s.level * dt : prev };
      }
      if (now - shown > 200) { shown = now; setTrip((t) => (t.metres === metres && t.speed === v ? t : { metres, speed: v })); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [able, canMove]);

  // Arrow keys and W A S D drive it, unless you are typing.
  useEffect(() => {
    if (!able.drive) return;
    const map: Record<string, 'f' | 'b' | 'l' | 'r'> = { ArrowUp: 'f', w: 'f', ArrowDown: 'b', s: 'b', ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r' };
    const on = (ev: KeyboardEvent, value: number) => {
      const key = map[ev.key.length === 1 ? ev.key.toLowerCase() : ev.key];
      const el = ev.target as HTMLElement | null;
      if (!key || ev.metaKey || ev.ctrlKey || el?.closest('input, textarea, select, [contenteditable]')) return;
      if (ev.key.startsWith('Arrow')) ev.preventDefault();
      keys.current[key] = value;
    };
    const down = (ev: KeyboardEvent) => on(ev, 1);
    const up = (ev: KeyboardEvent) => on(ev, 0);
    const clear = () => { keys.current = { f: 0, b: 0, l: 0, r: 0 }; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); clear(); };
  }, [able]);

  // Sound: what this product can play, and the engine that plays it.
  const profile = useMemo(() => soundProfile(td), [td]);
  const [mode, setMode] = useState<SoundMode | null>(profile?.modes[0] ?? null);
  const [muted, setMuted] = useState(false);
  const engine = useRef<SoundEngine | null>(null);
  const meter = useRef<HTMLDivElement>(null);
  const sound = () => (engine.current ??= new SoundEngine());
  useEffect(() => setMode(profile?.modes[0] ?? null), [profile]);
  useEffect(() => () => { engine.current?.dispose(); engine.current = null; }, []);

  useEffect(() => { setState(START); setLog([]); setPulse({ parts: [], wires: [] }); }, [td.product.name]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const now = useMemo(() => live(td, state, pulse.parts, pulse.wires), [td, state, pulse]);
  stateRef.current = state;

  // The product is audible when it is on, the level is up and a sound-making part is running.
  const audible = Boolean(profile && mode && state.on && state.level > 0 && profile.sources.some((p) => now.active.has(p.id)));
  useEffect(() => {
    if (!engine.current && !audible) return;
    if (audible && !muted && mode) sound().play(mode, state.level);
    else engine.current?.stop();
  }, [audible, muted, mode, state.level]);

  // Level meter: bars follow the sound that is actually playing.
  useEffect(() => {
    const host = meter.current;
    if (!host) return;
    const bars = [...host.children] as HTMLElement[];
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!audible || muted || still) {
      bars.forEach((b) => { b.style.height = audible && !muted ? `${30 + state.level * 50}%` : '6%'; });
      return;
    }
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = engine.current?.bands(bars.length) ?? [];
      bars.forEach((b, i) => { b.style.height = `${Math.max(6, Math.min(100, (v[i] ?? 0) * 92))}%`; });
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [audible, muted, state.level]);

  const fire = useCallback((c: Control) => {
    const r = press(td, state, c);
    if (!muted) {
      if (c.effect === 'power') sound().chime(r.state.on);
      else sound().click();
    }
    setState(r.state);
    setPulse({ parts: r.pulse, wires: r.pulseWires, control: c.id });
    setLog((l) => [r.log, ...l].slice(0, 8));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPulse({ parts: [], wires: [] }), 900);
  }, [td, state, muted]);

  // Clicking a control on the model presses it.
  const onPick = (id: string, index: number) => {
    const c = ctrls.find((x) => x.partId === id && x.index === index) ?? ctrls.find((x) => x.partId === id);
    if (c) fire(c);
  };

  const hasPower = ctrls.some((c) => c.effect === 'power');

  return (
    <div className="design">
      <div className="design-stage">
        <Viewer3D
          td={td}
          explode={0}
          selectedId={selectedId}
          onSelect={onSelect}
          onPick={onPick}
          kinds={WIRES}
          showValues={false}
          xray
          resetSignal={0}
          keepView
          activeIds={now.active}
          liveWires={now.wires}
          motion={canMove ? motion : undefined}
        />
        <div className="design-bar">
          <span className={`tag ${state.on ? 'tag-inside' : ''}`}>{state.on ? 'Running' : 'Off'}</span>
          <span className="num">{state.on ? `${fmtW(now.drawW)} drawn` : '0 W'}</span>
          <span className="num">Level {Math.round(state.level * 100)}%</span>
          <span className="design-bar-end">
            <button type="button" className="btn" aria-pressed={!muted} onClick={() => setMuted((m) => !m)}>
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{muted ? 'Sound off' : 'Sound on'}
            </button>
            {!hasPower && (
              <button type="button" className="btn" aria-pressed={state.on} onClick={() => setState((s) => ({ ...s, on: !s.on }))}>
                <Power size={15} />{state.on ? 'Switch off' : 'Switch on'}
              </button>
            )}
            <button type="button" className="btn" onClick={() => { setState(START); setLog([]); motion.current = rest(able.drive?.floorZ ?? NaN); }}><RotateCcw size={15} />Reset</button>
          </span>
        </div>
      </div>

      {place(<div className="design-panel sim-panel">
        <div>
          <h2>Operate it</h2>
          <p className="hint">
            Press a control here, or click the button on the model. The press travels along the wiring, and the parts
            that respond light up{profile ? ' and sound' : ''}.
          </p>
        </div>

        {able.drive && (
          <section className={`now-playing${state.on ? ' is-live' : ''}`} aria-label="Drive">
            <div className="now-head">
              <h3>Drive it</h3>
              <span className="num">{!state.on ? 'off' : `${(Math.abs(trip.speed) / 1000).toFixed(2)} m/s · ${trip.metres.toFixed(2)} m`}</span>
            </div>
            <div className="dpad" role="group" aria-label="Drive">
              {([['f', 'Forward', ArrowUp], ['l', 'Left', ArrowLeft], ['b', 'Back', ArrowDown], ['r', 'Right', ArrowRight]] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  className={`btn dpad-${k}`}
                  aria-label={label}
                  disabled={!state.on}
                  onPointerDown={(ev) => { ev.currentTarget.setPointerCapture(ev.pointerId); keys.current[k] = 1; }}
                  onPointerUp={() => { keys.current[k] = 0; }}
                  onPointerCancel={() => { keys.current[k] = 0; }}
                  onKeyDown={(ev) => { if (ev.key === ' ' || ev.key === 'Enter') keys.current[k] = 1; }}
                  onKeyUp={() => { keys.current[k] = 0; }}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
            <p className="hint">
              {state.on
                ? 'Hold a button, or use the arrow keys or W A S D. The level sets the speed.'
                : 'Switch it on, then hold a button or use the arrow keys.'}
            </p>
            <p className="fineprint">{able.drive.wheels.length} driven wheel parts, {Math.round(able.drive.radius * 2)} mm, {Math.round(able.drive.track)} mm apart. Top speed here is 0.32 m/s.</p>
          </section>
        )}

        {able.cameras.length > 0 && <CameraView on={state.on} name={able.cameras[0].refDes ?? able.cameras[0].name} />}

        {profile && mode && (
          <section className={`now-playing${audible && !muted ? ' is-live' : ''}`} aria-label="Sound">
            <div className="now-head">
              <h3>{profile.kind === 'sound-machine' ? 'Sound machine' : profile.kind === 'buzzer' ? 'Buzzer' : profile.kind === 'motor' ? 'Motor' : 'Speaker'}</h3>
              <span className="num">{!state.on ? 'off' : muted ? 'muted' : state.level === 0 ? 'volume 0' : `playing · ${MODE_LABEL[mode].toLowerCase()}`}</span>
            </div>
            <div className="meter" ref={meter} aria-hidden="true">
              {Array.from({ length: 16 }, (_, i) => <span key={i} />)}
            </div>
            <div className="volume" role="img" aria-label={`Volume ${Math.round(state.level * 100)} percent`}>
              {Array.from({ length: 10 }, (_, i) => <span key={i} className={state.on && i < Math.round(state.level * 10) ? 'is-on' : ''} />)}
            </div>
            {profile.modes.length > 1 && (
              <div className="kinds" role="group" aria-label="Sound to play">
                {profile.modes.map((m) => (
                  <button key={m} type="button" className="chip" aria-pressed={m === mode} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
                ))}
              </div>
            )}
            <div className="stepper">
              <button type="button" className="btn" onClick={() => setState((x) => ({ ...x, level: Math.max(0, Math.round((x.level - 0.1) * 10) / 10) }))} aria-label="Volume down">−</button>
              <button type="button" className="btn" onClick={() => setState((x) => ({ ...x, level: Math.min(1, Math.round((x.level + 0.1) * 10) / 10) }))} aria-label="Volume up">+</button>
            </div>
            <p className="hint">{state.on ? 'Or use the product’s own buttons below.' : 'Switch it on to hear it.'}</p>
          </section>
        )}

        <section>
          <h3>Controls</h3>
          {ctrls.length === 0 ? (
            <p className="hint">This teardown has no switch or button. Use “Switch on” above to power it.</p>
          ) : (
            <ul className="ctl-list">
              {ctrls.map((c) => (
                <li key={c.id}>
                  <button type="button" className={`btn ctl${pulse.control === c.id ? ' is-pressed' : ''}`} onClick={() => fire(c)}>
                    {c.effect === 'power' && <Power size={14} />}
                    {c.label}
                  </button>
                  <span className="hint">{c.action}</span>
                </li>
              ))}
            </ul>
          )}
          {ctrls.some((c) => c.derived) && (
            <p className="fineprint">These actions were worked out from the wiring. Describe what each button does under “Correct or extend” to make them exact.</p>
          )}
        </section>

        <section>
          <h3>Outputs</h3>
          <ul className="out-list">
            {outs.map((p) => {
              const on = now.active.has(p.id) && (state.on || pulse.parts.includes(p.id));
              return (
                <li key={p.id}>
                  <span className={`lamp${on ? ' is-on' : ''}`} aria-hidden="true" />
                  <button type="button" className="link" onClick={() => onSelect(p.id)}>{p.refDes && <span className="ref">{p.refDes}</span>}{p.name}</button>
                  <span className="num">{on ? 'on' : 'off'}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-live="polite">
          <h3>What happened</h3>
          {log.length === 0 ? <p className="hint">Nothing yet. Press a control.</p> : (
            <ol className="sim-log">{log.map((l, i) => <li key={log.length - i}>{l}</li>)}</ol>
          )}
        </section>
      </div>)}
    </div>
  );
}
