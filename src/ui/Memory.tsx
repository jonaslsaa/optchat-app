import { ChevronRightIcon } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Line, Message, WindowState } from '../protocol.ts';
import { isOpen, key, polled, since, type Tree } from './memory.ts';
import { NoteRow, ReplyRow, ReportRow, StepRow, UserRow } from './Rows.tsx';
import { app } from './store.ts';
import { logged, parts } from './transcript.ts';
import { cn, Spinner } from './ui.tsx';

/** The memory view: the lines the agent reads its memory as, each opening into the two it was made from, down to the message
 * itself. It is the main chat at another distance, so it stands where the chat does. It only reads: the server reads the
 * profile's files (`view`, `zoom`, `original`), and nothing here changes a memory. */

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
  const open = isOpen(tree, line), halves = tree.under[key(line)], original = tree.originals[line.id];
  // What a line you just opened holds is brought into sight, once it is there: at the end of the view it is under the fold.
  // The line itself stays in sight, where what it holds is taller than the page.
  const under = useRef<HTMLDivElement>(null), asked = useRef(false), there = open && (line.n === 1 ? original : halves) !== undefined;
  useEffect(() => {
    if (there && asked.current) for (const shown of [under.current, under.current?.previousElementSibling]) shown?.scrollIntoView({ block: 'nearest' });
    if (there || !open) asked.current = false;
  }, [there, open]);
  return (
    <div>
      <button type="button" data-line aria-expanded={open} onClick={() => { asked.current = !open; void app.toggleLine(profile, line); }}
        className="flex w-full scroll-mt-10 items-start gap-1.5 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset">
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
  // The arrows walk the lines that are in sight, and open and close the one you are on.
  const keys = (event: KeyboardEvent) => {
    const at = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-line]') : null;
    if (!at || event.metaKey || event.ctrlKey || event.altKey) return;
    const lines = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-line]')], open = at.getAttribute('aria-expanded') === 'true';
    const to = event.key === 'ArrowDown' ? lines[lines.indexOf(at) + 1] : event.key === 'ArrowUp' ? lines[lines.indexOf(at) - 1] : undefined;
    if (to) to.focus();
    else if (event.key === 'ArrowRight' && !open || event.key === 'ArrowLeft' && open) at.click();
    else return;
    event.preventDefault();
  };
  // Each line stands under the day its first message was said, which is written once, over the first line of that day.
  const first = view && since(view.lines), days = useMemo(() => view?.lines.map(line => day(new Date(line.from))) ?? [], [view]);
  return (
    <section aria-label="Memory view" className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto w-full max-w-(--chat-content-max-width) shrink-0 border-border/60 border-b px-4.5 pt-3 pb-3 sm:px-6.5">
        <h2 className="font-medium text-sm">Memory view</h2>
        <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
          {!view ? 'Reading the memory…' : !first ? 'No messages yet.'
            : `${view.total.toLocaleString()} messages since ${day(new Date(first))}. The agent reads them as ${view.lines.length.toLocaleString()} lines, ${kilobytes(view.size)} of ${kilobytes(view.budget)} kB.`}
          {first && ' Older messages are folded into summaries: open a line to see the two it was made from, down to the message itself. This is read from the profile\'s files, so it can trail the running chat.'}
        </p>
      </header>
      <div ref={scroller} onKeyDown={keys} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 sm:px-5">
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
