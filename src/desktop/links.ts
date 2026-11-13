/** Where an address is: `here` when it is the app's own page, on the `web` when it is another web page, and `nowhere` the
 * app goes otherwise. The window shows nothing but the app (what an agent writes can hold any link), and only the web is
 * handed to your browser: a `file:` or another app's scheme is not the app's to open. */
export function destination(url: string, page: string): 'here' | 'web' | 'nowhere' {
  let to: URL;
  try { to = new URL(url); } catch { return 'nowhere'; }
  if (to.origin === new URL(page).origin) return 'here';
  return to.protocol === 'http:' || to.protocol === 'https:' ? 'web' : 'nowhere';
}
