import { RefreshCwIcon, SquarePenIcon, TerminalIcon } from 'lucide-react';
import { useEffect } from 'react';
import type { WindowState } from '../protocol.ts';
import { app } from './store.ts';
import { Button } from './ui.tsx';

/** In place of the main chat's composer while a Pi outside the app holds the profile: who that is, and the two things to do.
 * The app never joins it unasked. Opening the profile again is what looks whether that Pi still has it. */
export function Outside({ window: { profile }, outside }: { window: WindowState; outside: NonNullable<WindowState['outside']> }) {
  // Coming back to the page looks again: closing that Pi is done somewhere else.
  useEffect(() => {
    const look = () => void app.openProfile(profile);
    addEventListener('focus', look);
    return () => removeEventListener('focus', look);
  }, [profile]);
  return (
    <div role="status" className="shrink-0 px-3 pb-3 sm:px-12 sm:pb-4">
      <div className="mx-auto flex w-full max-w-(--chat-content-max-width) gap-3 rounded-2xl border border-warning/40 bg-warning-surface px-4 py-3">
        <TerminalIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">This chat is running outside the app</p>
          <p className="text-muted-foreground">
            {outside === 'unknown' ? 'Another Pi has this profile open.' : <>Pi {outside.pid} on {outside.host} has it open, in <code className="font-mono text-xs">{outside.cwd}</code>.</>} Close it there to go on here.
          </p>
          <p className="mt-2.5 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void app.openProfile(profile)}><RefreshCwIcon />Check again</Button>
            <Button variant="outline" onClick={() => void app.newWindow(profile)}><SquarePenIcon />Open a connected window</Button>
          </p>
        </div>
      </div>
    </div>
  );
}
