import { useEffect, useState } from 'react';

/** Keyboard shortcuts, written as `mod+shift+o`: `mod` is ⌘ on a Mac and Ctrl elsewhere. Letters and digits are matched by the
 * key's place on the keyboard, so Alt+1 is found though a Mac types ¡ for it. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

type Pressed = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;
export function matches(event: Pressed, shortcut: string) {
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
/** What a key runs of `bindings`: the first whose shortcut it is, and nothing when something nearer already took the key. */
export const bound = (event: Pressed & Pick<KeyboardEvent, 'defaultPrevented'>, bindings: Record<string, () => void>) =>
  event.defaultPrevented ? undefined : Object.entries(bindings).find(([shortcut]) => matches(event, shortcut))?.[1];
/** Esc for what lies over the page, which hears the key before the page's shortcuts do: it closes, and the key is taken, so
 * none of them runs. A sheet over a chat whose agent is working closes, and the agent works on. */
export function escapes(event: Pick<KeyboardEvent, 'key' | 'preventDefault'>, close: () => void) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  close();
}
/** Runs the binding whose shortcut is pressed, wherever the focus is, unless something nearer already took the key. `bindings`
 * is made again when `deps` change, as with `useEffect`. */
export function useShortcuts(bindings: () => Record<string, () => void>, deps: readonly unknown[]) {
  useEffect(() => {
    const now = bindings();
    const pressed = (event: KeyboardEvent) => {
      const run = bound(event, now);
      if (run) { event.preventDefault(); run(); }
    };
    addEventListener('keydown', pressed);
    return () => removeEventListener('keydown', pressed);
  }, deps);
}
/** Whether ⌥ (Alt) is down, which is when the page shows what it does with a digit. */
export function useAltHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => setHeld(event.altKey), left = () => setHeld(false);
    addEventListener('keydown', pressed); addEventListener('keyup', pressed); addEventListener('blur', left);
    return () => { removeEventListener('keydown', pressed); removeEventListener('keyup', pressed); removeEventListener('blur', left); };
  }, []);
  return held;
}
