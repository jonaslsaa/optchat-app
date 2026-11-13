import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badge } from '../src/ui/badge.ts';

test('a profile\'s badge comes from its name alone: two letters, and a colour that stays', () => {
  const letters = (name: string) => badge(name).letters;
  // The first letter, and then a digit of the first word, the first letter of the last word, or the word's own last letter.
  assert.deepEqual(['work', 'kahoot-work', 'my side project', 't3code', 'v2-api', 'a', 'ålesund', ' Work ', '', '---'].map(letters), ['WK', 'KW', 'MP', 'T3', 'V2', 'AA', 'ÅD', 'WK', '?', '?']);
  // The same name has the same colour whatever its case and the space around it, and names are spread over the colours.
  assert.equal(badge('Work').colour, badge(' work').colour);
  const colours = new Set(['personal', 'work', 'kahoot', 'home', 'research', 'side', 'optchat', 'notes', 'ops', 'writing', 'travel', 'money'].map(name => badge(name).colour));
  assert.ok(colours.size >= 8, `twelve names have ${colours.size} of the eighteen colours between them`);
});
