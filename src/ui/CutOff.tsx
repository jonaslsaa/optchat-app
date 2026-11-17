import { XIcon } from 'lucide-react';
import { useState } from 'react';
import { app, cutOffShown, type State } from './store.ts';

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
