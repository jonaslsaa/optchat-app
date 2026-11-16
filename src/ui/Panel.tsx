import { XIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AgentHead, Agents } from './Agents.tsx';
import { GitHub } from './GitHub.tsx';
import { useShortcuts } from './keys.ts';
import type { State } from './store.ts';
import { Button, cn, useMedia } from './ui.tsx';

/** Where the page has room for the panel beside the chat: Tailwind's `lg`. */
export const BESIDE = '(min-width: 64rem)';
/** What the open panel shows: the chat of `agent` in place of its lists, when one is opened. */
export interface Shown { agent?: string }

/** The panel of the main chat: its agents, and under them the issues and pull requests it named. Each is there only when it
 * has something to list, and both are read while the panel is open. An agent that is opened has the panel to itself.
 *
 * It stands beside the chat where the page has room for both. Where it has not, it lies over the chat as a sheet, which is a
 * modal dialog: the browser keeps the focus in it and, when it closes, gives it back to what opened it.
 *
 * The keys in it are its own (`data-keys`): Esc goes back from an agent's chat to the lists. On the lists it does nothing
 * beside the chat, and closes the sheet, as the browser closes a dialog. A run in the chat is not stopped from here. */
export function Panel({ state, profile, shown: { agent }, pulse, turn, outside, onShow }: { state: State; profile: string; shown: Shown; pulse: string; turn: string; outside: boolean; onShow: (shown?: Shown) => void }) {
  const onAgent = (agent?: string) => onShow({ agent }), onClose = () => onShow();
  const nothing = state.agents[profile]?.agents.length === 0 && state.github[profile]?.items.length === 0;
  const sheet = !useMedia(BESIDE), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (sheet && !dialog.current?.open) dialog.current?.showModal(); }, [sheet]);
  // A sheet is closed as a dialog is, which is what returns the focus; it says when it has closed.
  const close = () => sheet ? dialog.current?.close() : onClose();
  useShortcuts((): Record<string, () => void> => agent === undefined ? {} : { escape: () => onAgent() }, [agent], 'panel');
  const panel = (
    <aside aria-label="Agents and GitHub" data-keys="panel" className={cn(!sheet && 'enter', 'relative flex h-full w-(--panel-width) max-w-[calc(100vw-2.5rem)] in-data-[shell=windowed]:max-w-[calc(100vw-var(--window-buttons)-0.5rem)] shrink-0 flex-col border-border border-l bg-background')}>
      {/* An agent's chat has a bar over it. The lists have none: the way out stands at the end of their first heading. */}
      <div className={cn('flex h-(--topbar-height) shrink-0 items-center gap-1.5 px-2.5', agent === undefined ? 'absolute top-0 right-0 z-10 rounded-bl-lg bg-background' : 'window-bar')}>
        {agent !== undefined && <AgentHead state={state} profile={profile} id={agent} onAgent={onAgent} />}
        <Button variant="ghost-muted" size="icon-sm" aria-label="Close the panel" title="Close" onClick={close}><XIcon /></Button>
      </div>
      {/* The agents stand in one place, list or chat, so the list is as long as it was when the way back is taken. */}
      <div className={cn('min-h-0 flex-1', agent === undefined ? 'overflow-y-auto pt-[calc((var(--topbar-height)-2.5rem)/2)] pb-3' : 'flex flex-col')}>
        <Agents state={state} profile={profile} agent={agent} pulse={pulse} outside={outside} onAgent={onAgent} />
        {agent === undefined && <GitHub state={state} profile={profile} pulse={turn} />}
        {agent === undefined && nothing && <p className="px-6 pt-14 text-balance text-center text-muted-foreground text-sm">Nothing yet. The agents the main chat starts are listed here, and the PRs and issues it names by link.</p>}
      </div>
    </aside>
  );
  if (!sheet) return panel;
  return (
    <dialog ref={dialog} aria-label="Agents and GitHub" data-keys="panel" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) close(); }}
      className="enter enter-from-right fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none max-w-none bg-transparent p-0 text-foreground shadow-xl backdrop:enter backdrop:bg-black/20">
      {panel}
    </dialog>
  );
}
