import { CheckIcon, ChevronDownIcon, MessageSquareIcon, MessagesSquareIcon, SquarePenIcon, XIcon } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { ROW_EVENT } from '../menu.ts';
import type { WindowState } from '../protocol.ts';
import { canComplete } from '../window.ts';
import { Art } from './Art.tsx';
import { label, useAltHeld } from './keys.ts';
import { Rename } from './Rename.tsx';
import { isObject } from './transcript.ts';
import { app, shelf, shelved, title, UNTITLED, type Shelf, type State } from './store.ts';
import { Button, cn, Kbd, Spinner, WindowDot } from './ui.tsx';
import { UpdateButton } from './Update.tsx';

/** The profile's windows: its main chat on top, connected windows below, and at the foot the shelves of those being handed to
 * the main chat and those it has (`list`, from `shelved`: the profile's, as ⌥ and a digit pick them too), under a top row as high as the chat's, where a new window is opened, and over the
 * desktop app's update button. A row shows its ⌥ digit while ⌥ is
 * held. `onPick`: a window was picked or a new one asked for, which is what the sidebar was opened for where it lies over the
 * chat. A double-click on a connected window's name, F2 on its row, or the desktop app's right-click Rename, renames it (`Rename`), and its
 * right-click Remove removes it. The shelves are T3 Code's "Working" and "Settled" ones, and the row and its states are T3 Code's sidebar thread row (MIT, see THIRD_PARTY_NOTICES.md). */
