import { ArrowLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Hit, Line, Message, WindowState } from '../protocol.ts';
import { escapes, label, useShortcuts } from './keys.ts';
import { isOpen, key, listed, polled, since, WHO, type Search, type Tree } from './memory.ts';
import { NoteRow, ReplyRow, ReportRow, StepRow, UserRow } from './Rows.tsx';
import { app } from './store.ts';
import { logged, parts } from './transcript.ts';
import { Button, cn, Spinner } from './ui.tsx';

/** The memory view: the lines the agent reads its memory as, each opening into the two it was made from, down to the message
 * itself. It is the main chat at another distance, so it stands where the chat does. Its search finds messages as the agent's
 * own does, and a message that was found opens in the tree, where it is. It only reads: the server reads the profile's files
 * (`view`, `zoom`, `original`, `search`), and nothing here changes a memory. */

const year = new Date().getFullYear();
const day = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...date.getFullYear() !== year && { year: 'numeric' } });
const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
/** When a line's messages were said: a moment, a stretch of one day, or from one day to another. The day is left out where
 * it is `heading`, the day the line stands under. */
function when({ from, to }: Line, heading: string) {
  const first = new Date(from), last = new Date(to), at = (date: Date) => day(date) === heading ? time(date) : `${day(date)}, ${time(date)}`;
  return from === to ? at(first) : first.toDateString() === last.toDateString() ? `${at(first)}–${time(last)}` : `${at(first)} – ${at(last)}`;
}
const EVERY = 3000;
const kilobytes = (bytes: number) => Math.round(bytes / 1000).toLocaleString();

/** A message as it was said, drawn as the chat draws it. A tool call comes with what it printed, as the chat's one row. */
const Original = memo(function Original({ messages, profile }: { messages: Message[]; profile: string }) {
  const drawn = useMemo(() => parts(logged(messages)), [messages]);
  return drawn.map(part => part.type === 'user' ? <UserRow key={part.key} part={part} profile={profile} />
    : part.type === 'work' ? <ReportRow key={part.key} part={part} />
    : part.type === 'note' ? <NoteRow key={part.key} part={part} />
    : part.type !== 'reply' ? null
    : part.answer ? <ReplyRow key={part.key} part={part} latest />
    : <div key={part.key} className="flex min-w-0 flex-col py-1">{part.steps.map(step => <StepRow key={step.key} step={step} />)}</div>);
});
/** One line, and under it what it opens into. */
function TreeLine({ tree, line, profile, heading }: { tree: Tree; line: Line; profile: string; heading: string }) {
  const open = isOpen(tree, line), halves = tree.under[key(line)], original = tree.originals[line.id], found = line.n === 1 && tree.found === line.id;
  // What a line you just opened holds is brought into sight, once it is there: at the end of the view it is under the fold.
  // The line itself stays in sight, where what it holds is taller than the page.
  const under = useRef<HTMLDivElement>(null), asked = useRef(false), there = open && (line.n === 1 ? original : halves) !== undefined;
  useEffect(() => {
    if (there && asked.current) for (const shown of [under.current, under.current?.previousElementSibling]) shown?.scrollIntoView({ block: 'nearest' });
    if (there || !open) asked.current = false;
  }, [there, open]);
  return (
    <div>
      <button type="button" data-line data-found={found || undefined} aria-current={found || undefined} aria-expanded={open} onClick={() => { asked.current = !open; void app.toggleLine(profile, line); }}
        className={cn(ROW, 'scroll-mt-10', found && 'bg-primary/8 ring-1 ring-primary/40 ring-inset hover:bg-primary/12')}>
        <ChevronRightIcon className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block text-muted-foreground text-xs tabular-nums">{when(line, heading)} · {line.n === 1 ? `message ${line.id.toLocaleString()}` : `${line.n.toLocaleString()} messages`}</span>
          {line.text === undefined ? <span className="block text-muted-foreground text-sm italic">Not summarized yet.</span>
            : <span className="block whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{line.text}</span>}
        </span>
      </button>
      {open && (
        <div ref={under} className="ms-3 scroll-mb-3 border-border/70 border-s ps-2">
          {line.n === 1 ? original ? <div className="py-1 ps-1.5"><Original messages={original} profile={profile} /></div> : <Reading />
            : halves ? halves.map(half => <TreeLine key={half.id} tree={tree} line={half} profile={profile} heading={heading} />) : <Reading />}
        </div>
      )}
    </div>
  );
}
const ROW = 'flex w-full items-start gap-1.5 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset';
/** The arrows walk the lines that are in sight, and open and close the one you are on. */
function keys(event: KeyboardEvent) {
  const at = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-line]') : null;
  if (!at || event.metaKey || event.ctrlKey || event.altKey) return;
  const lines = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-line]')], open = at.getAttribute('aria-expanded') === 'true';
  const to = event.key === 'ArrowDown' ? lines[lines.indexOf(at) + 1] : event.key === 'ArrowUp' ? lines[lines.indexOf(at) - 1] : undefined;
  if (to) to.focus();
  else if (event.key === 'ArrowRight' && !open || event.key === 'ArrowLeft' && open) at.click();
  else return;
  event.preventDefault();
}
/** A message a search found: who said it and when, and where it says it. It opens in the tree. */
function Found({ hit, profile }: { hit: Hit; profile: string }) {
  const date = new Date(hit.date);
  return (
    <button type="button" data-line onClick={() => void app.find(profile, hit.id)} className={ROW}>
      <span className="min-w-0 flex-1">
        <span className="block text-muted-foreground text-xs tabular-nums"><span className="font-medium text-foreground">{WHO[hit.kind]}</span> · {day(date)}, {time(date)} · message {hit.id.toLocaleString()}{hit.imported && ' · imported'}</span>
        <span className="line-clamp-2 text-muted-foreground text-sm leading-relaxed [overflow-wrap:anywhere]">{hit.lead}<mark className="bg-transparent font-semibold text-foreground">{hit.match}</mark>{hit.rest}</span>
      </span>
    </button>
  );
}
/** What a search found, newest first, in the tree's place. */
function Results({ answer, profile }: { answer: NonNullable<Search['answer']>; profile: string }) {
  return (
    <div role="region" aria-label="Messages found" onKeyDown={keys} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 sm:px-5">
      <div className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) pt-2 pb-6">
        {answer.hits.map(hit => <Found key={hit.id} hit={hit} profile={profile} />)}
        {answer.more > 0 && <Button variant="ghost-muted" size="xs" className="ms-1.5 mt-2" onClick={() => void app.moreFound(profile)}>Show older ones ({answer.more.toLocaleString()} more)</Button>}
      </div>
    </div>
  );
}
const Reading = () => <p className="flex items-center gap-1.5 px-1.5 py-1.5 text-muted-foreground text-xs"><Spinner className="size-3" />Reading…</p>;

