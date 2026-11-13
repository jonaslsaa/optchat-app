/** Where an address the window is asked to go to is shown: `here` when it is the app's own page, in your `browser` when it is
 * a web page, and `nowhere` otherwise. The window shows nothing but the app (what an agent writes can hold any link), and only
 * the web is handed on: a `file:` or another app's scheme is not the app's to open. */
export function destination(url: string, page: string): 'here' | 'browser' | 'nowhere' {
  let to: URL;
  try { to = new URL(url); } catch { return 'nowhere'; }
  if (to.origin === new URL(page).origin) return 'here';
  return to.protocol === 'http:' || to.protocol === 'https:' ? 'browser' : 'nowhere';
}
