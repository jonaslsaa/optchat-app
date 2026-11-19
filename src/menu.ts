/** What the desktop app's menu bar asks of the page. The shell says it with an event of this name on the page's window, whose
 * `detail` is one of these (`src/desktop/menu.ts`), and the page does it with what its own shortcut for it runs (`useMenu` in
 * `src/ui/keys.ts`). */
export const MENU_EVENT = 'optchat-menu';
export const MENU_ACTIONS = ['settings', 'usage', 'newProfile', 'import', 'newWindow', 'find', 'search', 'memory', 'sidebar'] as const;
export type MenuAction = typeof MENU_ACTIONS[number];
/** The desktop app's right-click Rename, on a connected window's row (`data-rename`, the window's id): said with an event of
 * this name, whose `detail` is that id, and the sidebar opens the row's name to be renamed. */
export const RENAME_EVENT = 'optchat-rename';
