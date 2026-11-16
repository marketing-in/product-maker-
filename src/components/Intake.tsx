import { ImagePlus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_IMAGES = 6;
const MAX_EDGE = 1600;

/** Downscale a photo in the browser so uploads stay small. */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.88);
}

interface Props {
  variant: 'start' | 'refine';
  busy: boolean;
  canAnalyse: boolean;
  onSubmit: (text: string, images: string[]) => void;
  /** Wording for a different use of the same form. */
  labels?: { field?: string; placeholder?: string; submit?: string; busy?: string; hint?: string | null };
}

export default function Intake({ variant, busy, canAnalyse, onSubmit, labels }: Props) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const start = variant === 'start';

  const addFiles = useCallback(async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith('image/'));
    if (pics.length === 0) {
      if (files.length) setNote('Only image files can be added here.');
      return;
    }
    setNote('');
    try {
      const urls = await Promise.all(pics.map(toDataUrl));
      setImages((prev) => {
        const next = [...prev, ...urls];
        if (next.length > MAX_IMAGES) setNote(`Up to ${MAX_IMAGES} photos. The extra ones were left out.`);
        return next.slice(0, MAX_IMAGES);
      });
    } catch {
      setNote('That image could not be read. Try a JPEG or PNG.');
    }
  }, []);

  // Paste a screenshot or photo straight from the clipboard.
  useEffect(() => {
    if (!start) return;
    const onPaste = (ev: ClipboardEvent) => {
      const files = [...(ev.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith('image/'))) {
        ev.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [start, addFiles]);

  const ready = canAnalyse && !busy && (text.trim().length > 0 || images.length > 0);

  return (
    <form
      className={`intake intake-${variant}${dragging ? ' is-dragging' : ''}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!ready) return;
        onSubmit(text.trim(), images);
        if (!start) {
          setText('');
          setImages([]);
        }
      }}
      onDragOver={(ev) => { ev.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(ev) => {
        ev.preventDefault();
        setDragging(false);
        void addFiles([...ev.dataTransfer.files]);
      }}
    >
      <label className="field-label" htmlFor={`intake-text-${variant}`}>
        {labels?.field ?? (start ? 'Describe the product' : 'Add what you know')}
      </label>
      <textarea
        id={`intake-text-${variant}`}
        rows={start ? 4 : 3}
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        placeholder={
          labels?.placeholder ?? (start
            ? 'For example: a 20 W USB-C wall charger, white, about 45 × 40 × 28 mm, folding plug.'
            : 'For example: U1 is marked AC6951C. The cell label says 1200 mAh.')
        }
        onKeyDown={(ev) => {
          // Enter sends, Shift+Enter makes a new line, as in a chat.
          if (!start && ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
            ev.preventDefault();
            ev.currentTarget.form?.requestSubmit();
          }
        }}
        disabled={busy}
      />

      {images.length > 0 && (
        <ul className="thumbs">
          {images.map((src, i) => (
            <li key={src.slice(-32) + i}>
              <img src={src} alt={`Photo ${i + 1}`} />
              <button
                type="button"
                className="thumb-remove"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="intake-actions">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(ev) => {
            void addFiles([...(ev.target.files ?? [])]);
            ev.target.value = '';
          }}
        />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          <ImagePlus size={15} />
          {start ? 'Add photos' : 'Photos'}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {busy ? (labels?.busy ?? 'Analysing…') : (labels?.submit ?? (start ? 'Take it apart' : 'Update teardown'))}
        </button>
      </div>

      {start && labels?.hint !== null && (
        <p className="hint">
          {labels?.hint ?? `Drop, paste or pick up to ${MAX_IMAGES} photos. Outside views work; an opened unit with the board visible works much better.`}
        </p>
      )}
      {note && <p className="hint hint-warn" role="status">{note}</p>}
    </form>
  );
}
