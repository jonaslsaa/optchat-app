import { CheckIcon, ChevronsUpDownIcon, MessageSquareIcon, MessagesSquareIcon, SquarePenIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WindowState } from '../protocol.ts';
import { label } from './keys.ts';
import { app, mainOf, type State } from './store.ts';
import { words } from './transcript.ts';
import { Button, cn, Kbd, StatusDot } from './ui.tsx';

/** What a window is called: the main chat, or a connected window by its first message. */
export function title(window: WindowState, state: State) {
  if (window.role === 'main') return 'Main chat';
  const first = [...state.sessions[window.id] ?? [], ...state.live[window.id]?.messages ?? []].find(message => message.role === 'user');
  return first ? words(first.content).split('\n')[0] : 'New window';
}
function Dot({ window }: { window: WindowState }) {
  if (window.status === 'running' || window.status === 'starting') return <StatusDot tone="working" pulse />;
  if (window.error) return <StatusDot tone="failed" />;
  if (window.completed) return <StatusDot tone="done" />;
  return null;
}
/** The profile's name, which opens the list of profiles: picking another opens it in a tab. */
function Profiles({ state, profile }: { state: State; profile: string }) {
  const [open, setOpen] = useState(false), menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menu.current?.contains(event.target as Node)) setOpen(false); };
    addEventListener('pointerdown', away); addEventListener('keydown', away);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', away); };
  }, [open]);
  return (
    <div ref={menu} className="relative min-w-0 flex-1">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left font-semibold text-sm hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 flex-1 truncate">{profile}</span><ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Profiles" className="absolute inset-x-0 top-9 z-50 max-h-80 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {state.profiles.map(name => (
            <li key={name} role="option" aria-selected={name === profile}>
              <button type="button" autoFocus={name === profile} onClick={() => { setOpen(false); void app.openProfile(name); }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <span className="min-w-0 flex-1 truncate">{name}</span>{name === profile && <CheckIcon className="size-3.5 text-muted-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The profile's windows: its main chat on top, connected windows below, each with Complete and close. The row and its states
 * are T3 Code's sidebar thread row (MIT, see THIRD_PARTY_NOTICES.md). */
export function Sidebar({ state, profile, selected }: { state: State; profile: string; selected: string }) {
  const windows = state.windows.filter(window => window.profile === profile);
  const ordered = [...windows.filter(window => window.id === mainOf(profile)), ...windows.filter(window => window.id !== mainOf(profile))];
  return (
    <nav aria-label="Windows" className="flex h-full w-(--sidebar-width) shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-(--topbar-height) shrink-0 items-center gap-1 px-2">
        <Profiles state={state} profile={profile} />
        <Button variant="ghost-muted" size="icon-sm" aria-label="New window" title={`New window (${label('mod+shift+o')})`} onClick={() => void app.newWindow(profile)}><SquarePenIcon /></Button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {ordered.map((window, index) => {
          const active = window.id === selected;
          return (
            <li key={window.id} className="group/row relative">
              <button type="button" aria-current={active || undefined} onClick={() => app.select(window.id)}
                className={cn('flex h-9 w-full select-none items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  active ? 'bg-sidebar-row-active light:ring-1 light:ring-sidebar-border/70 light:ring-inset' : 'hover:bg-sidebar-row-hover')}>
                {window.role === 'main' ? <MessagesSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" /> : <MessageSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />}
                <span className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-medium text-foreground' : 'text-sidebar-foreground/80', window.completed && 'text-sidebar-muted-foreground')}>{title(window, state)}</span>
                <span className="flex h-6 shrink-0 items-center justify-end gap-1 group-focus-within/row:invisible group-hover/row:invisible">
                  <Dot window={window} />{index < 9 && <Kbd className="bg-transparent text-2xs text-sidebar-muted-foreground/70">{label(`alt+${index + 1}`)}</Kbd>}
                </span>
              </button>
              {window.role === 'connected' && (
                <span className="absolute inset-y-0 right-1.5 hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex">
                  {window.owner === false && !window.completed && <Button variant="ghost-muted" size="icon-xs" aria-label="Complete" title="Complete: hand this conversation to the main chat" onClick={() => void app.complete(window.id)}><CheckIcon /></Button>}
                  <Button variant="ghost-muted" size="icon-xs" aria-label="Close window" title="Close window" onClick={() => void app.close(window.id)}><XIcon /></Button>
                </span>
              )}
            </li>
          );
        })}
        <li>
          <button type="button" onClick={() => void app.newWindow(profile)} className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sidebar-muted-foreground text-sm hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            <SquarePenIcon className="size-4 shrink-0" />New window
          </button>
        </li>
      </ul>
    </nav>
  );
}
