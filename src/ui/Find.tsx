import { ChevronDownIcon, ChevronUpIcon, HistoryIcon, SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { finding, type Found } from './find.ts';
import { escapes, label, matches } from './keys.ts';
import { Button, cn } from './ui.tsx';

/** Find in the chat (⌘F), as a small bar over its top right corner, as T3 Code's is: what you type is marked wherever the chat
 * shows it (`find.ts`), with the match you are at marked stronger and in sight, and how many there are beside the box. Enter
 * goes to the next one and ⇧Enter to the one before; Esc closes the bar, and the keys are back where they were, which is the
 * composer. The chat shows its newest messages only, so under the box is the way on: the same text, searched in all of the
 * memory (`onMemory`). `asked` counts the times find was asked for: asked again, the keys are in the box again. `onMoved`
 * hears that find scrolled the chat. */
export function Find({ asked, content, scroller, onClose, onMemory, onMoved }: { asked: number; content: RefObject<HTMLElement | null>; scroller: RefObject<HTMLElement | null>; onClose: () => void; onMemory: (text: string) => void; onMoved: () => void }) {
  const [text, setText] = useState(''), [found, setFound] = useState<Found>({ at: -1, count: 0 });
  const box = useRef<HTMLInputElement>(null), search = useRef<ReturnType<typeof finding>>(undefined), [before] = useState(() => document.activeElement);
  useEffect(() => { box.current?.focus(); box.current?.select(); }, [asked]);
  useEffect(() => {
    const made = search.current = content.current && scroller.current ? finding(content.current, scroller.current, setFound, onMoved) : undefined;
    return () => made?.end();
  }, []);
  // What had the focus may be in a report's tab that find has hidden since: the tab shown then has it.
  const close = () => {
    onClose();
    if (!(before instanceof HTMLElement) || !before.isConnected) return;
    (before.checkVisibility() ? before : before.closest('[role=tabpanel]')?.parentElement?.querySelector<HTMLElement>('[role=tab][aria-selected=true]'))?.focus();
  };
  const keyed = (event: KeyboardEvent) => {
    // A key that picks or drops what an input method offers is the box's alone: it is no Enter or Esc of the bar's, nor the chat's.
    if (event.nativeEvent.isComposing) return event.stopPropagation();
    escapes(event, close);
    if (event.key === 'Enter' && event.target === box.current) { event.preventDefault(); search.current?.step(event.shiftKey ? -1 : 1); }
    if (text && matches(event, 'mod+shift+f')) { event.preventDefault(); onMemory(text); }
  };
  return (
    <div role="search" aria-label="Find in chat" onKeyDown={keyed} className="enter absolute top-2 right-4 z-30 w-[min(21rem,calc(100%-2rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
      <div className="flex h-9 items-center gap-0.5 ps-2.5 pe-1.5">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input ref={box} type="search" aria-label="Find in chat" placeholder="Find in chat" value={text} maxLength={200} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
          onChange={event => { setText(event.target.value); search.current?.seek(event.target.value); }}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-foreground text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden" />
        {text && <span aria-live="polite" className={cn('min-w-10 px-1 text-center text-xs tabular-nums', found.count ? 'text-muted-foreground' : 'text-destructive-foreground')}>{found.at + 1}/{found.count}</span>}
        <Button variant="ghost-muted" size="icon-xs" aria-label="Previous match" title={`Previous match (${label('shift+enter')})`} disabled={!found.count} onClick={() => search.current?.step(-1)}><ChevronUpIcon /></Button>
        <Button variant="ghost-muted" size="icon-xs" aria-label="Next match" title={`Next match (${label('enter')})`} disabled={!found.count} onClick={() => search.current?.step(1)}><ChevronDownIcon /></Button>
        <Button variant="ghost-muted" size="icon-xs" aria-label="Close find" title="Close (Esc)" onClick={close}><XIcon /></Button>
      </div>
      {text && (
        <button type="button" title="The chat shows its newest messages. The memory has them all." onClick={() => onMemory(text)}
          className="flex w-full items-center gap-1.5 border-t px-2.5 py-1.5 text-start text-muted-foreground text-xs outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground">
          <HistoryIcon className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">Search memory for “{text}”</span><kbd className="shrink-0 font-sans opacity-70">{label('mod+shift+f')}</kbd>
        </button>
      )}
    </div>
  );
}
