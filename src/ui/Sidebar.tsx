import { CheckIcon, MessageSquareIcon, MessagesSquareIcon, SquarePenIcon, XIcon } from 'lucide-react';
import type { WindowState } from '../protocol.ts';
import { label } from './keys.ts';
import { canComplete } from '../window.ts';
import { app, title, type State } from './store.ts';
import { Button, cn, Kbd, StatusDot } from './ui.tsx';

/** A dot for a window that is working, or whose Pi failed. */
function Dot({ window }: { window: WindowState }) {
  if (window.status === 'running' || window.status === 'starting') return <StatusDot tone="working" pulse />;
  return window.error ? <StatusDot tone="failed" /> : null;
}
/** The profile's windows: its main chat on top, connected windows below, each with Complete and close. The row and its states
 * are T3 Code's sidebar thread row (MIT, see THIRD_PARTY_NOTICES.md). */
export function Sidebar({ state, profile, selected }: { state: State; profile: string; selected: string }) {
  const windows = state.windows.filter(window => window.profile === profile);
  return (
    <nav aria-label="Windows" className="flex h-full w-(--sidebar-width) shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground">
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 pt-3">
        {windows.map((window, index) => {
          const active = window.id === selected;
          return (
            <li key={window.id} className="group/row relative">
              <button type="button" aria-current={active || undefined} onClick={() => app.select(window.id)}
                className={cn('flex h-9 w-full select-none items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  active ? 'bg-sidebar-row-active light:ring-1 light:ring-sidebar-border/70 light:ring-inset' : 'hover:bg-sidebar-row-hover')}>
                {window.role === 'main' ? <MessagesSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
                  : window.completed ? <span title="Completed: handed to the main chat" className="flex"><CheckIcon aria-label="Completed" className="size-4 shrink-0 text-sidebar-muted-foreground" /></span>
                  : <MessageSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />}
                <span className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-medium text-foreground' : 'text-sidebar-foreground/80', window.completed && 'text-sidebar-muted-foreground')}>{title(window, state)}</span>
                <span className="flex h-6 shrink-0 items-center justify-end gap-1 group-focus-within/row:invisible group-hover/row:invisible">
                  <Dot window={window} />{index < 9 && <Kbd className="bg-transparent text-2xs text-sidebar-muted-foreground/70">{label(`alt+${index + 1}`)}</Kbd>}
                </span>
              </button>
              {window.role === 'connected' && (
                <span className="absolute inset-y-0 right-1.5 hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex">
                  {canComplete(window) && <Button variant="ghost-muted" size="icon-xs" aria-label="Complete" title="Complete: hand this conversation to the main chat" onClick={() => void app.complete(window.id)}><CheckIcon /></Button>}
                  <Button variant="ghost-muted" size="icon-xs" aria-label="Close window" title="Close window" onClick={() => void app.closeWindow(window.id)}><XIcon /></Button>
                </span>
              )}
            </li>
          );
        })}
        <li>
          <button type="button" title={`New window (${label('mod+shift+o')})`} onClick={() => void app.newWindow(profile)} className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sidebar-muted-foreground text-sm hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            <SquarePenIcon className="size-4 shrink-0" />New window
          </button>
        </li>
      </ul>
    </nav>
  );
}
