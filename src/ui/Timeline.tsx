import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NoteRow, ReplyRow, ReportRow, UserRow, Waiting } from './Rows.tsx';
import { parts, thinking, type Item, type Live } from './transcript.ts';
import { Button } from './ui.tsx';

/** How near the end counts as at the end, in pixels. */
const EDGE = 48;

/** The chat, oldest at the top. It stays at the end while you are there, and stays where you are while you read back; older
 * pages of the log are read as you reach the top. */
export function Timeline({ items, live, profile, older, loading, empty }: { items: Item[]; live: Live; profile: string; older?: () => void; loading?: boolean; empty: string }) {
  const scroller = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true), before = useRef({ first: items[0]?.key, height: 0 });
  const [away, setAway] = useState(false);
  const blocks = useMemo(() => parts(items), [items]);
  const last = blocks.at(-1);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // An older page went in above: stay on the message you were reading.
    if (before.current.first !== items[0]?.key && !atEnd.current) element.scrollTop += element.scrollHeight - before.current.height;
    else if (atEnd.current) element.scrollTop = element.scrollHeight;
    before.current = { first: items[0]?.key, height: element.scrollHeight };
  });
  // What is already there can grow too: an image loads, a tool call is opened.
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (atEnd.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const scrolled = () => {
    const element = scroller.current!;
    atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight <= EDGE;
    setAway(!atEnd.current);
    if (element.scrollTop < 200 && !loading) older?.();
  };
  const toEnd = () => { atEnd.current = true; setAway(false); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={scrolled} tabIndex={-1} className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 [overflow-anchor:none] focus:outline-none sm:px-12">
        <div ref={content} className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) pt-6 pb-4">
          {older && (
            <button type="button" disabled={loading} onClick={older} className="mb-4 flex w-full items-center gap-3 py-1.5 text-muted-foreground text-xs hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default">
              <span className="h-px flex-1 bg-border/70" />{loading ? 'Loading earlier messages…' : 'Load earlier messages'}<span className="h-px flex-1 bg-border/70" />
            </button>
          )}
          {blocks.length === 0 && <p className="pt-[20vh] text-center text-muted-foreground text-sm">{empty}</p>}
          {blocks.map((part, index) => {
            if (part.type !== 'reply') {
              const { item } = part;
              return part.type === 'user' ? <UserRow key={item.key} item={item} profile={profile} /> : part.type === 'work' ? <ReportRow key={item.key} item={item} /> : <NoteRow key={item.key} item={item} />;
            }
            const working = live.running && index === blocks.length - 1;
            return <ReplyRow key={part.key} part={part} working={working} thinking={working ? thinking(live) : undefined} activity={working ? live.activity : undefined} tools={live.tools} />;
          })}
          {live.running && last && last.type !== 'reply' && <Waiting from={last.item.date} activity={live.activity} />}
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
