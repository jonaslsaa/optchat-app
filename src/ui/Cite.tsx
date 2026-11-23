import { BoxIcon, QuoteIcon } from 'lucide-react';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cite, COMMENT_CAP, named, place, type Cite, type Place, type Skill } from './cite.ts';
import { escapes } from './keys.ts';
import { Button, cn } from './ui.tsx';

/** Where a citation came from on screen, in viewport coordinates, so its comment popover opens right there. */
export interface CiteAnchor { left: number; right: number; top: number; bottom: number }
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
        onClick={event => { const where = anchorOf(event.currentTarget), cited = cite(words(found.range), found.at && found.at.id + found.at.n - 1 <= logged ? found.at : undefined); drop(); onCite(cited, where); }}>
        <QuoteIcon className="size-3.5" />Cite
      </Button>
    </span>
  );
}

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
export function CiteCommentPopover({ item, anchor, above = false, showQuote = false, opener, canSend = true, onSave, onSaveAndSend, onCancel, ref }: { item: Cite; anchor: CiteAnchor; above?: boolean; showQuote?: boolean; opener?: Element | null; canSend?: boolean; onSave: (comment: string, focus: boolean) => void; onSaveAndSend: (comment: string) => void; onCancel: () => void; ref?: Ref<{ commit: () => boolean; draft: () => string | undefined }> }) {
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
  // the cap. Esc is heard on capture so the chat's run is not stopped while this popover is open, except when a modal dialog
  // or inline rename sits over it (as `useOverlay` guards).
  const settled = useRef(false), actions = useRef({ onSave, onCancel, opener });
  actions.current = { onSave, onCancel, opener };
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

  return createPortal(
    <div ref={box} role="dialog" aria-label="Comment on citation" style={{ left: pos.left, top: pos.top }}
      onPointerDown={event => event.stopPropagation()}
      onBlur={event => {
        const next = event.relatedTarget;
        if (!next || (next instanceof Node && (box.current?.contains(next) || actions.current.opener?.contains(next)))) return;
        if (next instanceof Element && next.closest('[data-cite-action]')) return;
        commit(false);
      }}
      className="enter enter-grow fixed z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border bg-popover p-2.5 text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
      {showQuote && quote && (
        <p className="mb-1.5 line-clamp-2 rounded-md bg-black/6 px-2 py-1 text-muted-foreground text-xs leading-snug [overflow-wrap:anywhere] dark:bg-white/8">{quote}</p>
      )}
      <textarea
        ref={area} rows={2} value={comment} placeholder="Add an optional comment..."
        aria-label="Comment on cited text"
        aria-invalid={tooLong || undefined}
        onChange={event => setComment(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) submitAndSend(); else submit();
          }
        }}
        className="field-sizing-content block max-h-40 min-h-14 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-foreground text-sm leading-relaxed outline-none placeholder:text-placeholder"
      />
      {tooLong && <p role="status" className="px-1 pt-1 text-destructive-foreground text-xs">Comments can contain up to {COMMENT_CAP.toLocaleString()} characters.</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button variant="outline" size="xs" onPointerDown={event => event.preventDefault()} onClick={cancel}>Cancel</Button>
        <Button size="xs" disabled={tooLong} onPointerDown={event => event.preventDefault()} onClick={submit}>{tooLong ? 'Shorten comment' : 'Save'}</Button>
      </div>
    </div>,
    document.body,
  );
}

/** What a message cites, as a card in it (T3 Code's `ResponseCard`, MIT, see THIRD_PARTY_NOTICES.md): how it begins, where in
 * the memory it is, and your comment on it when it has one. One that has a place opens the memory view there (`onOpen`). */
export function CiteCard({ cite: { text, at, comment }, onOpen }: { cite: Cite; onOpen?: (at: Place) => void }) {
  const card = 'block w-full min-w-0 rounded-lg bg-black/8 px-2.5 py-1.5 text-start text-muted-foreground text-sm dark:bg-white/8', opens = at && onOpen;
  const shown = (
    <>
      {text && <span className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>}
      {at && <span data-no-find className="block text-2xs tabular-nums opacity-80">Memory · {named(at)}</span>}
    </>
  );
  const quote = opens ? <button type="button" data-cited title="Show it in the memory view" onClick={() => onOpen(at)} className={cn(card, 'outline-none hover:bg-black/12 focus-visible:ring-2 focus-visible:ring-ring/70 dark:hover:bg-white/12')}>{shown}</button>
    : <span data-cited className={card}>{shown}</span>;
  if (!comment) return quote;
  return (
    <span className="block min-w-0">
      {quote}
      <span data-cite-comment className="mt-1.5 block whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{comment}</span>
    </span>
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
