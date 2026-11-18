import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type Ref, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useOverlay } from './keys.ts';
import { Button, cn } from './ui.tsx';

/** A picture, and the same one large over the page once it is clicked, with the other pictures of its message to step
 * through, to zoom into and move about. The looks, the keys and the zoom are T3 Code's (MIT, see THIRD_PARTY_NOTICES.md):
 * `ExpandedImageDialog.tsx`, `ZoomableImage.tsx` and `markdownImageGallery.ts`. */
export function Picture({ src, alt = '', className, onError }: { src: string; alt?: string; className?: string; onError?: () => void }) {
  const [shown, setShown] = useState<Gallery>(), opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} type="button" data-picture="" aria-label={['Show the image large', alt].filter(Boolean).join(': ')} onClick={event => setShown(gallery(event.currentTarget))} className="inline-block cursor-zoom-in rounded-lg align-top outline-none focus-visible:ring-2 focus-visible:ring-ring"><img src={src} alt={alt} className={className} onError={onError} /></button>
      {shown && <Viewer {...shown} opener={opener} onClose={() => setShown(undefined)} />}
    </>
  );
}

type Shown = { src: string; alt: string };
type Gallery = { pictures: Shown[]; at: number };

/** The pictures the one `from` opens is shown with: every picture of the part of the page marked `data-gallery` around it
 * (a message, the images waiting in the composer), in their order, so a `Picture` put in one joins it. Out of every such
 * part it is shown alone. */
function gallery(from: HTMLElement): Gallery {
  const images = [...(from.closest('[data-gallery]') ?? from).querySelectorAll('[data-picture] > img')].filter(image => image instanceof HTMLImageElement);
  const at = images.findIndex(image => image.parentElement === from);
  return { pictures: images.map(image => ({ src: image.getAttribute('src') ?? '', alt: image.alt })), at: Math.max(0, at) };
}

/** The dialog. Esc puts it away, and so does a press beside the picture (`useOverlay` for the key); either gives the focus
 * back to `opener`. ← and → step, round the ends. */
function Viewer({ pictures, at: first, opener, onClose }: Gallery & { opener: RefObject<HTMLElement | null>; onClose: () => void }) {
  const [at, setAt] = useState(first), box = useRef<HTMLDialogElement>(null), zoom = useRef<Zoom>(null);
  // A modal dialog, so it lies over everything, a sheet too, and the browser keeps the focus in it.
  useLayoutEffect(() => { box.current?.showModal(); box.current?.focus(); }, []);
  // Closed as a dialog is, which is what gives the focus back to the picture it was opened from.
  useOverlay(true, () => box.current?.close(), box, opener);
  const many = pictures.length > 1, picture = pictures[at];
  const step = (by: number) => setAt((at + by + pictures.length) % pictures.length);
  const keys = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const by = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (zoom.current?.keys(event.key)) event.preventDefault();
    else if (many && by) { event.preventDefault(); step(by); }
  };
  const nav = 'absolute top-1/2 z-20 size-10 -translate-y-1/2 rounded-full border-transparent text-white/90 hover:bg-white/10 hover:text-white focus-visible:ring-white';
  return createPortal(
    <dialog ref={box} tabIndex={-1} aria-label="The image, large" onKeyDown={keys} onClose={() => { onClose(); opener.current?.focus({ preventScroll: true }); }}
      // Beside the picture is the dialog itself; a drag that moves a zoomed picture starts on the picture, and is no press beside it.
      onPointerDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); box.current?.close(); } }}
      className="enter fixed inset-0 m-0 flex size-full max-h-none max-w-none items-center justify-center bg-black/85 p-6 outline-none backdrop:bg-transparent">
      <Button variant="ghost-muted" size="icon-sm" aria-label="Close the image" onClick={() => box.current?.close()} className="absolute top-3 right-3 z-20 rounded-full bg-black/65 text-white ring-1 ring-white/20 hover:bg-black/80 hover:text-white focus-visible:ring-white"><XIcon /></Button>
      {many && <Button variant="ghost-muted" size="icon-sm" aria-label="Previous image" onClick={() => step(-1)} className={cn(nav, 'left-3')}><ChevronLeftIcon className="size-5" /></Button>}
      {picture && (
        <div className="pointer-events-none flex max-h-full flex-col items-center">
          <Zoomable key={at} ref={zoom} picture={picture} />
          {many && <p aria-live="polite" className="mt-2 text-white/80 text-xs tabular-nums">{at + 1} / {pictures.length}</p>}
        </div>
      )}
      {many && <Button variant="ghost-muted" size="icon-sm" aria-label="Next image" onClick={() => step(1)} className={cn(nav, 'right-3')}><ChevronRightIcon className="size-5" /></Button>}
    </dialog>,
    document.body,
  );
}

