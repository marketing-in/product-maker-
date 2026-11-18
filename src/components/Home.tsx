import {
  ArrowRight, BookOpen, Box, Camera, CircuitBoard, Compass, Cpu, FileArchive, FileText, Gamepad2, Hammer, Lightbulb, Move3d,
  Network, Package, SlidersHorizontal, Table2, Zap,
} from 'lucide-react';

import KineticGrid from '@/components/ui/kinetic-grid';
import { SAMPLE } from '@/lib/sample';
import type { ConnectionKind } from '@/lib/types';
import Viewer3D from './Viewer3D';

// The home page: what Teardown Lab is, shown with the real model, over the kinetic grid.

type Mode = 'design' | 'teardown' | 'board';

interface Props {
  onStart: (mode?: Mode) => void;
  onTour: () => void;
  onSample: () => void;
  savedCount: number;
}

const KINDS: Record<ConnectionKind, boolean> = { power: true, ground: true, signal: true, rf: true, mechanical: false };

const WAYS: { mode: Mode; icon: typeof Lightbulb; title: string; body: string; action: string }[] = [
  { mode: 'design', icon: Lightbulb, title: 'Design something new', body: 'One sentence becomes a plan, a 3D design with its board and housing, firmware and a parts list.', action: 'Describe an idea' },
  { mode: 'teardown', icon: Camera, title: 'Take apart a product you have', body: 'Photos or a description become a part-by-part teardown, with the wiring and the power on every path.', action: 'Add photos' },
  { mode: 'board', icon: CircuitBoard, title: 'Make a housing for your board', body: 'A Gerber set or a KiCad file: every part is recognised from its pads, then a moulded case is designed round it.', action: 'Upload a board' },
];

const VIEWS: { icon: typeof Box; name: string; body: string }[] = [
  { icon: Box, name: 'Model', body: 'Exploded 3D with real materials and wires coloured by kind.' },
  { icon: Move3d, name: 'Design', body: 'Drag parts, type sizes, resize the housing and its wall.' },
  { icon: Gamepad2, name: 'Operate', body: 'Press the product’s buttons; motors turn, the camera sees.' },
  { icon: Network, name: 'Blocks', body: 'Every board, its chips, rails and buses.' },
  { icon: CircuitBoard, name: 'Board', body: 'Routed copper, 3D layers, a board-house preview.' },
  { icon: Package, name: 'Fit', body: 'What fits, what touches the wall, how the mould opens.' },
  { icon: Zap, name: 'Power', body: 'From the input to every load, in volts, amps and watts.' },
  { icon: SlidersHorizontal, name: 'Params', body: 'Battery life, heat and load as you move the sliders.' },
  { icon: Table2, name: 'BOM', body: 'Every part, its package and a likely part number.' },
  { icon: Cpu, name: 'Firmware', body: 'A PlatformIO project for the controller on the board.' },
];

const FILES: { ext: string; what: string }[] = [
  { ext: '.pdf', what: 'Product report: render, block diagram, power flow, boards, fit, BOM, checks' },
  { ext: '.step', what: 'CAD model, assembled and exploded, for FreeCAD, Fusion, SolidWorks' },
  { ext: '.kicad_pcb', what: 'KiCad board for every PCB, plus Gerber and drill files' },
  { ext: '.py', what: 'Blender scene for a realistic product render' },
  { ext: 'platformio.ini', what: 'Firmware project: pin map, code, build and test steps' },
  { ext: '.csv', what: 'Bill of materials' },
  { ext: '.zip', what: 'Everything above in one download' },
];

const STEPS: { name: string; body: string; cost: string }[] = [
  { name: 'Brainstorm', body: 'The agent says back what it understood, asks three to five questions with ready answers, and writes the plan.', cost: '≈ 16 s · ≈ $0.09' },
  { name: 'Design', body: 'A team of agents builds the housing, boards, parts and wiring at once, then the design is checked.', cost: 'a few minutes' },
  { name: 'Make', body: 'Report, CAD, boards, firmware and the parts list. Made in your browser from the design.', cost: 'files: free' },
];