export function Sidebar({ state, profile, list: { top, shelves, rows }, selected, onPick }: { state: State; profile: string; list: ReturnType<typeof shelved>; selected: string; onPick: () => void }) {
  const hints = useAltHeld(), [renaming, setRenaming] = useState<string>();
  useEffect(() => {
    const asked = ({ detail }: Event & { detail?: unknown }) => {
      if (!isObject(detail) || typeof detail.window !== 'string') return;
      if (detail.action === 'rename') setRenaming(detail.window);
      if (detail.action === 'remove') void app.closeWindow(detail.window);
    };
    // Which row a right click was on, for the desktop app's menu to ask (main.ts): the page's own target, whatever it is zoomed to.
    const clicked = ({ target }: MouseEvent) => {
      const row = target instanceof Element ? target.closest<HTMLElement>('[data-row]')?.dataset.row : undefined;
      if (row) document.documentElement.dataset.menuRow = row; else delete document.documentElement.dataset.menuRow;
    };
    addEventListener(ROW_EVENT, asked); addEventListener('contextmenu', clicked, true);
    return () => { removeEventListener(ROW_EVENT, asked); removeEventListener('contextmenu', clicked, true); delete document.documentElement.dataset.menuRow; };
  }, []);
  const row = (window: WindowState) => {
    const active = window.id === selected, name = title(window, state), connected = window.role === 'connected', index = rows.indexOf(window);
    // Complete while it can be; ✕ for a window that has nothing to hand off and is on no shelf (its Pi stopped or failed). One
    // on a shelf has neither: what is handed off stays, and a right click removes it (or a Pi that never answers Complete).
    const end = !connected ? undefined : canComplete(window) ? 'complete' : shelf(window) ? undefined : 'close';
    return (
      <li key={window.id} data-row={connected ? window.id : undefined} className="group/row relative">
        <button type="button" aria-current={active || undefined} onClick={() => { onPick(); app.select(window.id); }}
          aria-keyshortcuts={connected ? 'F2' : undefined} onKeyDown={event => { if (connected && event.key === 'F2') { event.preventDefault(); setRenaming(window.id); } }}
          className={cn('flex h-9 w-full select-none items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            active ? 'bg-sidebar-row-active light:ring-1 light:ring-sidebar-border/70 light:ring-inset' : 'hover:bg-sidebar-row-hover')}>
          {!connected ? <MessagesSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
            : window.completing ? <span title="Handing off to the main chat" className="flex"><Spinner className="size-4 shrink-0 text-sidebar-muted-foreground" /></span>
            : window.completed ? <span title="Completed: handed to the main chat" className="flex"><CheckIcon aria-label="Completed" className="size-4 shrink-0 text-sidebar-muted-foreground" /></span>
            : <MessageSquareIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />}
          {/* A row with a button shows it at its end while the pointer or the focus is on it, and always where there is no
              pointer to hover with. The title gives it room, so it is cut short before it. */}
          <span onDoubleClick={connected ? () => setRenaming(window.id) : undefined} className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-medium text-foreground' : 'text-sidebar-foreground/80', (window.completed || name === UNTITLED) && 'text-sidebar-muted-foreground',
            end && 'group-focus-within/row:pe-4 group-hover/row:pe-4 pointer-coarse:pe-4')}>{name}</span>
          <span className={cn('flex h-6 shrink-0 items-center justify-end gap-1', end && 'group-focus-within/row:invisible group-hover/row:invisible pointer-coarse:invisible')}>
            <WindowDot windows={[window]} />{hints && index < 9 && <Kbd className="bg-transparent text-2xs text-sidebar-muted-foreground/70 max-md:hidden">{label(`alt+${index + 1}`)}</Kbd>}
          </span>
        </button>
        {renaming === window.id ? <Rename window={window.id} name={name} done={() => setRenaming(undefined)} className="absolute inset-y-1 right-1.5 left-8" /> : end && (
          <span className="absolute inset-y-0 right-1.5 hidden items-center group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
            {end === 'complete' ? <Button variant="ghost-muted" size="icon-xs" aria-label="Complete" title="Complete: hand this conversation to the main chat" onClick={() => { if (active) onPick(); void app.complete(window.id); }}><CheckIcon /></Button>
              : <Button variant="ghost-muted" size="icon-xs" aria-label="Close window" title="Close window" onClick={() => void app.closeWindow(window.id)}><XIcon /></Button>}
          </span>
        )}
      </li>
    );
  };
  return (
    <nav aria-label="Windows" className="relative flex h-full w-(--sidebar-width) shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground">
      {/* A theme's drawing, under the top row: what is on it is white, since the sky is dark in light and dark alike. */}
      <Art />
      <div className="window-bar window-start max-md:window-corner relative flex h-(--topbar-height) shrink-0 items-center justify-between ps-4.5 pe-2.5">
        <span className="text-sidebar-muted-foreground text-xs art:text-white/75"><b className="font-semibold text-sidebar-foreground art:text-white">Opt</b>Chat</span>
        <Button variant="ghost-muted" size="icon-sm" aria-label="New window" title={`New window (${label('mod+shift+o')})`} onClick={() => { onPick(); void app.newWindow(profile); }}
          className="art:text-white/80 art:hover:bg-white/15 art:hover:text-white"><SquarePenIcon /></Button>
      </div>
      <ul className="relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {top.map(row)}
        {/* The first shelf's header takes the room that is left, so the shelves are at the foot. */}
        {shelves.map(({ name, count, open, rows }, at) => <Fragment key={name}>
          <li className={cn(at === 0 && 'mt-auto')}><ShelfHeader shelf={name} count={count} open={open} /></li>
          {rows.map(row)}
        </Fragment>)}
      </ul>
      {/* Where the app updates itself, its update button is at the sidebar's foot. */}
      {state.update && <div className="flex shrink-0 px-2.5 pb-2.5"><UpdateButton update={state.update} /></div>}
    </nav>
  );
}

const SHELF: Record<Shelf, string> = { completing: 'Handing off', completed: 'Completed' };
/** A shelf's header, which opens and closes it, with how many windows are on it: T3 Code's `CollapsibleSectionHeader`. */
function ShelfHeader({ shelf, count, open }: { shelf: Shelf; count: number; open: boolean }) {
  return (
    <button type="button" aria-expanded={open} onClick={() => app.toggleShelf(shelf)}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-medium text-sidebar-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      <span className="min-w-0 flex-1 truncate">{SHELF[shelf]}</span>
      <span className="font-normal tabular-nums">{count}</span>
      <ChevronDownIcon aria-hidden="true" className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')} />
    </button>
  );
}
