import { BoxIcon, ChevronDownIcon, HistoryIcon, QuoteIcon } from 'lucide-react';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { cite, COMMENT_CAP, named, place, placed, type Cite, type Place, type Skill } from './cite.ts';
import { escapes, label } from './keys.ts';
import { Button, cn, Kbd } from './ui.tsx';

/** Where a citation came from on screen, in viewport coordinates, so its comment popover opens right there; and for one cited
 * from a selection, the words it was (`range`), which stay marked while it is in the message (`useMarks`). */
export interface CiteAnchor { left: number; right: number; top: number; bottom: number; range?: Range }
export const anchorOf = (element: Element): CiteAnchor => {
  const { left, right, top, bottom } = element.getBoundingClientRect();
  return { left, right, top, bottom };
};

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
export function CiteSelection({ content, logged = -1, onCite }: { content: RefObject<HTMLElement | null>; logged?: number; onCite: (cite: Cite, anchor?: CiteAnchor) => void }) {
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
    // is cited, never after: citing puts the keys in the comment box (or composer), and a selection taken away then takes the
    // box's caret with it, so it looks as if it has no keys. Esc on the button takes both away, and is then not the chat's key.
    <span className="enter enter-grow absolute z-20 mt-1 flex" style={{ left: found.left, top: found.top }}>
      <Button size="xs" variant="glass" onPointerDown={event => event.preventDefault()} onKeyDown={event => escapes(event, drop)}
        onClick={event => { const where = { ...anchorOf(event.currentTarget), range: found.range }, cited = cite(words(found.range), found.at && found.at.id + found.at.n - 1 <= logged ? found.at : undefined); drop(); onCite(cited, where); }}>
        <QuoteIcon className="size-3.5" />Cite
      </Button>
    </span>
  );
}

/** Whether a point on screen is on the words of `range`, as they are drawn. Words that went from the page (the memory view
 * took the chat's place) leave their range collapsed, and on nothing. */
const on = (range: Range | undefined, x: number, y: number) =>
  !!range && !range.collapsed && [...range.getClientRects()].some(line => x >= line.left && x <= line.right && y >= line.top && y <= line.bottom);
/** What a click on marked words leaves to the page: a link, a button or a field in them. */
const PRESSED = 'a, button, input, textarea, select, summary, label';
/** The words a message cites stay marked where they were selected (`ranges`, one or none for each of its citations) for as
 * long as it cites them, with the browser's own highlights. A click on them opens that citation's comment there (`onOpen`),
 * and the pointer over them says it can: a click that ends a selection, or one on a link or a button in them, is theirs. */
export function useMarks(ranges: readonly (Range | undefined)[], onOpen: (index: number, anchor: CiteAnchor) => void) {
  const latest = useRef({ ranges, onOpen });
  latest.current = { ranges, onOpen };
  useEffect(() => {
    const marked = ranges.filter(range => range !== undefined);
    if (!marked.length || typeof Highlight === 'undefined') return;
    CSS.highlights.set('cited', new Highlight(...marked));
    return () => { CSS.highlights.delete('cited'); };
  }, [ranges]);
  useEffect(() => {
    const at = ({ target, clientX, clientY }: MouseEvent) => target instanceof Node && !(target instanceof Element && target.closest(PRESSED))
      ? latest.current.ranges.findIndex(range => on(range, clientX, clientY) && range?.intersectsNode(target)) : -1;
    // On capture, so the click is the words' alone: in the memory view they are in a line, which it would open.
    const clicked = (event: MouseEvent) => {
      if (event.button || event.detail !== 1 || !getSelection()?.isCollapsed) return;
      const index = at(event), range = latest.current.ranges[index], line = range && [...range.getClientRects()].at(-1);
      if (!range || !line) return;
      event.stopPropagation();
      latest.current.onOpen(index, { left: line.left, right: line.right, top: line.top, bottom: line.bottom, range });
    };
    const moved = (event: PointerEvent) => document.documentElement.toggleAttribute('data-on-cite', !event.buttons && at(event) >= 0);
    addEventListener('click', clicked, true);
    addEventListener('pointermove', moved, { passive: true });
    return () => {
      removeEventListener('click', clicked, true);
      removeEventListener('pointermove', moved);
      document.documentElement.removeAttribute('data-on-cite');
    };
  }, []);
}

