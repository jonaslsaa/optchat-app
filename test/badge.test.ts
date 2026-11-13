import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badge } from '../src/ui/badge.ts';

test('a profile\'s badge comes from its name alone: its letters, and a colour that stays', () => {
  const letters = (name: string) => badge(name).letters;
  assert.deepEqual(['personal', 'kahoot-work', 'my side project', 't3code', 'ålesund', ' work ', '', '---'].map(letters), ['P', 'KW', 'MP', 'T3', 'Å', 'W', '?', '?']);
  // The same name has the same colour whatever its case and the space around it, and names are spread over the colours.
  assert.equal(badge('Work').colour, badge(' work').colour);
  const colours = new Set(['personal', 'work', 'kahoot', 'home', 'research', 'side', 'optchat', 'notes', 'ops', 'writing', 'travel', 'money'].map(name => badge(name).colour));
  assert.ok(colours.size >= 5, `twelve names have ${colours.size} of the seven colours between them`);
});
