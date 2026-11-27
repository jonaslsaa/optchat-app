import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asTyped, called, cite, cited, citing, commented, joined, paired, place, placed, whole, yours, type Cite } from '../src/ui/cite.ts';

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
  const long = cite('word '.repeat(2000)), line = whole({ id: 0, n: 8 }, 'word '.repeat(100));
  assert.equal(long.text.length, 8000);
  assert.ok(long.text.endsWith('word…'));
  assert.equal(line.text.length, 200);
  assert.deepEqual([place('11953'), place('11904+4'), place(''), place('4+'), place('5+0')], [{ id: 11953, n: 1 }, { id: 11904, n: 4 }, undefined, undefined, undefined]);
});

test('messages that go back into the composer are one message: what they cite, then what they say', () => {
  const first = citing([cite('one', { id: 1, n: 1 })], 'first'), second = citing([cite('two')], 'second');
  assert.equal(joined([first, 'plain', '', second]), citing([cite('one', { id: 1, n: 1 }), cite('two')], 'first\n\nplain\n\nsecond'));
  assert.equal(joined(['only', '']), 'only');
});

test('a mark follows its citation through the message by its words and place, whatever its comment, and is left over once it is gone', () => {
  const one = cite('the words', { id: 4, n: 1 }), same = cite('the words', { id: 9, n: 1 }), loose = cite('said in a run');
  const marks = [{ cite: one, range: 'a' }, { cite: same, range: 'b' }, { cite: loose, range: 'c' }, { cite: one, range: 'd' }];
  // Read back from the draft, with a comment added to one and the first taken off: each takes the first mark not yet taken.
  const { cites } = cited(citing([commented(same, 'why?'), loose, one, one, whole({ id: 4, n: 1 }, 'the')], ''));
  assert.deepEqual(paired(cites, marks).map(mark => mark?.range), ['b', 'c', 'a', 'd', undefined]);
  assert.deepEqual(paired(cites.slice(1, 2), marks).map(mark => mark?.range), ['c']);
});

test('a citation can carry an optional comment as a sibling tag, multi-line and escaped, while older plain citations stay valid', () => {
  const cites: Cite[] = [
    cite('quoted words', { id: 13928, n: 1 }, '  yeah same as T3!\nsecond line  '),
    whole({ id: 64, n: 2 }, '', 'check this whole block'),
    cite('plain quote', { id: 9, n: 1 }),
    cite('run quote', undefined, 'comment without place'),
  ];
  const message = citing(cites, 'overall message');
  assert.equal(message, [
    '<cite zoom="13928">quoted words</cite>',
    '<comment>yeah same as T3!\nsecond line</comment>',
    '<cite zoom="64+2"/>',
    '<comment>check this whole block</comment>',
    '<cite zoom="9">plain quote</cite>',
    '<cite>run quote</cite>',
    '<comment>comment without place</comment>',
    '',
    'overall message',
  ].join('\n'));
  assert.deepEqual(cited(message), { cites, text: 'overall message' });
  // Sent with nothing typed under commented citations, and round-tripped through yours / asTyped / joined.
  const only = citing(cites, '').trim();
  assert.deepEqual(cited(only), { cites, text: '' });
  assert.equal(asTyped(yours(only)), only);
  assert.equal(joined([citing([cites[0]], 'first'), citing([cites[2]], 'second')]), citing([cites[0], cites[2]], 'first\n\nsecond'));
  // Comments with blank lines, code, CRLF line endings, and closing tags cannot end early.
  for (const comment of ['first\n\nsecond', 'a </comment> inside\n<cite zoom="1">not one</cite>', 'a < b && c &lt;/comment> &amp;']) {
    const item = cite('x', { id: 5, n: 1 }, comment);
    assert.deepEqual(cited(citing([item], 'body')), { cites: [item], text: 'body' }, comment);
  }
  assert.deepEqual(cited('<cite zoom="5">quoted</cite>\r\n<comment>from windows</comment>\r\n\r\nbody'), { cites: [{ text: 'quoted', at: { id: 5, n: 1 }, comment: 'from windows' }], text: 'body' });
  assert.equal(citing([cite('x', undefined, '</comment>')], ''), '<cite>x</cite>\n<comment>&lt;/comment></comment>\n\n');
  // Blank comments are omitted, and a standalone <comment> in the body is never parsed as a citation comment.
  assert.equal(citing([commented(cites[0], '   ')], 'hi'), '<cite zoom="13928">quoted words</cite>\n\nhi');
  assert.deepEqual(cited('<comment>not attached</comment>'), { cites: [], text: '<comment>not attached</comment>' });
  assert.deepEqual(cited('<cite>one</cite>\n\n<comment>typed body</comment>'), { cites: [{ text: 'one' }], text: '<comment>typed body</comment>' });
  // A chip is called by its comment, else its words, and only one with no words by its place.
  assert.deepEqual([called(cites[0]), called(cites[1]), called(cites[2]), called(whole({ id: 64, n: 2 })), called(whole({ id: 0, n: 8 }, 'how the line begins'))], ['yeah same as T3!\nsecond line', 'check this whole block', 'plain quote', 'Memory 64+2', 'how the line begins']);
  // In the chat a place is shown only where its number says something: a line of several messages, or no words of its own.
  assert.deepEqual([placed(cites[0]), placed(cites[1]), placed(cites[3]), placed(whole({ id: 0, n: 8 }, 'how the line begins')), placed(whole({ id: 7, n: 1 }))], [undefined, { id: 64, n: 2 }, undefined, { id: 0, n: 8 }, { id: 7, n: 1 }]);
});

test('a message that runs a skill is its name and what was typed after it, as Pi sent it and as it was typed, and is written back as typed', () => {
  const path = '/home/.agents/skills/sol-loop/SKILL.md', body = 'References are relative to /home/.agents/skills/sol-loop.\n\n# Sol loop\n\nReview it.';
  const sent = `<skill name="sol-loop" location="${path}">\n${body}\n</skill>`, skill = { name: 'sol-loop', path, body };
  assert.deepEqual(yours(`${sent}\n\nthe last commit\n\nand the one before`), { skill, cites: [], text: 'the last commit\n\nand the one before' });
  assert.deepEqual(yours(sent), { skill, cites: [], text: '' });
  // Sent with an image and no words, it is logged with the image's name a line under it.
  assert.deepEqual(yours(`${sent}\n[image 0123456789abcdef]`), { skill, cites: [], text: '[image 0123456789abcdef]' });
  assert.deepEqual(yours('/skill:sol-loop the last commit'), { skill: { name: 'sol-loop' }, cites: [], text: 'the last commit' });
  assert.equal(asTyped(yours(`${sent}\n\nthe last commit`)), '/skill:sol-loop the last commit');
  // Taken back from the queue with what is typed in the box, it is the skill as typed, not its file.
  assert.equal(joined([sent, 'and say why']), '/skill:sol-loop\n\nand say why');
  // Only a message that begins with a skill runs one, as Pi reads it.
  for (const message of [`Look at this:\n\n${sent}`, '/skill:', '/skill:sol-loop\nthe last commit', ' /skill:sol-loop']) assert.deepEqual(yours(message), { cites: [], text: message }, message);
});