const KEY = 'h-4 min-w-4 text-2xs';
/** Where the comment popover sits on screen: under `anchor` (or over it if `above`, or when there is no room below), aligned to
 * its right edge and clamped inside the viewport with a small margin. */
function placePopover(anchor: CiteAnchor, width: number, height: number, above: boolean) {
  const gap = 6, edge = 12, maxLeft = Math.max(edge, innerWidth - width - edge);
  const left = Math.min(Math.max(anchor.right - width, edge), maxLeft);
  const below = anchor.bottom + gap, over = anchor.top - height - gap;
  const fitsBelow = below + height <= innerHeight - edge, fitsAbove = over >= edge;
  const top = above ? (fitsAbove ? over : fitsBelow ? below : Math.max(edge, over))
    : (fitsBelow ? below : fitsAbove ? over : Math.max(edge, Math.min(below, innerHeight - height - edge)));
  return { left, top };
}
/** Floating comment editor for a citation (T3 Code's `AssistantCitationCommentEditor` and `assistantCitationCommentDismissal`,
 * MIT, see THIRD_PARTY_NOTICES.md). Opens right where the Cite button or chip was: Enter saves, ⌘/Ctrl+Enter saves and sends,
 * Shift+Enter adds a line, Esc cancels (and removes a fresh citation), and clicking outside commits any edited comment. */
