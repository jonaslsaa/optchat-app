import { ChevronDownIcon, QuoteIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Doing, HandoffRow, NoteRow, ReplyRow, ReportRow, UserRow, type Working } from './Rows.tsx';
import { parts, thinking, type Item, type Live, type Part } from './transcript.ts';
import { escapes } from './keys.ts';
import { Button, cn } from './ui.tsx';

/** How near the end counts as at the end, in pixels. */
const EDGE = 48;
/** What is selected, when it begins in a reply's answer or in a report (`data-quote`), and where its last line there ends in
 * `content`: that is where the button that quotes it stands. A paragraph selected with three clicks ends at the start of what
 * is under it, so where a selection ends is not asked, and the lines it has outside the answer or the report do not count. */
function selected(content: HTMLElement) {
  const selection = getSelection(), text = selection?.toString().trim(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  const from = range?.startContainer, said = (from instanceof Element ? from : from?.parentElement)?.closest('[data-quote]')?.getBoundingClientRect();
  if (!range || !text || !said || !content.contains(from ?? null)) return;
  const line = [...range.getClientRects()].findLast(line => line.top >= said.top - 1 && line.bottom <= said.bottom + 1), frame = content.getBoundingClientRect();
  return line && { text, left: Math.min(line.right - frame.left, frame.width - 80), top: line.bottom - frame.top };
}

/** The chat, oldest at the top. It stays at the end while you are there, and stays where you are while you read back; older
 * pages of the log are read as you reach the top. `running` says the agent is in a run, and `live` what it is doing in it.
 * `onAgent` opens the agent a report is from; `narrow` is for a chat in a panel, which has no room for wide margins. Where
 * there is a composer to quote into (`onQuote`), a "Quote" button stands by what is selected in a reply or a report. */
export function Timeline({ items, live, running, starting = false, profile, older, loading, onAgent, onQuote, narrow = false }: { items: Item[]; live: Live; running: boolean; starting?: boolean; profile: string; older?: () => void; loading?: boolean; onAgent?: (agent: string) => void; onQuote?: (said: string) => void; narrow?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true), before = useRef({ first: items[0]?.key, height: 0, top: 0, sent: -1 });
  const [away, setAway] = useState(false);
  // The parts drawn last time are kept where their items did not change, so their rows are not drawn again.
  const drawn = useRef<Part[]>([]);
  const blocks = useMemo(() => drawn.current = parts(items, drawn.current), [items]);
  // A handoff is said to the main chat: the latest thing said to you is what is above it.
  const last = blocks.at(-1), latest = last?.type === 'handoff' ? blocks.at(-2) : last;
  const working = useMemo((): Working => ({ thinking: thinking(live), activity: live.activity, tools: live.tools }), [live]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // A message of yours went in at the end: you are shown it, wherever you were reading.
    const sent = last?.type === 'user' ? last.key : before.current.sent;
    if (sent !== before.current.sent) { atEnd.current = true; setAway(false); }
    // An older page went in above: stay on the message you were reading.
    if (before.current.first !== items[0]?.key && !atEnd.current) element.scrollTop += element.scrollHeight - before.current.height;
    else if (atEnd.current) element.scrollTop = element.scrollHeight;
    before.current = { first: items[0]?.key, height: element.scrollHeight, top: element.scrollTop, sent };
  });
  // What is already there can grow too: an image loads, a tool call is opened.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const element = scroller.current;
      if (!atEnd.current || !element) return;
      element.scrollTop = element.scrollHeight;
      before.current.top = element.scrollTop;
    });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  // The button is there once a selection is made (the pointer is let go), and gone with the selection.
  const [quote, setQuote] = useState<ReturnType<typeof selected>>();
  useEffect(() => {
    const made = () => setQuote(content.current ? selected(content.current) : undefined), gone = () => { if (getSelection()?.isCollapsed) setQuote(undefined); };
    document.addEventListener('pointerup', made); document.addEventListener('selectionchange', gone);
    return () => { document.removeEventListener('pointerup', made); document.removeEventListener('selectionchange', gone); };
  }, []);
  const scrolled = () => {
    const element = scroller.current!, near = element.scrollHeight - element.scrollTop - element.clientHeight <= EDGE;
    // Only you moving up takes the chat off its end: the chat growing under it leaves it short of the end for a moment too.
    if (near || element.scrollTop < before.current.top) atEnd.current = near;
    before.current.top = element.scrollTop;
    setAway(!atEnd.current);
    if (element.scrollTop < 200 && !loading) older?.();
  };
  const toEnd = () => { atEnd.current = true; setAway(false); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={scrolled} tabIndex={-1} className={cn('h-full overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%-2.5rem),transparent)] [overflow-anchor:none] focus:outline-none', narrow ? 'px-4' : 'sm:px-12')}>
        {/* The chat fades out under the header and above the composer (as T3 Code's does under its top bar), so no line is cut
            through; the room under the last line lets it be read clear of the fade. */}
        <div ref={content} className="relative mx-auto w-full min-w-0 max-w-(--chat-content-max-width) pt-6 pb-10">
          {older && (
            <button type="button" disabled={loading} onClick={older} className="mb-4 flex w-full items-center gap-3 py-1.5 text-muted-foreground text-xs hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default">
              <span className="h-px flex-1 bg-border/70" />{loading ? 'Loading earlier messages…' : 'Load earlier messages'}<span className="h-px flex-1 bg-border/70" />
            </button>
          )}
          {blocks.map(part => part.type === 'user' ? <UserRow key={part.key} part={part} profile={profile} />
            : part.type === 'work' ? <ReportRow key={part.key} part={part} onAgent={onAgent} />
            : part.type === 'note' ? <NoteRow key={part.key} part={part} />
            : part.type === 'handoff' ? <HandoffRow key={part.key} part={part} writing={running && part === last} />
            : <ReplyRow key={part.key} part={part} working={running && part === last ? working : undefined} latest={part === latest} />)}
          {/* What the agent is doing: under your message until it says something, and then under its reply, as one line. Your
              message is in the chat before Pi has it (`live.sent`), and the agent is at work on it from then: its Pi may still be
              starting. */}
          {(running || live.sent) && last && last.type !== 'handoff' && <div className="pb-4"><Doing from={last.type === 'reply' ? last.from : last.items[0].date} activity={live.activity ?? (starting ? 'Starting Pi' : undefined)} thinking={working.thinking} /></div>}
          {quote && onQuote && (
            // The press does not take the selection away, and the click that follows it quotes it. Esc on the button takes
            // both away, and is then not the chat's key.
            <span className="enter enter-grow absolute z-20 mt-1 flex" style={{ left: quote.left, top: quote.top }}>
              <Button size="xs" variant="glass" onPointerDown={event => event.preventDefault()}
                onClick={() => { onQuote(quote.text); getSelection()?.removeAllRanges(); setQuote(undefined); }}
                onKeyDown={event => escapes(event, () => { getSelection()?.removeAllRanges(); setQuote(undefined); })}>
                <QuoteIcon className="size-3.5" />Quote
              </Button>
            </span>
          )}
        </div>
      </div>
      {away && (
        <div className="enter enter-from-below pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center py-1.5">
          <Button size="xs" variant="glass" className="pointer-events-auto" onClick={toEnd}><ChevronDownIcon className="size-3.5" />Scroll to end</Button>
        </div>
      )}
    </div>
  );
}
