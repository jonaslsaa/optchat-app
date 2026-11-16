import type { MenuItemConstructorOptions } from 'electron';
import type { MenuAction } from '../menu.ts';

/** The app's name in its menu. Electron would write the package's (`optchat-app`), which also names the folder the app keeps
 * its window's place and the page's own storage in (`userData`): so the name is written here, and the package's stays. */
const NAME = 'OptChat', REPOSITORY = 'https://github.com/jonaslsaa/optchat-app';

export interface MenuDoes {
  /** Asks the page to do something, in a window that is opened for it when there is none. */
  page(action: MenuAction): void;
  /** Whether the page has the keys now: its window is in front, with the focus in the page. */
  keys(): boolean;
  /** Looks for an update and says what it found. Not there when the app does not update itself (run from the checkout). */
  update?: () => void;
  /** Opens a web page in your browser. */
  browse(url: string): void;
}
/** The menu bar, in place of Electron's own: the same entries a Mac app has, with what the page can do under File and View.
 * What it has that T3 Code's has too is laid out as there (`apps/desktop/src/window/DesktopApplicationMenu.ts`).
 *
 * An entry for something the page has a ⌘ shortcut for shows that shortcut, and the key is the page's: Electron gives a
 * key with ⌘ to the page first and to the menu only when the page left it, which it does where the key is not its to take
 * (keys.ts). So a key that comes to the menu while the page has the keys does nothing, and no key runs twice. With no
 * window, or the focus outside the page, nothing else hears the key and the menu runs it. A click always does.
 *
 * A key without ⌘ goes to the menu first and never to the page (Chromium's `performKeyEquivalent:`), so ⌥M is not shown
 * with its entry: the menu would take it from the page, and from a field in which ⌥M types µ. */
export function appMenu(does: MenuDoes): MenuItemConstructorOptions[] {
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const page = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions =>
    ({ label, accelerator, click: (_item, _window, event) => { if (!event.triggeredByAccelerator || !does.keys()) does.page(action); } });
  return [
    { label: NAME, submenu: [
      { role: 'about', label: `About ${NAME}` },
      { label: 'Check for Updates…', enabled: does.update !== undefined, click: () => does.update?.() },
      separator, page('Settings…', 'settings', 'Cmd+,'),
      separator, { role: 'services' },
      separator, { role: 'hide', label: `Hide ${NAME}` }, { role: 'hideOthers' }, { role: 'unhide' },
      separator, { role: 'quit', label: `Quit ${NAME}` },
    ] },
    { label: 'File', submenu: [page('New Connected Window', 'newWindow', 'Shift+Cmd+O'), page('New Profile…', 'newProfile'), separator, { role: 'close' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      page('Find in Chat', 'find', 'Cmd+F'), page('Search Memory', 'search', 'Shift+Cmd+F'), page('Chat or Memory', 'memory'), page('Usage', 'usage'), page('Show or Hide Sidebar', 'sidebar', 'Cmd+B'),
      separator, { role: 'reload' }, { role: 'toggleDevTools' },
      separator, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      separator, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Report a Problem', click: () => does.browse(`${REPOSITORY}/issues/new`) },
      { label: `${NAME} on GitHub`, click: () => does.browse(REPOSITORY) },
    ] },
  ];
}
