import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// A guided tour over the real app: one region at a time is framed by a spotlight, with a short card
// beside it. Each step may first change the app (open a view, open a panel, select a part).

export interface TourStep {
  /** CSS selector of the region to frame. Missing targets fall back to a centred card. */
  target: string;
  title: string;
  body: string;
  /** Runs before the step is shown: switch the view, open a panel, pick a part. */
  before?: () => void;
}

interface Props {
  steps: TourStep[];
  onClose: () => void;
}

interface Box { x: number; y: number; w: number; h: number }

const PAD = 8;
const CARD_W = 340;

export default function Tour({ steps, onClose }: Props) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[i];
  // The parent may rebuild the list on every render; a step's setup runs once, when the step opens.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Find the target once the step's preparation has rendered, and follow it on resize and scroll.
  useEffect(() => {
    const current = stepsRef.current[i];
    current.before?.();
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(current.target);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        setBox({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
      } else if (tries++ < 90) {
        raf = requestAnimationFrame(measure);
        return;
      } else setBox(null);
    };
    // Give React and lazy views a moment to put the target on screen.
    const t = window.setTimeout(() => { raf = requestAnimationFrame(measure); }, 120);
    const follow = () => measure();
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [i]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    cardRef.current?.focus({ preventScroll: true });
  }, [i, box]);

  const next = useCallback(() => (i < steps.length - 1 ? setI(i + 1) : onClose()), [i, steps.length, onClose]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && document.activeElement === cardRef.current)) next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [next, back, onClose]);

  // Place the card beside the frame where there is room: right, left, below, above, else centred.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(CARD_W, vw - 24);
  let left = (vw - cardW) / 2;
  let top = (vh - cardH) / 2;
  if (box) {
    const clampY = (y: number) => Math.max(12, Math.min(vh - cardH - 12, y));
    const clampX = (x: number) => Math.max(12, Math.min(vw - cardW - 12, x));
    if (box.x + box.w + 16 + cardW < vw) { left = box.x + box.w + 16; top = clampY(box.y); }
    else if (box.x - 16 - cardW > 0) { left = box.x - 16 - cardW; top = clampY(box.y); }
    else if (box.y + box.h + 16 + cardH < vh) { top = box.y + box.h + 16; left = clampX(box.x); }
    else if (box.y - 16 - cardH > 0) { top = box.y - 16 - cardH; left = clampX(box.x); }
    else { top = vh - cardH - 16; left = clampX(box.x + box.w / 2 - cardW / 2); }
  }

  return (
    <div className="tw fixed inset-0 z-[100] pointer-events-none" aria-live="polite">
      {/* The spotlight: a frame round the region, the rest of the screen dimmed by its shadow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-xl border border-white/70 transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
        style={box
          ? { left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: '0 0 0 9999px rgba(6, 8, 12, 0.62)' }
          : { left: vw / 2, top: vh / 2, width: 0, height: 0, boxShadow: '0 0 0 9999px rgba(6, 8, 12, 0.62)', borderWidth: 0 }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="pointer-events-auto fixed rounded-xl border border-white/15 bg-[#1d2027] p-5 text-[#eceae4] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] outline-none transition-[left,top] duration-300 ease-out motion-reduce:transition-none"
        style={{ left, top, width: cardW }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-xs text-white/45">{i + 1} of {steps.length}</p>
          <button type="button" onClick={onClose} aria-label="End the tour" className="-m-1.5 grid size-7 place-items-center rounded-md text-white/55 hover:bg-white/10 hover:text-white">
            <X size={15} />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1.5 text-[17px] font-semibold tracking-tight">{step.title}</h2>
        <p id="tour-body" className="mt-2 text-sm leading-relaxed text-white/70">{step.body}</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full rounded-full bg-white/70 transition-[width] duration-300 ease-out" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="text-sm text-white/50 hover:text-white">Skip the tour</button>
          <div className="flex gap-2">
            <button type="button" onClick={back} disabled={i === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-2.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-35">
              <ArrowLeft size={14} aria-hidden="true" />Back
            </button>
            <button type="button" onClick={next} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-semibold text-[#161618] transition-colors hover:bg-[#e8f1ff]">
              {i < steps.length - 1 ? <>Next<ArrowRight size={14} aria-hidden="true" /></> : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
