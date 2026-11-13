import { CheckIcon, MessageSquareIcon, MessagesSquareIcon, SquarePenIcon, XIcon } from 'lucide-react';
import { canComplete } from '../window.ts';
import { label, useAltHeld } from './keys.ts';
import { app, title, UNTITLED, type State } from './store.ts';
import { Button, cn, Kbd, WindowDot } from './ui.tsx';

/** The profile's windows: its main chat on top, connected windows below, each with Complete and close, under a top row as high
 * as the chat's, where a new window is opened. A row shows its ⌥ digit while ⌥ is held. The row and its states are T3 Code's
 * sidebar thread row (MIT, see THIRD_PARTY_NOTICES.md). */
export function Sidebar({ state, profile, selected }: { state: State; profile: string; selected: string }) {
  const windows = state.windows.filter(window => window.profile === profile), hints = useAltHeld();
  return (
    <nav aria-label="Windows" className="flex h-full w-(--sidebar-width) shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground">
      <div className="window-bar window-start max-md:window-corner flex h-(--topbar-height) shrink-0 items-center justify-between ps-4.5 pe-2.5">
        <span className="text-sidebar-muted-foreground text-xs"><b className="font-semibold text-sidebar-foreground">Opt</b>Chat</span>
        <Button variant="ghost-muted" size="icon-sm" aria-label="New window" title={`New window (${label('mod+shift+o')})`} onClick={() => void app.newWindow(profile)}><SquarePenIcon /></Button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {windows.map((window, index) => {
          const active = window.id === selected, name = title(window, state), connected = window.role === 'connected', completes = canComplete(window);
          return (
            <li key={window.id} className="group/row relative">
              <button type="button" aria-current={active || undefined} onClick={() => app.select(window.id)}
                className={cn('flex h-9 w-full select-none items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  active ? 'bg-sidebar-row-active light:ring-1 light:ring-sidebar-border/70 light:ring-inset' : 'hover:bg-sidebar-row-hover')}>
                {!connected ? <MessagesSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
                  : window.completed ? <span title="Completed: handed to the main chat" className="flex"><CheckIcon aria-label="Completed" className="size-4 shrink-0 text-sidebar-muted-foreground" /></span>
                  : <MessageSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />}
                {/* Complete and close stand at the end of a connected window's row while the pointer or the focus is on it, and always
                    where there is no pointer to hover with. The title gives them room, so it is cut short before them. */}
                <span className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-medium text-foreground' : 'text-sidebar-foreground/80', (window.completed || name === UNTITLED) && 'text-sidebar-muted-foreground',
                  connected && (completes ? 'group-focus-within/row:pe-10 group-hover/row:pe-10 pointer-coarse:pe-10' : 'group-focus-within/row:pe-4 group-hover/row:pe-4 pointer-coarse:pe-4'))}>{name}</span>
                <span className={cn('flex h-6 shrink-0 items-center justify-end gap-1', connected && 'group-focus-within/row:invisible group-hover/row:invisible pointer-coarse:invisible')}>
                  <WindowDot windows={[window]} />{hints && index < 9 && <Kbd className="bg-transparent text-2xs text-sidebar-muted-foreground/70 max-md:hidden">{label(`alt+${index + 1}`)}</Kbd>}
                </span>
              </button>
              {connected && (
                <span className="absolute inset-y-0 right-1.5 hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
                  {completes && <Button variant="ghost-muted" size="icon-xs" aria-label="Complete" title="Complete: hand this conversation to the main chat" onClick={() => void app.complete(window.id)}><CheckIcon /></Button>}
                  <Button variant="ghost-muted" size="icon-xs" aria-label="Close window" title="Close window" onClick={() => void app.closeWindow(window.id)}><XIcon /></Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
