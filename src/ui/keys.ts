import { useEffect, useState, type RefObject } from 'react';

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
/** Whose the keys are. A part of the page with keys of its own says so (`data-keys`): the memory view in the chat's place, and
 * the panel beside it. A key belongs to the nearest such part around the focus, and to the chat everywhere else: on the
 * windows at the left and the profiles' tabs as in the chat itself. A shortcut that is one part's runs only for its keys:
 * Esc stops a run from the chat, and not from the panel or the memory view. T3 Code's shortcuts are scoped the same way (its
 * `shortcuts/dispatcher.ts`: a scope's `when` is read from where the focus is, when the key is pressed).
 *
 * With the focus on nothing (what had it is gone, or nothing had it yet) the keys are in the part the focus or the pointer
 * was last in, while that is still on the page, and else in the page's first: the chat's column, which says which of the
 * chat and the memory view it shows. */
const PARTS = ['chat', 'memory', 'panel'] as const;
export type Keys = typeof PARTS[number];
declare module 'react' { interface HTMLAttributes<T> { 'data-keys'?: Keys } }
const part = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-keys]') : null;
let last: HTMLElement | null = null;
if (typeof document !== 'undefined') for (const type of ['focusin', 'pointerdown'] as const) document.addEventListener(type, event => { last = part(event.target); }, true);
function keysOf(target: EventTarget | null): Keys {
  const within = target !== document.body ? part(target) : last?.isConnected ? last : document.querySelector<HTMLElement>('[data-keys]');
  return PARTS.find(name => name === within?.dataset.keys) ?? 'chat';
}
/** What a key runs of `bindings`: the first whose shortcut it is, and nothing when something nearer already took the key. */
export const bound = (event: Pressed & Pick<KeyboardEvent, 'defaultPrevented'>, bindings: Record<string, () => void>) =>
  event.defaultPrevented ? undefined : Object.entries(bindings).find(([shortcut]) => matches(event, shortcut))?.[1];
/** Esc for what is nearer than the page's shortcuts and hears the key before they do: it runs `close`, and the key is taken,
 * so none of them runs, nor another of these that hears it later. */
export function escapes(event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'preventDefault'>, close: () => void) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  close();
}
/** Runs the binding whose shortcut is pressed, unless something nearer already took the key: wherever the focus is, or only
 * while the keys are `within` one of the parts of the page that are named. `bindings` is made again when `deps` change, as
 * with `useEffect`. */
export function useShortcuts(bindings: () => Record<string, () => void>, deps: readonly unknown[], ...within: Keys[]) {
  useEffect(() => {
    const now = bindings();
    const pressed = (event: KeyboardEvent) => {
      const run = !within.length || within.some(keys => keys === keysOf(event.target)) ? bound(event, now) : undefined;
      if (run) { event.preventDefault(); run(); }
    };
    addEventListener('keydown', pressed);
    return () => removeEventListener('keydown', pressed);
  }, deps);
}
/** A menu or a list that lies over the page while it is `open`, under `root` with the button that opens it. Esc closes it and
 * nothing else, wherever the focus is (a click on a row of it leaves the focus with the page), so the key is heard on its way
 * down, before any shortcut; the focus is then on `opener` again. A press anywhere else closes it too. */
export function useOverlay(open: boolean, close: () => void, root: RefObject<HTMLElement | null>, opener: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close(); };
    const pressed = (event: KeyboardEvent) => escapes(event, () => { close(); opener.current?.focus(); });
    addEventListener('pointerdown', away); addEventListener('keydown', pressed, true);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', pressed, true); };
  }, [open]);
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