export function CiteCommentPopover({ item, anchor, above = false, showQuote = false, fresh = false, opener, canSend = true, onSave, onSaveAndSend, onCancel, ref }: { item: Cite; anchor: CiteAnchor; above?: boolean; showQuote?: boolean; fresh?: boolean; opener?: Element | null; canSend?: boolean; onSave: (comment: string, focus: boolean) => void; onSaveAndSend: (comment: string) => void; onCancel: () => void; ref?: Ref<{ commit: () => boolean; draft: () => string | undefined; focus: () => void }> }) {
  const [comment, setComment] = useState(item.comment ?? '');
  const box = useRef<HTMLDivElement>(null), area = useRef<HTMLTextAreaElement>(null), draft = useRef(comment), [pos, setPos] = useState(() => placePopover(anchor, 320, 148, above));
  draft.current = comment;
  const tooLong = comment.trim().length > COMMENT_CAP;

  // Focus the textarea at the end of any existing comment when opened.
  useLayoutEffect(() => {
    const input = area.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollTop = input.scrollHeight;
  }, [anchor, above]);

  // Re-clamp when the popover grows (multiline input, length warning) or the window resizes, without disturbing focus/caret.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setPos(placePopover(anchor, element.offsetWidth, element.offsetHeight, above));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    addEventListener('resize', measure);
    return () => { observer.disconnect(); removeEventListener('resize', measure); };
  }, [anchor, above]);

  // Clicking outside, tabbing out, or wheel-scrolling outside commits any edited comment (without stealing focus), unless over
  // the cap: a press on the marked words it is about leaves it open. Esc is heard on capture so the chat's run is not stopped
  // while this popover is open, except when a modal dialog or inline rename sits over it (as `useOverlay` guards).
  const settled = useRef(false), actions = useRef({ onSave, onCancel, opener, anchor });
  actions.current = { onSave, onCancel, opener, anchor };
  const commit = (focus: boolean) => {
    if (settled.current) return true;
    if (draft.current.trim().length > COMMENT_CAP) return false;
    settled.current = true;
    actions.current.onSave(draft.current, focus);
    return true;
  };
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    actions.current.onCancel();
  };
  useImperativeHandle(ref, () => ({
    commit: () => commit(false),
    focus: () => area.current?.focus(),
    draft: () => {
      if (settled.current || draft.current.trim().length > COMMENT_CAP) return undefined;
      settled.current = true;
      return draft.current;
    },
  }));
  useEffect(() => {
    const outside = (target: EventTarget | null) => !(target instanceof Node && box.current?.contains(target));
    const away = (event: PointerEvent) => {
      if (!outside(event.target)) return;
      if (event.target instanceof Node && actions.current.opener?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[data-cite-action]')) return;
      if (on(actions.current.anchor.range, event.clientX, event.clientY)) return;
      commit(false);
    };
    const wheeled = (event: WheelEvent) => { if (outside(event.target)) commit(false); };
    const pressed = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.target instanceof Element && event.target.closest('[data-renaming]')) return;
      if (document.querySelector('dialog:modal') && !box.current?.closest('dialog:modal')) return;
      escapes(event, cancel);
    };
    addEventListener('pointerdown', away, true);
    addEventListener('wheel', wheeled, { capture: true, passive: true });
    addEventListener('keydown', pressed, true);
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('wheel', wheeled, true);
      removeEventListener('keydown', pressed, true);
    };
  }, []);

  const submit = () => commit(true);
  const submitAndSend = () => {
    if (settled.current || tooLong || !canSend) return;
    settled.current = true;
    onSaveAndSend(comment);
  };
  const quote = item.text || (item.at ? `Memory · ${named(item.at)}` : '');

  // A fresh citation's words are right where the popover points, highlighted: only one edited from its chip shows them again,
  // since the reply they came from may have scrolled away.
  return createPortal(
    <div ref={box} role="dialog" aria-label="Comment on citation" style={{ left: pos.left, top: pos.top }}
      onPointerDown={event => event.stopPropagation()}
      onBlur={event => {
        const next = event.relatedTarget;
        if (!next || (next instanceof Node && (box.current?.contains(next) || actions.current.opener?.contains(next)))) return;
        if (next instanceof Element && next.closest('[data-cite-action]')) return;
        commit(false);
      }}
      className="enter enter-grow fixed z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-[15px] border bg-popover text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
      {showQuote && quote && (
        <p className="mx-3 mt-3 line-clamp-2 whitespace-pre-wrap border-primary border-s-2 ps-2.5 text-[0.78rem] text-muted-foreground leading-snug [overflow-wrap:anywhere]">{quote}</p>
      )}
      <textarea
        ref={area} rows={2} value={comment} placeholder="Add an optional comment…"
        aria-label="Comment on cited text"
        aria-invalid={tooLong || undefined}
        onChange={event => setComment(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) submitAndSend(); else submit();
          }
        }}
        className={cn('field-sizing-content block max-h-40 min-h-[3.1em] w-full resize-none overflow-y-auto bg-transparent px-3 pb-1.5 text-foreground text-sm leading-relaxed outline-none placeholder:text-placeholder', showQuote && quote ? 'pt-2' : 'pt-2.5')}
      />
      {tooLong && <p role="status" className="px-3 pb-1.5 text-destructive-foreground text-xs">Comments can contain up to {COMMENT_CAP.toLocaleString()} characters.</p>}
      <div className="flex items-center gap-2.5 border-t py-1.5 ps-3 pe-1.5 text-muted-foreground text-xs">
        {!fresh ? <><span><Kbd className={KEY}>{label('enter')}</Kbd> save</span><span><Kbd className={KEY}>Esc</Kbd> cancel</span></>
          : <><span><Kbd className={KEY}>{label('enter')}</Kbd> cite</span><span><Kbd className={KEY}>{label('mod+enter')}</Kbd> cite &amp; send</span></>}
        <Button size="xs" className="ms-auto" disabled={tooLong} onPointerDown={event => event.preventDefault()} onClick={submit}>{tooLong ? 'Shorten comment' : 'Save'}</Button>
      </div>
    </div>,
    document.body,
  );
}

/** One citation in a message: its words beside the blue bar, cut at `lines` and unfolded by a click only when they are cut (find
 * in the chat unfolds them too, `beforematch`, when what it found is in the part cut off), the place where a number says
 * something (`placed`), which opens the memory view there, and your comment under it. */
