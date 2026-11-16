import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finder } from '../src/ui/find.ts';

test('find is by plain text in any case, with a line break as a space, and says where in what was written', () => {
  const found = (written: string, text: string) => finder(text)(written).map(([from, to]) => written.slice(from, to));
  assert.deepEqual(found('Blåbær, BLÅBÆR og Ærlig ØL', 'blåbær'), ['Blåbær', 'BLÅBÆR']);
  assert.deepEqual(found('Blåbær, BLÅBÆR og Ærlig ØL', 'Æ'), ['æ', 'Æ', 'Æ']);
  // What is typed is text, whatever it means in a pattern.
  assert.deepEqual(found('a.b a+b (a.b) axb', 'a.b'), ['a.b', 'a.b']);
  assert.deepEqual(found('cost: $5 [paid]', '$5 [PAID]'), ['$5 [paid]']);
  assert.deepEqual(found('one\ntwo\tthree\u00a0four', 'two three four'), ['two\tthree\u00a0four']);
  assert.deepEqual(found('aaaa', 'aa'), ['aa', 'aa']);
  assert.deepEqual(found('anything', ''), []);
  // A letter whose lower case is longer than it (İ is i̇, two characters) leaves what follows it where it is.
  assert.deepEqual(finder('needle')('İİ Needle'), [[3, 9]]);
});
