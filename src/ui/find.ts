/** Find in the chat: where a text is written in what the chat shows, marked there with the browser's own highlights (the CSS
 * Custom Highlight API), which paint over ranges of the text and change nothing in the page. The way is T3 Code's (MIT, see
 * THIRD_PARTY_NOTICES.md: its `threadFindHighlights.ts`), a good deal smaller.
 *
 * What is searched is the text that is on the page: what you said, what the agent answered, the reports, and whatever is open
 * (a reply's work, a tool call, what the agent thought). What is folded shut is not on the page and is not searched. A long
 * message that is cut short is on the page whole, so it is searched whole, and opens when the match in it is the one shown.
 * The words of buttons, the times beside the messages and the line that says the agent is working are the page's, not the
 * chat's, and are left out; a file's name that opens the file is a button too, and is the chat's text all the same. */

/** What holds text that is not the chat's. */
const LEFT_OUT = 'button:not(.file-link), time, svg, math, [data-no-find]';
/** Tags that begin a line of their own: a text does not run from one into the next. */
const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'BR', 'HR', 'DETAILS', 'SUMMARY']);
type Place = readonly [from: number, to: number];

/** Finds `text` in what is written, as plain text and in any case (Æ is æ), with a line break or any other white space as a
 * space. A place is given in the characters of what was written, whatever its case does to its length. */