function Cited({ cite, lines, under, onOpen }: { cite: Cite; lines: 1 | 2; under?: 'head' | 'cite'; onOpen?: (at: Place) => void }) {
  const [open, setOpen] = useState(false), [cut, setCut] = useState(false), words = useRef<HTMLSpanElement>(null), at = placed(cite);
  useLayoutEffect(() => {
    const element = words.current;
    if (!element || open) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, cite.text, lines]);
  const folds = cut || open, toggle = () => { if (!getSelection()?.toString()) setOpen(!open); };
  const place = at && (onOpen
    ? <button type="button" data-no-find title="Show it in the memory view" onClick={() => onOpen(at)} className="flex items-center gap-1 rounded-sm text-muted-foreground text-xs tabular-nums outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70"><HistoryIcon className="size-3 text-cite-ink" />Memory · {named(at)}</button>
    : <span data-no-find className="flex items-center gap-1 text-muted-foreground text-xs tabular-nums"><HistoryIcon className="size-3 text-cite-ink" />Memory · {named(at)}</span>);
  return (
    <div className={cn('px-3 py-2', under === 'head' && 'pt-1.5', under === 'cite' && 'shadow-[inset_0_1px_0_var(--cite-line)]')}>
      {cite.text ? (
        <div data-cited role={folds ? 'button' : undefined} tabIndex={folds ? 0 : undefined} aria-expanded={folds ? open : undefined} title={folds ? open ? 'Show less' : 'Show the whole quote' : undefined}
          onClick={folds ? toggle : undefined} onKeyDown={folds ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(!open); } } : undefined}
          className={cn('relative border-primary border-s-2 ps-2.5 text-[0.8125rem] text-muted-foreground leading-normal', folds && 'cursor-pointer pe-4.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70')}>
          <span ref={element => {
            words.current = element;
            const found = () => flushSync(() => setOpen(true));
            element?.addEventListener('beforematch', found);
            return () => element?.removeEventListener('beforematch', found);
          }} data-clamp={cut && !open ? 'lines' : undefined} className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', open ? 'block' : lines === 1 ? 'line-clamp-1' : 'line-clamp-2')}>{cite.text}</span>
          {folds && <ChevronDownIcon aria-hidden className={cn('absolute end-0 bottom-1 size-3 transition-transform duration-150', open && 'rotate-180')} />}
        </div>
      ) : at && <div className="border-primary border-s-2 py-px ps-2.5">{place}</div>}
      {cite.text && place && <div className="mt-1 ms-3">{place}</div>}
      {cite.comment && <div data-cite-comment className="mt-1.5 cursor-text select-text whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{cite.comment}</div>}
    </div>
  );
}
/** What a message cites, as one card at the top of it: made like the chip it was in the composer (the page's surface, a hairline,
 * squarer corners), a quote each, and over several of them a quiet line that says how many. One that waits in a queue is not
 * the chat's yet: its card is see-through, and its places open nothing. */
export function CiteGroup({ cites, onOpen, queued = false, className }: { cites: readonly Cite[]; onOpen?: (at: Place) => void; queued?: boolean; className?: string }) {
  const many = cites.length > 1;
  return (
    <div data-cites className={cn('min-w-0 text-start shadow-[inset_0_0_0_1px_var(--cite-line)] rounded-[10px]', queued ? 'bg-transparent' : 'bg-cite-card', className)}>
      {many && <p data-no-find className="flex items-center gap-1.5 px-3 pt-2 font-medium text-muted-foreground text-xs leading-snug"><QuoteIcon className="size-3 text-cite-ink" />Citing {cites.length}</p>}
      {cites.map((cite, at) => <Cited key={`${at}:${cite.text}`} cite={cite} lines={many ? 1 : 2} under={at ? 'cite' : many ? 'head' : undefined} onOpen={queued ? undefined : onOpen} />)}
    </div>
  );
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
