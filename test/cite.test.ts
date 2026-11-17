import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cite, cited, citing, joined, place, skilled, typed, whole, type Cite } from '../src/ui/cite.ts';

test('a message is written with what it cites first, each with its place in the memory, and is read back as it was', () => {
  const cites: Cite[] = [cite('  the two lines\nthat were selected ', { id: 11953, n: 1 }), whole({ id: 11904, n: 4 }, 'How the snapshot is taken'), whole({ id: 64, n: 2 }), cite('said in a run')];
  const message = citing(cites, 'What about these?');
  assert.equal(message, '<cite zoom="11953">the two lines\nthat were selected</cite>\n<cite zoom="11904+4">How the snapshot is taken</cite>\n<cite zoom="64+2"/>\n<cite>said in a run</cite>\n\nWhat about these?');
  assert.deepEqual(cited(message), { cites, text: 'What about these?' });
  // Sent with nothing typed, the message is its citations; one that cites nothing is what was typed, to the letter.
  assert.deepEqual(cited(citing(cites, '').trim()), { cites, text: '' });
  for (const typed of ['', '\nunder an empty line', '> an old quote', 'if (a < b && c) return <cite>;']) {
    assert.equal(citing([], typed), typed);
    assert.deepEqual(cited(citing(cites, typed)), { cites, text: typed });
  }
});

test('what is cited cannot end its citation early, and code is cited as it is written', () => {
  for (const text of ['a </cite> in it\n\n<cite zoom="1">not one</cite>', 'Array<string> && a < b', '&lt;/cite> and &amp;lt; and &amp;', '<cite zoom="3"/>']) {
    assert.deepEqual(cited(citing([cite(text, { id: 7, n: 1 })], 'typed')), { cites: [{ text, at: { id: 7, n: 1 } }], text: 'typed' }, text);
  }
  assert.equal(citing([cite('Array<string> && a < b')], ''), '<cite>Array<string> && a < b</cite>\n\n');
  assert.equal(citing([cite('</cite>')], ''), '<cite>&lt;/cite></cite>\n\n');
});

test('only what a message begins with is a citation, and a long one is cut', () => {
  const typed = 'See <cite zoom="5">this</cite> in the middle';
  assert.deepEqual(cited(typed), { cites: [], text: typed });
  assert.deepEqual(cited('<cite zoom="five">no place</cite>'), { cites: [], text: '<cite zoom="five">no place</cite>' });
  const long = cite('word '.repeat(1000)), line = whole({ id: 0, n: 8 }, 'word '.repeat(100));
  assert.equal(long.text.length, 2000);
  assert.ok(long.text.endsWith('word…'));
  assert.equal(line.text.length, 200);
  assert.deepEqual([place('11953'), place('11904+4'), place(''), place('4+'), place('5+0')], [{ id: 11953, n: 1 }, { id: 11904, n: 4 }, undefined, undefined, undefined]);
});

test('messages that go back into the composer are one message: what they cite, then what they say', () => {
  const first = citing([cite('one', { id: 1, n: 1 })], 'first'), second = citing([cite('two')], 'second');
  assert.equal(joined([first, 'plain', '', second]), citing([cite('one', { id: 1, n: 1 }), cite('two')], 'first\n\nplain\n\nsecond'));
  assert.equal(joined(['only', '']), 'only');
});

test('a message that runs a skill is its name and what was typed after it, as Pi sent it and as it was typed', () => {
  const path = '/home/.agents/skills/sol-loop/SKILL.md', body = 'References are relative to /home/.agents/skills/sol-loop.\n\n# Sol loop\n\nReview it.';
  const sent = `<skill name="sol-loop" location="${path}">\n${body}\n</skill>`;
  assert.deepEqual(skilled(`${sent}\n\nthe last commit\n\nand the one before`), { skill: { name: 'sol-loop', path, body }, text: 'the last commit\n\nand the one before' });
  assert.deepEqual(skilled(sent), { skill: { name: 'sol-loop', path, body }, text: '' });
  assert.deepEqual(skilled('/skill:sol-loop the last commit'), { skill: { name: 'sol-loop' }, text: 'the last commit' });
  assert.equal(typed(skilled(`${sent}\n\nthe last commit`).skill, 'the last commit'), '/skill:sol-loop the last commit');
  assert.equal(typed(skilled(sent).skill, ''), '/skill:sol-loop');
  // Only a message that begins with a skill runs one, as Pi reads it.
  for (const message of [`Look at this:\n\n${sent}`, '/skill:', '/skill:sol-loop\nthe last commit', ' /skill:sol-loop']) assert.deepEqual(skilled(message), { text: message }, message);
});
