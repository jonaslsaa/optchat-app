import { ArrowLeftIcon, ChevronRightIcon, ClipboardCheckIcon, ClockIcon, CornerDownRightIcon, HistoryIcon, MessageSquareIcon, SearchIcon, SparkleIcon, StickyNoteIcon, UserIcon, WrenchIcon, XIcon, type LucideIcon } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Hit, Line, Message, WindowState } from '../protocol.ts';
import { CiteButton, CiteSelection, type CiteAnchor } from './Cite.tsx';
import { whole, type Cite, type Place } from './cite.ts';
import { escapes, label } from './keys.ts';
import { called, isOpen, key, leaf, listed, polled, printed, reports, since, size, tagged, WHO, type Kind, type Search, type Tree } from './memory.ts';
import { ReportRow } from './Reports.tsx';
import { NoteRow, ReplyRow, StepRow, toolIcon, UserRow } from './Rows.tsx';
import { app } from './store.ts';
import { logged, parts } from './transcript.ts';
import { Button, cn, Spinner } from './ui.tsx';

/** The memory view: the lines the agent reads its memory as, each opening into the two it was made from, down to the message
 * itself. It is the main chat at another distance, so it stands where the chat does. Its search finds messages as the agent's
 * own does, and a message that was found opens in the tree, where it is. It only reads: the server reads the profile's files
 * (`view`, `zoom`, `original`, `search`), and nothing here changes a memory. What it shows can be cited in the message under
 * it (`onCite`): a line or a message whole, by the button on it, or the words that are selected in one. */

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
  const drawn = useMemo(() => parts(logged(messages)), [messages]), show = useCallback((at: Place) => void app.find(profile, at.id, at.n), [profile]);
  return drawn.map(part => part.type === 'user' ? <UserRow key={part.key} part={part} profile={profile} onPlace={show} />
    : part.type === 'work' ? <ReportRow key={part.key} part={part} />
    : part.type === 'note' ? <NoteRow key={part.key} part={part} />
    : part.type !== 'reply' ? null
    : part.answer ? <ReplyRow key={part.key} part={part} latest profile={profile} />
    : <div key={part.key} className="flex min-w-0 flex-col py-1">{part.steps.map(step => <StepRow key={step.key} step={step} profile={profile} />)}</div>);
});
/** The button on a line or on a message that was found, which cites it whole. It is there under the pointer and with the keys. */
function CiteWhole({ onCite, className = 'end-1 top-1' }: { onCite: (anchor: CiteAnchor) => void; className?: string }) {
  return (
    <span className={cn('absolute opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100', className)}>
      <CiteButton label="Cite this line" onCite={onCite} />
    </span>
  );
}
/** Who said a message, as the gutter shows it; a tool call has its tool's own icon, as in the chat. */
const ICON: Record<Kind, LucideIcon> = { user: UserIcon, talk: SparkleIcon, tool: WrenchIcon, echo: CornerDownRightIcon, work: ClipboardCheckIcon, note: StickyNoteIcon };
/** Words with what is in backticks as code and what is between `**` bold, as the chat shows them. */
const Coded = ({ text }: { text: string }) => text.split(/`([^`\n]+)`|\*\*([^*\n]+)\*\*/).map((piece, at) => piece === undefined ? null
  : at % 3 === 1 ? <code key={at} className="rounded bg-foreground/8 px-[0.3em] py-px font-mono text-[0.86em]">{piece}</code>
  : at % 3 === 2 ? <strong key={at} className="font-semibold">{piece}</strong> : piece);
/** A kind a summary tags its words with, as a small icon in them. It is not selected with them, so what is cited is words. */
const Tag = ({ kind }: { kind: Kind }) => {
  const Icon = ICON[kind];
  return <span role="img" aria-label={WHO[kind]} title={WHO[kind]} className={cn('me-[3px] inline-flex select-none align-[-2px]', kind === 'user' ? 'text-primary' : 'text-muted-foreground/70')}><Icon className="size-[13px]" /></span>;
};
/** A message as its line says it: the icon and the name of who said it, and its words, cut at two lines but for yours. */
function message(kind: Kind | undefined, text: string): { Icon: LucideIcon; label?: string; className: string; words: ReactNode } {
  if (kind === 'tool') {
    const { name, verb, folder, subject } = called(text);
    return { Icon: toolIcon(name), label: WHO.tool, className: 'line-clamp-2 text-muted-foreground', words: verb === undefined ? <Coded text={text} />
      : <><span className="text-foreground/85">{verb}</span> {folder && <span className="select-none">{folder} › </span>}<span className={cn(name === 'bash' && 'font-mono text-[0.9em]')}>{subject}</span></> };
  }
  if (kind === 'echo') {
    const { name, text: output } = printed(text);
    return { Icon: ICON.echo, label: name ? `Result of ${name}` : WHO.echo, className: 'line-clamp-2 text-[13px] text-muted-foreground', words: <Coded text={output} /> };
  }
  // Each report by its title and agent, and the words between them not selected with the agent.
  if (kind === 'work') return { Icon: ICON.work, label: WHO.work, className: 'line-clamp-2', words: reports(text).map(({ agent, title, running, text: body }, at) => <Fragment key={at}>
    {at > 0 && ' '}{title && <span className="font-medium">{title}</span>}{agent && <span className="select-none text-muted-foreground">{title && ' · '}{agent}{running && ' · still running'}</span>}{agent && ' '}<Coded text={body} /></Fragment>) };
  return { Icon: kind ? ICON[kind] : MessageSquareIcon, label: kind && WHO[kind], className: kind === 'user' ? 'whitespace-pre-wrap font-medium' : 'line-clamp-2', words: <Coded text={text} /> };
}
/** What a line says, and in front of it who said it, or how many messages it holds. What a summary or a message says is shown
 * without pi-optchat's tags (`user:`), which are its icons: the words left can be selected and cited as they are. */
function said(line: Line): { kind?: Kind; label?: string; gutter: ReactNode; text: ReactNode } {
  const words = 'block text-sm leading-relaxed [overflow-wrap:anywhere]';
  if (line.text === undefined) return { gutter: <ClockIcon className="size-3.5" />, text: <span className="block select-none text-muted-foreground text-sm italic">Not summarized yet.</span> };
  if (line.n > 1) return {
    gutter: <span title={`${line.n.toLocaleString()} messages`} className="mt-0.5 h-4.5 min-w-6.5 rounded-[5px] border border-border bg-accent px-1 text-center font-semibold text-[10.5px] text-muted-foreground tabular-nums leading-4 dark:bg-white/5">{size(line.n)}</span>,
    text: <span data-cite={key(line)} className={cn(words, 'whitespace-pre-wrap')}>{tagged(line.text).map((piece, at) => 'kind' in piece ? <Tag key={at} kind={piece.kind} /> : <Coded key={at} text={piece.text} />)}</span>,
  };
  const { kind, text } = leaf(line), { Icon, label, className, words: shown } = message(kind, text);
  return { kind, label, gutter: <Icon className="size-3.5" />, text: <span data-cite={key(line)} className={cn(words, className)}>{shown}</span> };
}
/** One line, and under it what it opens into. Its words can be selected, so it is no `button`, and is one to the keys. Who
 * said a message, or how many a summary holds, is in the gutter; when, and of a message its number, at the end, where the
 * button that cites it takes its place under the pointer: its room is kept, so the words do not move. */
function TreeLine({ tree, line, profile, heading, onCite }: { tree: Tree; line: Line; profile: string; heading: string; onCite?: (cite: Cite, anchor?: CiteAnchor) => void }) {
  const open = isOpen(tree, line), halves = tree.under[key(line)], original = tree.originals[line.id], found = tree.found === key(line);
  // What a line you just opened holds is brought into sight, once it is there: at the end of the view it is under the fold.
  // The line itself stays in sight, where what it holds is taller than the page.
  const under = useRef<HTMLDivElement>(null), asked = useRef(false), there = open && (line.n === 1 ? original : halves) !== undefined;
  useEffect(() => {
    if (there && asked.current) for (const shown of [under.current, under.current?.previousElementSibling]) shown?.scrollIntoView({ block: 'nearest' });
    if (there || !open) asked.current = false;
  }, [there, open]);
  const { kind, label, gutter, text } = said(line), imported = line.n === 1 ? leaf(line).imported : undefined;
  return (
    // A result right after a call is tucked under it.
    <div data-kind={kind} className={cn(kind === 'echo' && '[[data-kind=tool]+&]:-mt-[3px]')}>
      <div className="group relative">
        {/* A press that selected words in the line does not open it (`detail` is how many presses a click is, and none from the keys). */}
        <div role="button" tabIndex={0} data-line data-found={found || undefined} aria-current={found || undefined} aria-expanded={open}
          onClick={event => { if (event.detail && !getSelection()?.isCollapsed) return; asked.current = !open; void app.toggleLine(profile, line); }}
          className={cn(ROW, 'scroll-mt-10 gap-2 py-[5px]', found && 'bg-primary/8 ring-1 ring-primary/40 ring-inset hover:bg-primary/12')}>
          <span role={label ? 'img' : undefined} aria-label={label} title={label} className={cn('flex h-[22px] w-7 shrink-0 select-none items-center justify-center', kind === 'user' ? 'text-primary' : 'text-muted-foreground/70')}>{gutter}</span>
          <span className="min-w-0 flex-1">
            {line.n > 1 && <span className="mb-px block select-none text-[11.5px] text-muted-foreground/70 tabular-nums">{when(line, heading)}</span>}
            {text}
          </span>
          <span className="flex h-[22px] shrink-0 select-none items-center gap-0.5 text-[11.5px] text-muted-foreground/70 tabular-nums group-hover:text-muted-foreground">
            {line.n === 1 && <span className="whitespace-nowrap px-1" title={imported && `Imported history, written ${imported}`}>{imported && 'Imported · '}{when(line, heading)} · {line.id.toLocaleString()}</span>}
            {onCite && <span className="size-6" />}
            <ChevronRightIcon className={cn('mx-0.5 size-3 transition-transform duration-200', open && 'rotate-90')} />
          </span>
        </div>
        {onCite && <CiteWhole className="end-[22px] top-1" onCite={anchor => onCite(whole({ id: line.id, n: line.n }, line.text), anchor)} />}
      </div>
      {open && (
        <div ref={under} className="enter ms-3.5 scroll-mb-3 border-border/70 border-s ps-2">
          {line.n === 1 ? original ? <div className="py-1 ps-1.5"><Original messages={original} profile={profile} /></div> : <Reading />
            : halves ? halves.map(half => <TreeLine key={half.id} tree={tree} line={half} profile={profile} heading={heading} onCite={onCite} />) : <Reading />}
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
  else if (event.key === 'ArrowRight' && !open || event.key === 'ArrowLeft' && open || event.key === 'Enter' || event.key === ' ') at.click();
  else return;
  event.preventDefault();
}
/** A message a search found: who said it and when, and where it says it. It opens in the tree. */
function Found({ hit, profile, onCite }: { hit: Hit; profile: string; onCite?: (cite: Cite, anchor?: CiteAnchor) => void }) {
  const date = new Date(hit.date);
  return (
    <div className="group relative">
      <button type="button" data-line onClick={() => void app.find(profile, hit.id)} className={cn(ROW, onCite && 'pe-8')}>
        <span className="min-w-0 flex-1">
          <span className="block text-muted-foreground text-xs tabular-nums"><span className="font-medium text-foreground">{WHO[hit.kind]}</span> · {day(date)}, {time(date)} · message {hit.id.toLocaleString()}{hit.imported && ' · imported'}</span>
          <span className="line-clamp-2 text-muted-foreground text-sm leading-relaxed [overflow-wrap:anywhere]">{hit.lead}<mark className="bg-transparent font-semibold text-foreground">{hit.match}</mark>{hit.rest}</span>
        </span>
      </button>
      {onCite && <CiteWhole onCite={anchor => onCite(whole({ id: hit.id, n: 1 }, hit.lead + hit.match + hit.rest), anchor)} />}
    </div>
  );
}
/** What a search found, newest first, in the tree's place. */
function Results({ answer, profile, onCite }: { answer: NonNullable<Search['answer']>; profile: string; onCite?: (cite: Cite, anchor?: CiteAnchor) => void }) {
  return (
    <div role="region" aria-label="Messages found" onKeyDown={keys} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 sm:px-5">
      <div className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) pt-2 pb-6">
        {answer.hits.map(hit => <Found key={hit.id} hit={hit} profile={profile} onCite={onCite} />)}
        {answer.more > 0 && <Button variant="ghost-muted" size="xs" className="ms-1.5 mt-2" onClick={() => void app.moreFound(profile)}>Show older ones ({answer.more.toLocaleString()} more)</Button>}
      </div>
    </div>
  );
}
const Reading = () => <p className="flex items-center gap-1.5 px-1.5 py-1.5 text-muted-foreground text-xs"><Spinner className="size-3" />Reading…</p>;

/** It is read again when the main chat changes (`pulse`), and every three seconds while that says too little (`polled`): the
 * server keeps what it read until the files change, so a look costs it a glance at them. */
export const MemoryView = memo(function MemoryView({ tree, profile, window, pulse, box, onCite, onImport }: { tree: Tree; profile: string; window: WindowState; pulse: string; box: RefObject<HTMLInputElement | null>; onCite?: (cite: Cite, anchor?: CiteAnchor) => void; onImport: () => void }) {
  const { view } = tree, scroller = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), shown = useRef(false), active = polled(tree, window);
  // Where the keys were before the view took them, which is the composer.
  const [before] = useState(() => document.activeElement);
  useEffect(() => { void app.readMemory(profile); }, [profile, pulse]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void app.readMemory(profile), EVERY);
    return () => clearInterval(timer);
  }, [profile, active]);
  // It opens at the newest line, as the chat does, and with the keys on it, unless it was opened to search (⇧⌘F, which is the
  // page's: `box` is the search box) and they are there; after that it stays where you are.
  useLayoutEffect(() => {
    if (!view || shown.current || !scroller.current) return;
    shown.current = true;
    scroller.current.scrollTop = scroller.current.scrollHeight;
    if (document.activeElement !== box.current) [...scroller.current.querySelectorAll<HTMLElement>('[data-line]')].at(-1)?.focus({ preventScroll: true });
  }, [view]);
  // They go back there when the chat is shown again.
  useEffect(() => () => { if (before instanceof HTMLElement && before.isConnected) before.focus(); }, [before]);
  // What a message cites is pointed out for as long as the view is shown: the next time, it opens at the newest line again.
  useEffect(() => () => { if (!app.state.memory[profile]?.search) void app.find(profile); }, [profile]);
  // A message that was found is brought to the top of the page, with the keys on its line, once the tree is open down to it.
  const { search, found } = tree, results = listed(tree);
  useLayoutEffect(() => {
    const at = found === undefined ? null : scroller.current?.querySelector<HTMLElement>('[data-found]');
    at?.scrollIntoView({ block: 'start' });
    at?.focus({ preventScroll: true });
  }, [found]);
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
    <section aria-label="Memory view" onKeyDown={keyed} className="enter flex min-h-0 flex-1 flex-col">
      <header className="mx-auto w-full max-w-(--chat-content-max-width) shrink-0 border-border/60 border-b px-4.5 pt-3 pb-3 sm:px-6.5">
        <div className="flex items-center gap-3">
          <h2 className="shrink-0 font-medium text-sm">Memory view</h2>
          {/* What other tools kept comes into this memory from the Import page. */}
          <Button variant="ghost-muted" className="ms-auto" title="Import history from Claude Code, Codex, Pi or ChatGPT into this memory" onClick={onImport}><HistoryIcon />Import…</Button>
          <label className="flex h-7 w-64 min-w-0 items-center gap-1.5 rounded-[var(--control-radius)] border border-input bg-background px-2 text-muted-foreground shadow-xs/5 focus-within:text-foreground focus-within:ring-2 focus-within:ring-ring dark:bg-input/32">
            <SearchIcon className="size-3.5 shrink-0" />
            <input ref={box} type="search" aria-label="Search the memory" title={`Search the messages (${label('mod+shift+f')})`} placeholder="Search messages" value={search?.text ?? ''} spellCheck={false} autoCapitalize="off" autoCorrect="off"
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
      {results && answer && <Results answer={answer} profile={profile} onCite={onCite} />}
      <div ref={scroller} hidden={results} onKeyDown={keys} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 sm:px-5">
        <div ref={content} className="relative mx-auto w-full min-w-0 max-w-(--chat-content-max-width) pt-2 pb-6">
          {view?.lines.map((line, at) => (
            <div key={line.id}>
              {days[at] !== days[at - 1] && <h3 className="px-1.5 pt-5 pb-1.5 font-medium text-2xs text-muted-foreground uppercase tracking-wider">{days[at]}</h3>}
              <TreeLine tree={tree} line={line} profile={profile} heading={days[at]} onCite={onCite} />
            </div>
          ))}
          {/* Every message here is in the log, so what is selected in one is cited with its place. */}
          {onCite && <CiteSelection content={content} logged={Infinity} onCite={onCite} />}
        </div>
      </div>
    </section>
  );
});
