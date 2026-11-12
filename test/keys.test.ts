import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bound, escapes } from '../src/ui/keys.ts';

/** A key as the page gets it: first what lies over the page (the sheet's own `keydown`), then the page's shortcuts. */
function pressed(key = 'Escape') {
  const event = { key, code: key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: () => { event.defaultPrevented = true; } };
  return event;
}

test('Esc closes a sheet that lies over a running chat and does not stop the run; with no sheet it stops the run', () => {
  const did: string[] = [], shortcuts = { escape: () => did.push('stopped the run'), 'mod+b': () => did.push('toggled the sidebar') };
  // The sheet is open: it takes the key, and the page's Esc does not run.
  const first = pressed();
  escapes(first, () => did.push('closed the sheet'));
  bound(first, shortcuts)?.();
  assert.deepEqual(did, ['closed the sheet']);
  // Esc again, the sheet gone: the run is stopped, as it always was.
  bound(pressed(), shortcuts)?.();
  assert.deepEqual(did, ['closed the sheet', 'stopped the run']);
  // The sheet takes no other key: what else is pressed in it still reaches the page's shortcuts.
  const other = pressed('Tab');
  escapes(other, () => did.push('closed the sheet'));
  assert.equal(other.defaultPrevented, false);
  assert.equal(did.length, 2);
});
