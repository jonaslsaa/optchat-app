import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { destination } from './links.ts';

/** What the window does that Electron leaves to the app, as far as it needs no window: where it opens, whether its page is
 * loaded again after a crash, and what a right click offers. `main.ts` has the rest. */

const Bounds = Type.Object({ x: Type.Integer(), y: Type.Integer(), width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) });
type Bounds = Type.Static<typeof Bounds>;
/** Where the window was when it was last closed (`saved`, as it was kept), if it is still whole on one of the screens there
 * are now: a window kept from a screen that is gone would open where nobody sees it. A window at a screen's edge can be a
 * pixel past it, as T3 Code found. Without a place the window opens as a new one does. */
export function placed(saved: unknown, screens: readonly Bounds[]): Bounds | undefined {
  if (!Value.Check(Bounds, saved)) return undefined;
  const { x, y, width, height } = saved;
  return screens.some(screen => x >= screen.x - 1 && y >= screen.y - 1 && x + width <= screen.x + screen.width + 1 && y + height <= screen.y + screen.height + 1) ? { x, y, width, height } : undefined;
}

/** Says, each time the page's process is gone, after how long the page is loaded again: half a second, then one, then two,
 * and not at all after three times in a minute (as T3 Code does; the longer waits are ours), since a page that crashes as it loads would be loaded
 * for ever. A process that was ended on purpose (`clean-exit`), or that could not start, is not loaded again either. */
export function recovery(most = 3, within = 60_000) {
  let times: number[] = [];
  return (reason: string, now = Date.now()) => {
    times = times.filter(time => now - time < within);
    if (!['crashed', 'oom', 'killed', 'abnormal-exit'].includes(reason) || times.length >= most) return undefined;
    return 500 * 2 ** (times.push(now) - 1);
  };
}

/** What a right click offers, as T3 Code has it (`apps/desktop/src/window/DesktopWindow.ts`): the spellings for a word that is
 * marked as wrong, Copy Link on a link the app would open, Copy Image on a picture, and cut, copy, paste and select all, each
 * only where it can be done. Electron has no such menu of its own. */
export function contextMenu(
  { misspelledWord, dictionarySuggestions, linkURL, mediaType, editFlags }: Pick<ContextMenuParams, 'misspelledWord' | 'dictionarySuggestions' | 'linkURL' | 'mediaType' | 'editFlags'>,
  page: string, does: { replace(word: string): void; copyLink(): void; copyImage(): void; rename?: () => void },
): MenuItemConstructorOptions[] {
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  return [
    // On a connected window's row in the sidebar (main.ts).
    ...does.rename ? [{ label: 'Rename', click: does.rename }, separator] : [],
    ...misspelledWord ? [...dictionarySuggestions.slice(0, 5).map(word => ({ label: word, click: () => does.replace(word) })), ...dictionarySuggestions.length ? [] : [{ label: 'No suggestions', enabled: false }], separator] : [],
    ...destination(linkURL, page) !== 'nowhere' ? [{ label: 'Copy Link', click: does.copyLink }, separator] : [],
    ...mediaType === 'image' ? [{ label: 'Copy Image', click: does.copyImage }, separator] : [],
    { role: 'cut', enabled: editFlags.canCut }, { role: 'copy', enabled: editFlags.canCopy }, { role: 'paste', enabled: editFlags.canPaste }, { role: 'selectAll', enabled: editFlags.canSelectAll },
  ];
}
