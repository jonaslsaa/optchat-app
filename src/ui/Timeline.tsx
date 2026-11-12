import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HandoffRow, NoteRow, ReplyRow, ReportRow, UserRow, Waiting, type Working } from './Rows.tsx';
import { parts, thinking, type Item, type Live, type Part } from './transcript.ts';
import { Button, cn } from './ui.tsx';

/** How near the end counts as at the end, in pixels. */
const EDGE = 48;

/** The chat, oldest at the top. It stays at the end while you are there, and stays where you are while you read back; older
 * pages of the log are read as you reach the top. `running` says the agent is in a run, and `live` what it is doing in it.
 * `onAgent` opens the agent a report is from; `narrow` is for a chat in a panel, which has no room for wide margins. */
export function Timeline({ items, live, running, profile, older, loading, onAgent, narrow = false }: { items: Item[]; live: Live; running: boolean; profile: string; older?: () => void; loading?: boolean; onAgent?: (agent: string) => void; narrow?: boolean }) {
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
        <div ref={content} className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) pt-6 pb-10">
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
          {running && last && last.type !== 'reply' && last.type !== 'handoff' && <Waiting from={last.items[0].date} activity={live.activity} />}
        </div>
      </div>
      {away && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center py-1.5">
          <Button size="xs" variant="glass" className="pointer-events-auto" onClick={toEnd}><ChevronDownIcon className="size-3.5" />Scroll to end</Button>
        </div>
      )}
    </div>
  );
}
