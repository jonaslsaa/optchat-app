import { DownloadIcon, RefreshCwIcon, RotateCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Updating } from '../protocol.ts';
import { app } from './store.ts';
import { Button, cn } from './ui.tsx';

/** What the updater is doing, in the words the button's tooltip says and a screen reader reads. */
export function says(update: Updating) {
  switch (update.state) {
    case 'idle': return update.looked ? 'No update found. Look again' : 'Look for an update';
    case 'looking': return 'Looking for an update…';
    case 'downloading': return `Downloading OptChat ${update.version}: ${update.percent}%`;
    case 'ready': return `OptChat ${update.version} is ready. Restart to install it`;
    case 'manual': return `OptChat ${update.version} is out. Open its page to download it`;
    case 'failed': return `Could not look for an update: ${update.error.replace(/\.$/, '')}. Try again`;
  }
}

// The ring a download fills, around the button: a circle whose line is as long as the part that is there.
const RADIUS = 14, AROUND = 2 * Math.PI * RADIUS;
const MARK = 'absolute top-0.5 right-0.5 size-1.5 rounded-full';

/** The desktop app's update button: a small round one that shows what the updater is doing (docs/desktop.md) and, clicked,
 * does the next thing, which is the app's to do and to say: it looks now, asks whether to restart into the update that is
 * ready, or opens the page of one you have to get yourself. It turns while it looks, fills a ring while it downloads, and has
 * a mark when there is something for you: an update, or a look that failed. Not a button while it is busy. The icons and
 * the ring are T3 Code's sidebar update button (MIT, see THIRD_PARTY_NOTICES.md). */
export function UpdateButton({ update, className }: { update: Updating; className?: string }) {
  const { state } = update, looking = state === 'looking', busy = looking || state === 'downloading', text = says(update);
  // A look is over in a moment: the turn it started is finished, so the icon never jumps back.
  const [turning, setTurning] = useState(false);
  useEffect(() => { if (looking) setTurning(true); }, [looking]);
  return (
    <Button variant="ghost-muted" size="icon-sm" aria-label={text} title={text} aria-disabled={busy || undefined} data-update={state}
      className={cn('rounded-full', busy && 'cursor-default hover:bg-transparent active:scale-100', (state === 'ready' || state === 'manual') && 'text-foreground', className)}
      onClick={() => { if (!busy) void app.update(); }}>
      {state === 'downloading' ? (
        <>
          <svg aria-hidden="true" viewBox="0 0 32 32" className="enter pointer-events-none absolute -inset-px size-7 -rotate-90">
            <circle cx="16" cy="16" r={RADIUS} fill="none" strokeWidth="1.5" className="stroke-current/20" />
            <circle cx="16" cy="16" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={AROUND} strokeDashoffset={AROUND * (1 - update.percent / 100)}
              className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none" />
          </svg>
          <DownloadIcon className="enter size-3.5" />
        </>
      ) : state === 'ready' ? <RotateCwIcon className="enter" />
        : state === 'manual' ? <DownloadIcon className="enter" />
        : <RefreshCwIcon className={cn(turning && 'motion-safe:animate-spin')} onAnimationIteration={() => { if (!looking) setTurning(false); }} />}
      {(state === 'ready' || state === 'manual') && <span className={cn(MARK, 'enter bg-sky-500 dark:bg-sky-300/80')} />}
      {state === 'failed' && <span className={cn(MARK, 'enter bg-warning')} />}
    </Button>
  );
}
