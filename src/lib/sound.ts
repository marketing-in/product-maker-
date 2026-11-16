import type { Part, Teardown } from './types';

// Sound for the simulator, made in the browser with the Web Audio API. Nothing
// is downloaded or recorded: music is a short generated loop, noise is random
// samples, a buzzer is a square wave.

export type SoundMode = 'music' | 'white' | 'rain' | 'ocean' | 'tone' | 'hum';

export const MODE_LABEL: Record<SoundMode, string> = {
  music: 'Music',
  white: 'White noise',
  rain: 'Rain',
  ocean: 'Ocean',
  tone: 'Beep',
  hum: 'Motor hum',
};

const SPEAKER = /speaker|driver|woofer|tweeter|transducer/i;
const BUZZER = /buzzer|piezo|sounder|beeper/i;
const MOTOR = /motor|fan|pump|vibrat/i;
const SOUND_MACHINE = /sound machine|white noise|noise machine|sleep (aid|sound|machine)|sound soother|sound conditioner|baby (soother|shusher)|relax/i;

export interface SoundProfile {
  /** Parts that make the sound. */
  sources: Part[];
  /** What it can play, the first being the default. */
  modes: SoundMode[];
  kind: 'sound-machine' | 'speaker' | 'buzzer' | 'motor';
}

/** What kind of sound this product makes, if any. */
export function soundProfile(td: Teardown): SoundProfile | null {
  const em = td.parts.filter((p) => p.category === 'electromech');
  const speakers = em.filter((p) => SPEAKER.test(p.name));
  const buzzers = em.filter((p) => BUZZER.test(p.name));
  const motors = em.filter((p) => MOTOR.test(p.name));
  const about = `${td.product.name} ${td.product.category} ${td.product.summary}`;
  if (speakers.length && SOUND_MACHINE.test(about)) return { sources: speakers, modes: ['white', 'rain', 'ocean', 'music'], kind: 'sound-machine' };
  if (speakers.length) return { sources: speakers, modes: ['music', 'white', 'rain', 'ocean'], kind: 'speaker' };
  if (buzzers.length) return { sources: buzzers, modes: ['tone'], kind: 'buzzer' };
  if (motors.length) return { sources: motors, modes: ['hum'], kind: 'motor' };
  return null;
}

// A gentle loop in C major pentatonic: melody and bass, one step every 240 ms.
const MELODY = [72, 0, 76, 79, 0, 76, 74, 0, 72, 0, 69, 72, 0, 74, 76, 0];
const BASS = [48, 0, 0, 0, 55, 0, 0, 0, 45, 0, 0, 0, 53, 0, 0, 0];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private voice!: GainNode;
  analyser: AnalyserNode | null = null;
  private stopCurrent: (() => void) | null = null;
  private mode: SoundMode | null = null;

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.voice = this.ctx.createGain();
    this.voice.gain.value = 0;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.smoothingTimeConstant = 0.75;
    this.voice.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private noise(colour: 'white' | 'brown'): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      if (colour === 'white') data[i] = w * 0.5;
      else { last = (last + 0.02 * w) / 1.02; data[i] = last * 3.2; }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  private note(freq: number, at: number, length: number, type: OscillatorType, peak: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.015);
    env.gain.exponentialRampToValueAtTime(0.001, at + length);
    osc.connect(env);
    env.connect(this.voice);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  /** Starts a sound, or switches to it. Call from a click, as browsers require. */
  play(mode: SoundMode, level: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.setLevel(level);
    if (this.mode === mode) return;
    this.silence();
    this.mode = mode;

    if (mode === 'music' || mode === 'tone') {
      let step = 0;
      const stepS = mode === 'music' ? 0.24 : 0.5;
      const tick = () => {
        const at = ctx.currentTime + 0.03;
        if (mode === 'tone') {
          this.note(2700, at, 0.22, 'square', 0.25);
        } else {
          const m = MELODY[step % MELODY.length];
          const b = BASS[step % BASS.length];
          if (m) this.note(hz(m), at, 0.42, 'triangle', 0.35);
          if (b) this.note(hz(b), at, 0.85, 'sine', 0.45);
        }
        step++;
      };
      tick();
      const timer = window.setInterval(tick, stepS * 1000);
      this.stopCurrent = () => window.clearInterval(timer);
      return;
    }

    const src = this.noise(mode === 'white' ? 'white' : 'brown');
    const filter = ctx.createBiquadFilter();
    const shape = ctx.createGain();
    shape.gain.value = 1;
    let lfo: OscillatorNode | null = null;
    if (mode === 'white') { filter.type = 'lowpass'; filter.frequency.value = 9000; }
    if (mode === 'rain') { filter.type = 'highpass'; filter.frequency.value = 900; shape.gain.value = 2.2; }
    if (mode === 'hum') { filter.type = 'lowpass'; filter.frequency.value = 220; shape.gain.value = 2.5; }
    if (mode === 'ocean') {
      // Waves: slow swell in loudness, one every eight seconds or so.
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      shape.gain.value = 1.4;
      lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.12;
      depth.gain.value = 1.1;
      lfo.connect(depth);
      depth.connect(shape.gain);
      lfo.start();
    }
    src.connect(filter);
    filter.connect(shape);
    shape.connect(this.voice);
    src.start();
    this.stopCurrent = () => { src.stop(); src.disconnect(); lfo?.stop(); shape.disconnect(); };
  }

  setLevel(level: number) {
    if (!this.ctx) return;
    // Loudness is heard on a curve, so square the slider.
    this.voice.gain.setTargetAtTime(level * level, this.ctx.currentTime, 0.05);
  }

  private silence() {
    this.stopCurrent?.();
    this.stopCurrent = null;
    this.mode = null;
  }

  stop() {
    if (!this.ctx) return;
    this.voice.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    const done = this.stopCurrent;
    this.stopCurrent = null;
    this.mode = null;
    window.setTimeout(() => done?.(), 200);
  }

  /** The click of a button being pressed. */
  click() {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.03);
    env.gain.setValueAtTime(0.12, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.connect(env);
    env.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  /** Two rising notes for power on, two falling for power off. */
  chime(up: boolean) {
    const ctx = this.ensure();
    if (!ctx) return;
    const notes = up ? [660, 990] : [990, 660];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const at = ctx.currentTime + 0.05 + i * 0.13;
      osc.frequency.value = f;
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.18, at + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
      osc.connect(env);
      env.connect(this.master);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  }

  /** Loudness per frequency band, 0 to 1, for the level meter. */
  bands(count: number): number[] {
    if (!this.analyser) return new Array(count).fill(0);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    const per = Math.max(1, Math.floor((data.length * 0.8) / count));
    return Array.from({ length: count }, (_, i) => {
      let sum = 0;
      for (let k = 0; k < per; k++) sum += data[i * per + k] ?? 0;
      return sum / per / 255;
    });
  }

  dispose() {
    this.stopCurrent?.();
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }
}
