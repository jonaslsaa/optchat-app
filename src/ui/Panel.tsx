import { XIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AgentHead, Agents } from './Agents.tsx';
import { GitHub } from './GitHub.tsx';
import { escapes } from './keys.ts';
import type { State } from './store.ts';
import { Button, Choice, useMedia } from './ui.tsx';

/** Where the page has room for the panel beside the chat: Tailwind's `lg`. */
const BESIDE = '(min-width: 64rem)';
const TABS = [['Agents', 'agents'], ['GitHub', 'github']] as const;
/** What the panel shows: the main chat's agents, with the chat of `agent` when one is opened, or what the chat named on GitHub. */
export type Shown = { tab: 'agents'; agent?: string } | { tab: 'github' };

/** The panel of the main chat: its agents, or the issues and pull requests it named, chosen at its top.
 *
 * It stands beside the chat where the page has room for both. Where it has not, it lies over the chat as a sheet, which is a
 * modal dialog: the browser keeps the focus in it and, when it closes, gives it back to what opened it. Esc closes the sheet
 * and nothing else, so a run in the chat under it is not stopped by it. */
export function Panel({ state, profile, shown, pulse, turn, outside, onShow }: { state: State; profile: string; shown: Shown; pulse: string; turn: string; outside: boolean; onShow: (shown?: Shown) => void }) {
  const { tab } = shown, agent = shown.tab === 'agents' ? shown.agent : undefined, onAgent = (agent?: string) => onShow({ tab: 'agents', agent }), onClose = () => onShow();
  const sheet = !useMedia(BESIDE), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (sheet && !dialog.current?.open) dialog.current?.showModal(); }, [sheet]);
  // A sheet is closed as a dialog is, which is what returns the focus; it says when it has closed.
  const close = () => sheet ? dialog.current?.close() : onClose();
  // Esc is the sheet's wherever the focus is: a row that is opened is gone, and the focus with it, to the page itself. So the
  // key is heard on its way down, before the page's shortcuts hear it.
  useEffect(() => {
    if (!sheet) return;
    const pressed = (event: KeyboardEvent) => escapes(event, () => dialog.current?.close());
    addEventListener('keydown', pressed, true);
    return () => removeEventListener('keydown', pressed, true);
  }, [sheet]);
  const label = TABS.find(([, value]) => value === tab)?.[0];
  const panel = (
    <aside aria-label={label} className="flex h-full w-(--panel-width) max-w-[calc(100vw-2.5rem)] shrink-0 flex-col border-border border-l bg-background">
      <div className="flex h-(--topbar-height) shrink-0 items-center gap-1.5 ps-2.5 pe-2.5">
        {agent !== undefined ? <AgentHead state={state} profile={profile} id={agent} onAgent={onAgent} />
          : <><Choice label="What the panel shows" name={`panel-${profile}`} options={TABS} value={tab} onChange={tab => onShow({ tab })} /><span className="flex-1" /></>}
        <Button variant="ghost-muted" size="icon-sm" aria-label="Close the panel" title="Close" onClick={close}><XIcon /></Button>
      </div>
      {tab === 'github' ? <GitHub state={state} profile={profile} pulse={turn} /> : <Agents state={state} profile={profile} agent={agent} pulse={pulse} outside={outside} onAgent={onAgent} />}
    </aside>
  );
  if (!sheet) return panel;
  return (
    <dialog ref={dialog} aria-label={label} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) close(); }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none max-w-none bg-transparent p-0 text-foreground shadow-xl backdrop:bg-black/20">
      {panel}
    </dialog>
  );
}