const primary = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-[#161618] transition-[transform,background-color] duration-150 ease-out hover:bg-[#e8f1ff] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a9eff]';
const secondary = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-5 text-sm font-medium text-white transition-[transform,background-color,border-color] duration-150 ease-out hover:border-white/40 hover:bg-white/5 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a9eff]';

export default function Home({ onStart, onTour, onSample, savedCount }: Props) {
  return (
    <KineticGrid className="tw text-white">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" /><path d="m3 12 9 4.5 9-4.5" /><path d="m3 16.5 9 4.5 9-4.5" />
          </svg>
          Teardown Lab
        </span>
        <nav className="flex items-center gap-2" aria-label="Home">
          <button type="button" onClick={onTour} className="hidden h-9 items-center gap-2 rounded-lg px-3 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white sm:inline-flex">
            <Compass size={16} aria-hidden="true" />Tour
          </button>
          <button type="button" onClick={() => onStart()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/20 px-3.5 text-sm font-medium transition-colors hover:border-white/40 hover:bg-white/5">
            {savedCount ? `Your projects · ${savedCount}` : 'Open the app'}
          </button>
        </nav>
      </header>

      <main>
        {/* The first viewport: what it is, the two ways to begin, and the real model turning beneath. */}
        <section className="mx-auto flex max-w-6xl flex-col items-center px-5 pt-14 text-center sm:px-8 sm:pt-20">
          <h1 className="max-w-3xl text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.035em] text-balance sm:text-6xl lg:text-[4.25rem]">
            Take any product apart. Design the next one.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
            Describe an idea, photograph a product or upload a circuit board. An agent builds the 3D model, the boards, the housing
            and the firmware, then hands you the files to make it.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => onStart()} className={primary}>Start a project<ArrowRight size={16} aria-hidden="true" /></button>
            <button type="button" onClick={onTour} className={secondary}><Compass size={16} aria-hidden="true" />Take the tour</button>
          </div>

          <figure className="mt-14 w-full sm:mt-16">
            <div className="relative h-[22rem] overflow-hidden rounded-2xl border border-white/10 bg-[#0f1013] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.85)] sm:h-[30rem]">
              <Viewer3D td={SAMPLE} explode={0.8} selectedId={null} onSelect={() => onSample()} kinds={KINDS} showValues={false} xray resetSignal={0} autoRotate />
            </div>
            <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-left text-sm text-white/50">
              <span>The built-in sample, live: a Bluetooth speaker in {SAMPLE.parts.length} part lines, power traced from the USB-C port to each driver. Drag to turn it.</span>
              <button type="button" onClick={onSample} className="inline-flex items-center gap-1.5 font-medium text-white/80 underline decoration-white/30 underline-offset-4 hover:text-white hover:decoration-white">
                Open it in the app<ArrowRight size={14} aria-hidden="true" />
              </button>
            </figcaption>
          </figure>
        </section>

        {/* Three ways in. */}
        <section className="mx-auto mt-28 grid max-w-6xl gap-10 px-5 sm:px-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16" aria-labelledby="ways">
          <div>
            <h2 id="ways" className="text-3xl font-semibold tracking-[-0.025em] text-balance">Start from an idea, a product or a board.</h2>
            <p className="mt-3 text-white/55">The same agent, three starting points. Every result is stored on your computer, so opening it again costs nothing.</p>
          </div>
          <ul className="divide-y divide-white/10 border-y border-white/10 bg-[#161618]/80">
            {WAYS.map((w) => (
              <li key={w.mode}>
                <button type="button" onClick={() => onStart(w.mode)} className="group grid w-full grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-4 px-1 py-6 text-left transition-colors hover:bg-white/[0.03] sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:px-3">
                  <span className="grid size-10 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/80"><w.icon size={18} aria-hidden="true" /></span>
                  <span>
                    <span className="block text-lg font-medium">{w.title}</span>
                    <span className="mt-1 block max-w-prose text-[15px] leading-relaxed text-white/55">{w.body}</span>
                  </span>
                  <span className="col-start-2 inline-flex items-center gap-1.5 self-center text-sm font-medium text-[#8cc0ff] sm:col-start-auto">
                    {w.action}<ArrowRight size={15} className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* One model, every view. */}
        <section className="mx-auto mt-28 max-w-6xl px-5 sm:px-8" aria-labelledby="views">
          <h2 id="views" className="max-w-2xl text-3xl font-semibold tracking-[-0.025em] text-balance">One model. Every way an engineer looks at a product.</h2>
          <p className="mt-3 max-w-xl text-white/55">Select a part in one view and it is selected in all of them; change it and every view, check and export follows.</p>
          <dl className="mt-10 grid grid-cols-1 border-t border-l border-white/10 bg-[#161618]/80 sm:grid-cols-2 lg:grid-cols-5">
            {VIEWS.map((v) => (
              <div key={v.name} className="border-r border-b border-white/10 p-5">
                <dt className="flex items-center gap-2 font-medium"><v.icon size={16} className="text-white/60" aria-hidden="true" />{v.name}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-white/55">{v.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works and what it costs. */}
        <section className="mx-auto mt-28 max-w-6xl px-5 sm:px-8" aria-labelledby="how">
          <h2 id="how" className="text-3xl font-semibold tracking-[-0.025em]">From a sentence to the files, in three stages.</h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.name} className="flex flex-col bg-[#161618] p-6">
                <span className="font-mono text-sm text-white/40">{i + 1}</span>
                <span className="mt-3 text-xl font-semibold">{s.name}</span>
                <span className="mt-2 flex-1 text-[15px] leading-relaxed text-white/55">{s.body}</span>
                <span className="mt-5 font-mono text-sm text-[#8cc0ff]">{s.cost}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-white/40">Measured on this project in November 2026. Each answer from Claude is stored, so asking again costs nothing.</p>
        </section>

        {/* What you take away. */}
        <section className="mx-auto mt-28 grid max-w-6xl gap-10 px-5 sm:px-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16" aria-labelledby="files">
          <div>
            <h2 id="files" className="text-3xl font-semibold tracking-[-0.025em] text-balance">Files a board house, a toolmaker and a printer can use.</h2>
            <p className="mt-3 text-white/55">Downloads are made in your browser from the design, in a few seconds and with no tokens.</p>
          </div>
          <ul className="divide-y divide-white/10 border-y border-white/10 bg-[#161618]/80">
            {FILES.map((f) => (
              <li key={f.ext} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-4 px-1 py-3.5 sm:px-3">
                <span className="flex items-center gap-2 font-mono text-sm text-white/85">
                  {f.ext === '.zip' ? <FileArchive size={15} className="text-white/45" aria-hidden="true" /> : <FileText size={15} className="text-white/45" aria-hidden="true" />}{f.ext}
                </span>
                <span className="text-[15px] text-white/55">{f.what}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* The close. */}
        <section className="mx-auto mt-32 max-w-6xl px-5 pb-24 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-8 rounded-2xl border border-white/10 bg-[#1b1c20] p-8 sm:p-12 md:flex-row md:items-center">
            <div>
              <h2 className="max-w-lg text-3xl font-semibold tracking-[-0.025em] text-balance">Open the bench and start with what you have.</h2>
              <p className="mt-3 max-w-md text-white/55">New here? The tour walks through every view on the sample, in about two minutes.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => onStart()} className={primary}><Hammer size={16} aria-hidden="true" />Start a project</button>
              <button type="button" onClick={onTour} className={secondary}><BookOpen size={16} aria-hidden="true" />Take the tour</button>
            </div>
          </div>
          <p className="mt-10 text-sm text-white/35">Teardown Lab · built on Claude, three.js, KiCad and Kitspace formats, rea and Blender. Sizes and part numbers are engineering estimates until measured.</p>
        </section>
      </main>
    </KineticGrid>
  );
}
