import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Command, WindowState } from '../protocol.ts';
import { asked, matching, offered, SOURCES } from './commands.ts';
import { useOverlay } from './keys.ts';
import { app, type State } from './store.ts';
import { Options, stepped } from './ui.tsx';

/** The list a `/` at the start of a message opens over the composer: the prompt templates, skills and commands the window's
 * Pi knows, each with what it is for, fewer as the name is typed. The typing stays in the message: the arrows move through
 * the list, Tab or Enter puts the command in the message for what follows it, and Enter sends a command typed out in full; while Pi
 * is still asked for the list, Enter waits.
 * Esc closes the list and nothing else (`useOverlay`), until the message is no command any more. It is the model picker's
 * list and keys (`Options`). `root` goes round the textarea, which the list lies over (a click on anything else closes it: the model beside it, say), `field` on the textarea, and `keyed` gets its keys
 * first and says whether the list took one. */
export function useCommands(state: State, window: WindowState, text: string, change: (text: string) => void, area: RefObject<HTMLTextAreaElement | null>) {
  const typed = asked(text), known = state.commands[window.id], id = useId(), root = useRef<HTMLDivElement>(null);
  const [shut, setShut] = useState(false), [moved, setMoved] = useState<{ typed: string; at: number }>();
  const rows = useMemo(() => typed === undefined ? [] : matching(offered(known ?? [], window.role), typed), [known, typed, window.role]);
  const wanted = typed !== undefined && !shut, open = wanted && (!known || rows.length > 0), at = moved && moved.typed === typed ? moved.at : 0;
  // Asked each time the list opens: a skill may have been added since. That starts the window's Pi, which a message would too.
  useEffect(() => { if (wanted) void app.readCommands(window.id); }, [wanted, window.id]);
  useEffect(() => { if (typed === undefined) setShut(false); }, [typed === undefined]);
  useOverlay(open, () => setShut(true), root, area);
  const pick = (command: Command) => { change(`/${command.name} `); area.current?.focus(); };
  const keyed = (event: KeyboardEvent) => {
    const { key } = event, row = rows[at], plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    // With Shift, ⌘ or the like a key is the text's own: it selects, or moves the caret.
    if (!open || typed === undefined || !plain || event.nativeEvent.isComposing) return false;
    if (key === 'ArrowDown' || key === 'ArrowUp') setMoved({ typed, at: stepped(key, at, rows.length) });
    // Enter sends a command that is typed out as Pi names it, and takes the row otherwise, which also puts its letters right.
    else if (row && (key === 'Tab' || key === 'Enter' && text !== `/${row.name}`)) pick(row);
    // Until Pi has said what it knows, Enter waits: half a name is not sent as a message.
    else if (known || key !== 'Enter') return false;
    event.preventDefault();
    return true;
  };
  const menu = open && (
    <div className="absolute inset-x-0 bottom-full z-50 mb-2 flex max-h-72 origin-bottom-left flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] enter enter-grow dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
      <Options id={id} label="Commands" rows={rows} at={at} onPick={pick} empty="Asking Pi for its commands…"
        head={(row, k) => !typed && rows[k - 1]?.source !== row.source && <p className="px-2 pt-2 pb-1 font-medium text-2xs text-muted-foreground select-none">{SOURCES[row.source]}</p>}>
        {row => <><span className="shrink-0">/{row.name}</span><span className="min-w-0 truncate text-muted-foreground text-xs">{row.description}</span></>}
      </Options>
    </div>
  );
  return { root, menu, keyed, field: { 'aria-controls': open ? `${id}-list` : undefined, 'aria-activedescendant': open && rows[at] ? `${id}-${at}` : undefined } };
}
