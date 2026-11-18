import { XIcon } from 'lucide-react';
import { useState } from 'react';
import { app, cutOffShown, type State } from './store.ts';

/** A line for each profile whose Pi runs an older pi-optchat than is installed and was at work when the server found that, so
 * it was not started again unasked (`stale`): Restart does it, and stops what it was doing. */
export function Stale({ state }: { state: State }) {
  return state.windows.flatMap(({ profile, stale }) => stale === undefined ? [] : [<StaleLine key={profile} profile={profile} installed={stale} />]);
}
function StaleLine({ profile, installed }: { profile: string; installed: string }) {
  const [restarting, setRestarting] = useState(false);
  const restart = async () => { setRestarting(true); try { await app.restartPi(profile); } finally { setRestarting(false); } };
  return (
    <p role="status" className="notice enter flex shrink-0 items-center justify-center gap-2 bg-warning-surface px-4 py-1.5 text-warning-foreground text-xs">
      <span className="min-w-0 truncate"><span className="font-medium">{profile}</span> · Pi runs an older pi-optchat than the {installed} installed.</span>
      <button type="button" aria-label={`Restart the Pi of ${profile}`} title="Stops what it is doing, and starts it again on the new pi-optchat" disabled={restarting} onClick={() => void restart()} className="shrink-0 rounded-sm font-medium underline underline-offset-2 disabled:no-underline disabled:opacity-60">
        {restarting ? 'Restarting…' : 'Restart'}
      </button>
    </p>
  );
}

/** A line for each profile whose agents a close or crash of their Pi cut off, with the yellow notices: Resume opens the profile
 * and resumes them, and dismissing it keeps it away until an agent of it that started later is cut off. It only asks: resuming
 * spends tokens. Profiles that are not open as tabs are here too. */
export function CutOff({ state }: { state: State }) {
  return cutOffShown(state).map(({ profile, agents }) => <Line key={profile} profile={profile} count={agents.length} />);
}
function Line({ profile, count }: { profile: string; count: number }) {
  const [resuming, setResuming] = useState(false);
  const resume = async () => { setResuming(true); try { await app.resumeAgents(profile); } finally { setResuming(false); } };
  return (
    <p role="status" className="notice enter flex shrink-0 items-center justify-center gap-2 bg-warning-surface px-4 py-1.5 text-warning-foreground text-xs">
      <span className="min-w-0 truncate"><span className="font-medium">{profile}</span> · {count === 1 ? 'An agent was' : `${count} agents were`} cut off when Pi closed.</span>
      <button type="button" aria-label={`Resume the agents of ${profile}`} disabled={resuming} onClick={() => void resume()} className="shrink-0 rounded-sm font-medium underline underline-offset-2 disabled:no-underline disabled:opacity-60">
        {resuming ? 'Resuming…' : 'Resume'}
      </button>
      <button type="button" aria-label={`Dismiss: ${profile}`} onClick={() => app.dismissCutOff(profile)} className="shrink-0 rounded-sm p-0.5 hover:bg-foreground/10"><XIcon className="size-3" /></button>
    </p>
  );
}
