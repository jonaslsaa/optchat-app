/** Keyboard shortcuts, written as `mod+shift+o`: `mod` is ⌘ on a Mac and Ctrl elsewhere. Letters and digits are matched by the
 * key's place on the keyboard, so Alt+1 is found though a Mac types ¡ for it. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function matches(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut.split('+'), key = parts.at(-1)!;
  const want = (name: string) => parts.includes(name);
  const mod = isMac ? event.metaKey : event.ctrlKey, other = isMac ? event.ctrlKey : event.metaKey;
  if (mod !== want('mod') || other || event.altKey !== want('alt') || event.shiftKey !== want('shift')) return false;
  return event.code === `Key${key.toUpperCase()}` || event.code === `Digit${key}` || event.key.toLowerCase() === key;
}
/** A shortcut as its keys are printed: ⌘⇧O, or Ctrl+Shift+O. */
export function label(shortcut: string) {
  const names: Record<string, string> = isMac ? { mod: '⌘', shift: '⇧', alt: '⌥', enter: '↵', escape: 'Esc' } : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', enter: 'Enter', escape: 'Esc' };
  return shortcut.split('+').map(part => names[part] ?? part.toUpperCase()).join(isMac ? '' : '+');
}
