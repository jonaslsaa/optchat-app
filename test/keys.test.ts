import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bound, escapes } from '../src/ui/keys.ts';

/** A key as the page gets it: first what is nearer (a menu that lies over the page, the box the focus is in), then the page's
 * shortcuts. Which part of the page a shortcut is for is the browser's to say, and tested in one (`ui.ts`). */
function pressed(key = 'Escape') {
  const event = { key, code: key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: () => { event.defaultPrevented = true; } };
  return event;
}

test('Esc closes a menu that lies over a running chat and does not stop the run; with no menu it stops the run', () => {
  const did: string[] = [], shortcuts = { escape: () => did.push('stopped the run'), 'mod+b': () => did.push('toggled the sidebar') };
  // The menu is open: it takes the key, and the page's Esc does not run.
  const first = pressed();
  escapes(first, () => did.push('closed the menu'));
  bound(first, shortcuts)?.();
  assert.deepEqual(did, ['closed the menu']);
  // Esc again, the menu gone: the run is stopped, as it always was.
  bound(pressed(), shortcuts)?.();
  assert.deepEqual(did, ['closed the menu', 'stopped the run']);
  // What hears it after the menu took it leaves it alone too: the box under an agent's chat does not interrupt the agent.
  const taken = pressed();
  escapes(taken, () => did.push('closed the menu'));
  escapes(taken, () => did.push('interrupted the agent'));
  assert.deepEqual(did.splice(2), ['closed the menu']);
  // The menu takes no other key: what else is pressed in it still reaches the page's shortcuts.
  const other = pressed('Tab');
  escapes(other, () => did.push('closed the menu'));
  assert.equal(other.defaultPrevented, false);
  assert.equal(did.length, 2);
});
