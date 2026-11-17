import { BoxIcon, QuoteIcon } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { cite, named, place, type Cite, type Place, type Skill } from './cite.ts';
import { escapes } from './keys.ts';
import { Button, cn } from './ui.tsx';

/** What is selected, when it begins in something that can be cited (`data-cite`, which says where in the memory it is), and
 * where its last line there ends in `content`: that is where the button that cites it stands. What is cited is of the one
 * message it began in (`range`): a selection that runs on into the rows under it, as a paragraph selected with three clicks
 * does, ends for this where that message does, so no words are cited under a place they are not in. */
function selected(content: HTMLElement) {
  const selection = getSelection(), whole = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  const from = whole?.startContainer, source = (from instanceof Element ? from : from?.parentElement)?.closest<HTMLElement>('[data-cite]'), said = source?.getBoundingClientRect();
  if (!whole || !source || !said || !content.contains(source)) return;
  const range = whole.cloneRange();
  if (!source.contains(whole.endContainer)) range.setEnd(source, source.childNodes.length);
  const line = [...range.getClientRects()].findLast(line => line.top >= said.top - 1 && line.bottom <= said.bottom + 1), frame = content.getBoundingClientRect();
  return range.toString().trim() && line ? { range, at: place(source.dataset.cite), left: Math.min(line.right - frame.left, frame.width - 80), top: line.bottom - frame.top } : undefined;
}
/** A "Cite" button by what is selected in `content`, which it stands in: in the chat and in the memory view alike. `logged`
 * is the last message the profile's log has: what is selected in a later one, or in a chat that is not the log, is cited
 * without a place, since the number it is drawn under is not the log's yet. */
export function CiteSelection({ content, logged = -1, onCite }: { content: RefObject<HTMLElement | null>; logged?: number; onCite: (cite: Cite) => void }) {
  // The button is there once a selection is made (the pointer is let go), and gone with the selection.
  const [found, setFound] = useState<ReturnType<typeof selected>>();
  useEffect(() => {
    const made = () => setFound(content.current ? selected(content.current) : undefined), gone = () => { if (getSelection()?.isCollapsed) setFound(undefined); };
    document.addEventListener('pointerup', made); document.addEventListener('selectionchange', gone);
    return () => { document.removeEventListener('pointerup', made); document.removeEventListener('selectionchange', gone); };
  }, [content]);
  if (!found) return null;
  const drop = () => { getSelection()?.removeAllRanges(); setFound(undefined); };
  // The words are the selection's, as the page draws them (a line each for the items of a list), once it is no longer than
  // what is cited: it goes away with the button in any case.
  const words = (range: Range) => { const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); return selection?.toString() ?? ''; };
  return (
    // The press does not take the selection away, and the click that follows it cites it. The selection is dropped before it
    // is cited, never after: citing puts the keys in the message's box, and a selection taken away then takes the box's caret
    // with it, so it looks as if it has no keys. Esc on the button takes both away, and is then not the chat's key.
    <span className="enter enter-grow absolute z-20 mt-1 flex" style={{ left: found.left, top: found.top }}>
      <Button size="xs" variant="glass" onPointerDown={event => event.preventDefault()} onKeyDown={event => escapes(event, drop)}
        onClick={() => { const cited = cite(words(found.range), found.at && found.at.id + found.at.n - 1 <= logged ? found.at : undefined); drop(); onCite(cited); }}>
        <QuoteIcon className="size-3.5" />Cite
      </Button>
    </span>
  );
}
/** What a message cites, as a card in it (T3 Code's `ResponseCard`, MIT, see THIRD_PARTY_NOTICES.md): how it begins, and where
 * in the memory it is. One that has a place opens the memory view there (`onOpen`). */
export function CiteCard({ cite: { text, at }, onOpen }: { cite: Cite; onOpen?: (at: Place) => void }) {
  const card = 'block w-full min-w-0 rounded-lg bg-black/8 px-2.5 py-1.5 text-start text-muted-foreground text-sm dark:bg-white/8', opens = at && onOpen;
  const shown = (
    <>
      {text && <span className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>}
      {at && <span data-no-find className="block text-2xs tabular-nums opacity-80">Memory · {named(at)}</span>}
    </>
  );
  return opens ? <button type="button" data-cited title="Show it in the memory view" onClick={() => onOpen(at)} className={cn(card, 'outline-none hover:bg-black/12 focus-visible:ring-2 focus-visible:ring-ring/70 dark:hover:bg-white/12')}>{shown}</button>
    : <span data-cited className={card}>{shown}</span>;
}
/** The skill a message runs, by its name (T3 Code's skill chip, MIT, see THIRD_PARTY_NOTICES.md). Its file, as Pi sent it, is
 * shut away under the name, which opens it; a message not in Pi's log yet has only the name. In the chat and in the messages
 * waiting under it alike. */
export function SkillChip({ skill: { name, path, body }, className }: { skill: Skill; className?: string }) {
  const [open, setOpen] = useState(false), chip = <><BoxIcon className="size-3.5 shrink-0" /><span className="min-w-0 truncate">{name}</span></>;
  const look = 'flex max-w-full items-center gap-1 rounded-sm font-medium text-sm leading-relaxed';
  return (
    <span className={cn('block', className)}>
      {body ? <button type="button" data-skill aria-expanded={open} title={path} onClick={() => setOpen(!open)} className={cn(look, 'cursor-pointer outline-none hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/70')}>{chip}</button>
        : <span className={look}>{chip}</span>}
      {open && <span className="mt-1 block whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed [overflow-wrap:anywhere]">{body}</span>}
    </span>
  );
}