/** It is read again when the main chat changes (`pulse`), and every three seconds while that says too little (`polled`): the
 * server keeps what it read until the files change, so a look costs it a glance at them. */
export const MemoryView = memo(function MemoryView({ tree, profile, window, pulse }: { tree: Tree; profile: string; window: WindowState; pulse: string }) {
  const { view } = tree, scroller = useRef<HTMLDivElement>(null), shown = useRef(false), active = polled(tree, window);
  // Where the keys were before the view took them, which is the composer.
  const [before] = useState(() => document.activeElement);
  useEffect(() => { void app.readMemory(profile); }, [profile, pulse]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void app.readMemory(profile), EVERY);
    return () => clearInterval(timer);
  }, [profile, active]);
  // It opens at the newest line, as the chat does, and with the keys on it; after that it stays where you are.
  useLayoutEffect(() => {
    if (!view || shown.current || !scroller.current) return;
    shown.current = true;
    scroller.current.scrollTop = scroller.current.scrollHeight;
    [...scroller.current.querySelectorAll<HTMLElement>('[data-line]')].at(-1)?.focus({ preventScroll: true });
  }, [view]);
  // They go back there when the chat is shown again.
  useEffect(() => () => { if (before instanceof HTMLElement && before.isConnected) before.focus(); }, [before]);
  // A message that was found is brought to the top of the page, with the keys on its line, once the tree is open down to it.
  const { search, found } = tree, results = listed(tree), box = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const at = found === undefined ? null : scroller.current?.querySelector<HTMLElement>('[data-found]');
    at?.scrollIntoView({ block: 'start' });
    at?.focus({ preventScroll: true });
  }, [found]);
  useShortcuts(() => ({ 'mod+f': () => { box.current?.focus(); box.current?.select(); } }), []);
  // Ending the search leaves the keys in its box: what they were on may be gone.
  const end = () => { void app.search(profile, ''); box.current?.focus(); };
  // Esc ends a search from anywhere in the view. From the first message found, ↑ goes back to the box.
  const keyed = (event: KeyboardEvent) => {
    if (search) escapes(event, end);
    if (event.key === 'ArrowUp' && results && !event.defaultPrevented && event.target !== box.current) { event.preventDefault(); box.current?.focus(); }
  };
  const answer = search?.answer, count = (answer?.hits.length ?? 0) + (answer?.more ?? 0), matches = `${count.toLocaleString()} ${count === 1 ? 'message' : 'messages'}`;
  // Each line stands under the day its first message was said, which is written once, over the first line of that day.
  const first = view && since(view.lines), days = useMemo(() => view?.lines.map(line => day(new Date(line.from))) ?? [], [view]);
  return (
    <section aria-label="Memory view" onKeyDown={keyed} className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto w-full max-w-(--chat-content-max-width) shrink-0 border-border/60 border-b px-4.5 pt-3 pb-3 sm:px-6.5">
        <div className="flex items-center gap-3">
          <h2 className="shrink-0 font-medium text-sm">Memory view</h2>
          <label className="ms-auto flex h-7 w-64 min-w-0 items-center gap-1.5 rounded-[var(--control-radius)] border border-input bg-background px-2 text-muted-foreground shadow-xs/5 focus-within:text-foreground focus-within:ring-2 focus-within:ring-ring dark:bg-input/32">
            <SearchIcon className="size-3.5 shrink-0" />
            <input ref={box} type="search" aria-label="Search the memory" title={`Search the messages (${label('mod+f')})`} placeholder="Search messages" value={search?.text ?? ''} spellCheck={false} autoCapitalize="off" autoCorrect="off"
              onChange={event => void app.search(profile, event.target.value)}
              onKeyDown={event => { if (event.key === 'ArrowDown' && results) { event.preventDefault(); event.currentTarget.closest('section')?.querySelector<HTMLElement>('[data-line]')?.focus(); } }}
              className="min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden" />
            {search && <Button variant="ghost-muted" size="icon-xs" className="-me-1.5 size-5" aria-label="Clear the search" onClick={end}><XIcon className="size-3" /></Button>}
          </label>
        </div>
        {search ? (
          <p className="mt-0.5 flex min-h-5 items-center text-muted-foreground text-xs leading-relaxed">
            {!answer ? 'Searching…' : found !== undefined
              ? <Button variant="ghost-muted" size="xs" className="-ms-2" onClick={() => { void app.find(profile); box.current?.focus(); }}><ArrowLeftIcon />Back to the {matches} found</Button>
              : count ? `${matches} ${count === 1 ? 'contains' : 'contain'} “${answer.of}”, newest first. Open one to see it where it is in the tree.` : `No message contains “${answer.of}”.`}
          </p>
        ) : <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
          {!view ? 'Reading the memory…' : !first ? 'No messages yet.'
            : `${view.total.toLocaleString()} messages since ${day(new Date(first))}. The agent reads them as ${view.lines.length.toLocaleString()} lines, ${kilobytes(view.size)} of ${kilobytes(view.budget)} kB.`}
          {first && ' Older messages are folded into summaries: open a line to see the two it was made from, down to the message itself. This is read from the profile\'s files, so it can trail the running chat.'}
        </p>}
      </header>
      {/* The tree stays where it is under what a search found, so that it is as it was when the search ends. */}
      {results && answer && <Results answer={answer} profile={profile} />}
      <div ref={scroller} hidden={results} onKeyDown={keys} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 sm:px-5">
        <div className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) pt-2 pb-6">
          {view?.lines.map((line, at) => (
            <div key={line.id}>
              {days[at] !== days[at - 1] && <h3 className="px-1.5 pt-5 pb-1.5 font-medium text-2xs text-muted-foreground uppercase tracking-wider">{days[at]}</h3>}
              <TreeLine tree={tree} line={line} profile={profile} heading={days[at]} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});