export function finder(text: string): (written: string) => Place[] {
  const sought = new RegExp(text.replace(/\s/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return written => text ? [...written.replace(/\s/g, ' ').matchAll(sought)].map(found => [found.index, found.index + found[0].length]) : [];
}

/** Where `find` finds its text under `under`, in the order it is read. A match may run through several pieces of text (a word
 * in bold in the middle of it), but not from one block into the next. */
function places(under: Element, find: ReturnType<typeof finder>): StaticRange[] {
  const found: StaticRange[] = [];
  let written = '', pieces: { node: Text; from: number }[] = [];
  const flush = () => {
    let start = 0;
    for (const [from, to] of written ? find(written) : []) {
      while (pieces[start + 1] && pieces[start + 1].from <= from) start++;
      let end = start;
      while (pieces[end + 1] && pieces[end + 1].from < to) end++;
      found.push(new StaticRange({ startContainer: pieces[start].node, startOffset: from - pieces[start].from, endContainer: pieces[end].node, endOffset: to - pieces[end].from }));
    }
    written = '';
    pieces = [];
  };
  const read = (node: Node) => {
    if (node instanceof Text) { pieces.push({ node, from: written.length }); written += node.data; }
    if (!(node instanceof Element)) return;
    const block = BLOCKS.has(node.tagName), out = node.matches(LEFT_OUT);
    if (block || out) flush();
    if (out) return;
    node.childNodes.forEach(read);
    if (block) flush();
  };
  read(under);
  flush();
  return found;
}
const live = (range: StaticRange) => { const made = new Range(); made.setStart(range.startContainer, range.startOffset); made.setEnd(range.endContainer, range.endOffset); return made; };

/** What was found: how many matches, and which of them is the one shown (-1: none). */
export interface Found { at: number; count: number }
/** How far from the edge of what scrolls a match is still out of sight, in pixels: the chat fades out there, and the bar lies
 * over its top. */
const MARGIN = 96;

/** Finds in the rows of `content`, which `scroller` scrolls, and tells `says` what it found whenever that changes: the chat
 * grows while the agent writes, and what is found follows it. `moved` hears that it scrolled the chat, which is not you
 * reading back to its top: find looks in what the chat has, and loads no more of it. A row is read again only when something in it changed, and all
 * of it is done before the page is painted (the observer is heard right after the change), so the marks never go out and
 * come back. `end` takes the marks off. */
export function finding(content: HTMLElement, scroller: HTMLElement, says: (found: Found) => void, moved: () => void) {
  let find = finder(''), rows = new WeakMap<Element, StaticRange[]>(), all: StaticRange[] = [], at = -1, said = '';
  // Where the chat was when you began to type, and where typing last put it: it is still there unless you moved it since.
  let began = 0, put = NaN;
  const tell = () => {
    if (typeof Highlight !== 'undefined') {
      const every = new Highlight(), shown = new Highlight();
      all.forEach((range, index) => (index === at ? shown : every).add(range));
      CSS.highlights.set('find', every);
      CSS.highlights.set('find-at', shown);
    }
    const now = `${at}/${all.length}`;
    if (now !== said) says({ at, count: all.length });
    said = now;
  };
  /** Reads the rows that changed. The match shown stays the one it was, wherever it is now among the others. */
  const look = () => {
    const was = all[at];
    all = [...content.children].flatMap(row => rows.get(row) ?? rows.set(row, places(row, find)).get(row)!);
    const same = was ? all.findIndex(range => range === was || range.startContainer === was.startContainer && range.startOffset === was.startOffset) : -1;
    at = same < 0 ? Math.min(Math.max(at, 0), all.length - 1) : same;
  };
  /** Brings the match shown into sight: a long message that is cut short over it opens (`data-clamp`, which hears
   * `beforematch`), and what scrolls around it is scrolled to it: the chat, a tool's output in it, and sideways a block of
   * code or a table whose lines are longer than the page is wide. */
  const reveal = () => {
    if (at < 0) return;
    const range = live(all[at]), within = range.startContainer.parentElement, cut = within?.closest('[data-clamp]');
    if (cut && range.getBoundingClientRect().bottom > cut.getBoundingClientRect().top + cut.clientHeight * 0.6) cut.dispatchEvent(new Event('beforematch'));
    for (let box = within; box; box = box === scroller ? null : box.parentElement) {
      const tall = box.scrollHeight > box.clientHeight, wide = box.scrollWidth > box.clientWidth;
      if (!tall && !wide) continue;
      const scrolls = getComputedStyle(box), match = range.getBoundingClientRect(), frame = box.getBoundingClientRect(), margin = Math.min(MARGIN, frame.height / 4);
      if (wide && /auto|scroll/.test(scrolls.overflowX) && (match.left < frame.left || match.right > frame.right)) box.scrollLeft += match.left - frame.left - frame.width / 3;
      if (!tall || box !== scroller && !/auto|scroll/.test(scrolls.overflowY) || match.top >= frame.top + margin && match.bottom <= frame.bottom - margin) continue;
      const top = box.scrollTop;
      box.scrollTop += match.top - frame.top - frame.height / 3;
      if (box === scroller && box.scrollTop !== top) moved();
    }
  };
  const observer = new MutationObserver(changes => {
    for (const { target } of changes) {
      let row: Node | null = target;
      while (row && row.parentNode !== content) row = row.parentNode;
      if (row instanceof Element) rows.delete(row);
    }
    look();
    tell();
  });
  observer.observe(content, { childList: true, characterData: true, subtree: true });
  return {
    /** Looks for another text. The match shown is the first one in sight or under it, and else the last one above, counted
     * from where you were when you began to type, whatever was found on the way: each letter typed is looked for from there,
     * and a text that is nowhere leaves the chat there. */
    seek(text: string) {
      if (scroller.scrollTop !== put) began = scroller.scrollTop;
      [find, rows, at] = [finder(text), new WeakMap(), -1];
      look();
      const top = scroller.getBoundingClientRect().top + began - scroller.scrollTop;
      let low = 0, high = all.length;
      while (low < high) { const middle = low + high >> 1; if (live(all[middle]).getBoundingClientRect().bottom < top) low = middle + 1; else high = middle; }
      at = Math.min(low, all.length - 1);
      if (all.length) reveal(); else if (scroller.scrollTop !== began) { scroller.scrollTop = began; moved(); }
      put = scroller.scrollTop;
      tell();
    },
    /** The next match (1) or the one before (-1), round the ends. */
    step(by: 1 | -1) {
      if (!all.length) return;
      at = (at + by + all.length) % all.length;
      reveal();
      tell();
    },
    end() {
      observer.disconnect();
      if (typeof Highlight !== 'undefined') for (const name of ['find', 'find-at']) CSS.highlights.delete(name);
    },
  };
}
