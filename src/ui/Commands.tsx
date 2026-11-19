import { FileIcon, FolderIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Command, Mention, WindowState } from '../protocol.ts';
import { asked, matching, offered, SOURCES } from './commands.ts';
import { mention, mentioned } from './mentions.ts';
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
export function useCommands(state: State, window: WindowState, text: string, change: (text: string) => void, area: RefObject<HTMLTextAreaElement | null>, root: RefObject<HTMLDivElement | null>) {
  const typed = asked(text), known = state.commands[window.id], id = useId();
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
    <Popup>
      <Options id={id} label="Commands" rows={rows} at={at} onPick={pick} empty="Asking Pi for its commands…"
        head={(row, k) => !typed && rows[k - 1]?.source !== row.source && <p className="px-2 pt-2 pb-1 font-medium text-2xs text-muted-foreground select-none">{SOURCES[row.source]}</p>}>
        {row => <><span className="shrink-0">/{row.name}</span><span className="min-w-0 truncate text-muted-foreground text-xs">{row.description}</span></>}
      </Options>
    </Popup>
  );
  return { menu, keyed, field: { 'aria-controls': open ? `${id}-list` : undefined, 'aria-activedescendant': open && rows[at] ? `${id}-${at}` : undefined } };
}

/** The list over the composer that a `/` or an `@` opens. */
const Popup = ({ children }: { children: ReactNode }) => (
  <div className="absolute inset-x-0 bottom-full z-50 mb-2 flex max-h-72 origin-bottom-left flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] enter enter-grow dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">{children}</div>
);

/** The list an `@` opens, as Pi's terminal has it: the files and folders of the folder the window runs in that match the path
 * typed after it (`mentions`), at the start of the message or anywhere after a space. Its keys are those of the list of
 * commands. A file taken is put in the message as Pi reads one, `@path` and a space; a folder is `@folder/`, and the list
 * goes on with what is in it. `caret` is where the caret is, and `change` is given the message and where it goes then. */
export function useMentions(window: WindowState, text: string, caret: number, change: (text: string, caret: number) => void, area: RefObject<HTMLTextAreaElement | null>, root: RefObject<HTMLDivElement | null>) {
  const at = mentioned(text, caret), query = at?.query, id = useId(), latest = useRef(at), placed = useRef<number>(undefined);
  latest.current = at;
  const [found, setFound] = useState<{ query: string; mentions: Mention[] }>(), [shut, setShut] = useState<number>(), [moved, setMoved] = useState<{ query: string; at: number }>();
  useEffect(() => {
    if (query === undefined) { setFound(undefined); setShut(undefined); return; }
    let asked = true;
    void app.mentions(window.id, query).then(mentions => { if (asked) setFound({ query, mentions }); });
    return () => { asked = false; };
  }, [window.id, query]);
  // While the next answer is on its way, the last one stays: the list does not flicker with each letter.
  const rows = at && found ? found.mentions : [], open = !!at && shut !== at.start && rows.length > 0, index = moved && moved.query === query ? Math.min(moved.at, rows.length - 1) : 0;
  useOverlay(open, () => setShut(latest.current?.start), root, area);
  const pick = (row: Mention) => {
    // A row of the last letter's list is not taken, by a click or a key: the next list is on its way.
    if (!at || found?.query !== query) return;
    const next = mention(text, caret, at, row);
    area.current?.focus();
    if (next.text === text) { area.current?.setSelectionRange(next.caret, next.caret); return; }
    placed.current = next.caret;
    change(next.text, next.caret);
  };
  // The caret goes after what was taken once the box has it, before the next key: not a frame later, when more may be typed.
  useLayoutEffect(() => {
    if (placed.current === undefined) return;
    area.current?.setSelectionRange(placed.current, placed.current);
    placed.current = undefined;
  }, [text]);
  const keyed = (event: KeyboardEvent) => {
    const { key } = event, row = rows[index], plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (!open || query === undefined || !plain || event.nativeEvent.isComposing) return false;
    if (key === 'ArrowDown' || key === 'ArrowUp') setMoved({ query, at: stepped(key, index, rows.length) });
    // Until the list is that of what is typed now, Tab and Enter wait: a row of the last letter's is not taken, nor the message sent.
    else if (key === 'Tab' || key === 'Enter') { if (row) pick(row); }
    else return false;
    event.preventDefault();
    return true;
  };
  const menu = open && (
    <Popup>
      <Options id={id} label="Files" rows={rows} at={index} onPick={pick} empty={null}>
        {row => {
          const slash = row.path.lastIndexOf('/'), Icon = row.dir ? FolderIcon : FileIcon;
          return <><Icon className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 shrink truncate">{row.path.slice(slash + 1)}{row.dir && '/'}</span><span className="min-w-0 truncate text-muted-foreground text-xs">{row.path.slice(0, Math.max(0, slash))}</span></>;
        }}
      </Options>
    </Popup>
  );
  return { active: !!at, menu, keyed, field: { 'aria-controls': open ? `${id}-list` : undefined, 'aria-activedescendant': open && rows[index] ? `${id}-${index}` : undefined } };
}