/** What the dialog's keys do to the picture: whether it took `key`. */
type Zoom = { keys: (key: string) => boolean };
const MAX = 8;
/** How far an arrow moves a zoomed picture. */
const MOVES: Partial<Record<string, [x: number, y: number]>> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] };
const resized = (changed: () => void) => { addEventListener('resize', changed); return () => removeEventListener('resize', changed); };

/** The picture, fitted to the window (never made larger than it is) and zoomed up to eight times that. A pinch, or a wheel
 * with ⌘ or Ctrl, zooms about the pointer, and the wheel then moves it; a click zooms in two times there or back out, a drag
 * moves it. + − 0 zoom in, out and back, and the arrows move a zoomed picture before they step. A new picture starts fitted. */
function Zoomable({ picture, ref }: { picture: Shown; ref: Ref<Zoom> }) {
  const view = useRef<HTMLDivElement>(null), drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number }>(null), dragged = useRef(false);
  const [natural, setNatural] = useState({ width: 0, height: 0 }), [zoom, setZoom] = useState(1), [dragging, setDragging] = useState(false);
  const width = useSyncExternalStore(resized, () => innerWidth), height = useSyncExternalStore(resized, () => innerHeight);
  const most = { width: width * 0.92 - (width >= 640 ? 96 : 0), height: Math.max(1, Math.min(height * 0.86, height - 160)) };
  const fit = Math.min(1, most.width / (natural.width || 1), most.height / (natural.height || 1));
  const size = { width: natural.width * fit * zoom, height: natural.height * fit * zoom };

  // Zoomed about a point of the window (else the middle of the picture), which stays where it is.
  const zoomTo = (next: number, point?: { x: number; y: number }) => {
    const here = view.current, to = Math.min(MAX, Math.max(1, next));
    if (!here || to === zoom) return;
    const was = here.getBoundingClientRect();
    const x = point ? point.x - was.left : here.clientWidth / 2, y = point ? point.y - was.top : here.clientHeight / 2;
    const left = (here.scrollLeft + x) / zoom, top = (here.scrollTop + y) / zoom;
    // The new size is laid out before the scroll can keep the point in place.
    flushSync(() => setZoom(to));
    const is = here.getBoundingClientRect();
    here.scrollLeft = left * to - (was.left + x - is.left);
    here.scrollTop = top * to - (was.top + y - is.top);
  };
  useImperativeHandle(ref, () => ({
    keys(key) {
      const here = view.current;
      if (key === '+' || key === '=') zoomTo(zoom * 1.5);
      else if (key === '-') zoomTo(zoom / 1.5);
      else if (key === '0') zoomTo(1);
      else {
        const by = MOVES[key];
        if (!by || !here || zoom <= 1) return false;
        // Left and right step to the next picture once there is nothing more to move to that way.
        const room = by[0] < 0 ? here.scrollLeft : here.scrollWidth - here.clientWidth - here.scrollLeft;
        if (by[0] !== 0 && room < 1) return false;
        here.scrollBy(by[0], by[1]);
      }
      return true;
    },
  }), [zoom]);
  // A pinch comes as a wheel with Ctrl. React's `onWheel` is passive, and could not keep the browser from zooming the page.
  useEffect(() => {
    const here = view.current;
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (here?.clientHeight ?? 1) : 1);
      zoomTo(zoom * Math.exp(-delta * 0.01), { x: event.clientX, y: event.clientY });
    };
    here?.addEventListener('wheel', wheel, { passive: false });
    return () => here?.removeEventListener('wheel', wheel);
  }, [zoom]);

  return (
    <div ref={view} className="enter enter-grow pointer-events-auto overflow-auto overscroll-contain rounded-lg bg-background shadow-2xl ring-1 ring-border/70"
      style={{ width: natural.width ? Math.min(size.width, most.width) : undefined, height: natural.height ? Math.min(size.height, most.height) : undefined, cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in' }}
      // A drag ends in a click, which leaves the zoom as it is; so does a click's second in a double click.
      onClick={event => { if (!dragged.current && event.detail < 2) zoomTo(zoom > 1 ? 1 : 2, { x: event.clientX, y: event.clientY }); }}
      onPointerDown={event => {
        dragged.current = false;
        const here = event.currentTarget, at = here.getBoundingClientRect();
        // Not on a scroll bar, which moves the picture itself.
        if (event.pointerType !== 'mouse' || event.button !== 0 || zoom <= 1 || event.clientX - at.left >= here.clientWidth || event.clientY - at.top >= here.clientHeight) return;
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: here.scrollLeft, top: here.scrollTop };
        here.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={event => {
        const from = drag.current;
        if (from?.pointer !== event.pointerId) return;
        if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4) dragged.current = true;
        event.currentTarget.scrollLeft = from.left - (event.clientX - from.x);
        event.currentTarget.scrollTop = from.top - (event.clientY - from.y);
      }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <img src={picture.src} alt={picture.alt} draggable={false} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        className="block max-w-none select-none" style={natural.width ? size : { maxWidth: most.width, maxHeight: most.height }} />
    </div>
  );
}
