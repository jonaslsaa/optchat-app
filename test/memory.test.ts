import assert from 'node:assert/strict';
import { test } from 'node:test';
import { called, leaf, printed, report, size, tagged } from '../src/ui/memory.ts';

test('a line of one message is who said it and what it says: by its own kind, else by how its summary begins', () => {
  assert.deepEqual(leaf({ kind: 'user', text: 'user: merge #95' }), { kind: 'user', text: 'merge #95' });
  // Imported history has the day it was written in front.
  assert.deepEqual(leaf({ kind: 'note', text: '[IMP 2026-10-05] note: worktrees go in ~/.worktrees' }), { kind: 'note', imported: '2026-10-05', text: 'worktrees go in ~/.worktrees' });
  // A summary the compactor wrote that begins otherwise is all text, and its kind is still the line's.
  assert.deepEqual(leaf({ kind: 'work', text: '8d195225 final: PR #101 is ready' }), { kind: 'work', text: '8d195225 final: PR #101 is ready' });
  // From a server that does not send the kind, the head says it, and with neither there is none.
  assert.deepEqual(leaf({ text: 'echo: bash: ok' }), { kind: 'echo', text: 'bash: ok' });
  assert.deepEqual(leaf({ text: 'Fixed it: the timer.' }), { kind: undefined, text: 'Fixed it: the timer.' });
});

test('a tool call is said in the chat\'s words, with the folder a command goes to set apart; a summary of one is its words', () => {
  assert.deepEqual(called('read {"limit":null,"offset":null,"path":"/tmp/radius-crops/crop.png"}'), { name: 'read', verb: 'Read', subject: '/tmp/radius-crops/crop.png' });
  assert.deepEqual(called('bash {"command":"cd ~/Documents/Personal/optchat-app && gh pr merge 101 --squash","timeout":60}'), { name: 'bash', verb: 'Ran', folder: 'optchat-app', subject: 'gh pr merge 101 --squash' });
  assert.deepEqual(called('bash {"command":"npm test"}'), { name: 'bash', verb: 'Ran', subject: 'npm test' });
  assert.deepEqual(called('spawned Opus 5.5 on the gutter'), { name: 'spawned', subject: 'spawned Opus 5.5 on the gutter' });
  assert.deepEqual(called('bash: ran the tests {not json}'), { name: 'bash', subject: 'bash: ran the tests {not json}' });
});

test('a result goes without its tool\'s name, and a report by its agent and title', () => {
  assert.deepEqual(printed('bash: ℹ tests 18'), { name: 'bash', text: 'ℹ tests 18' });
  assert.deepEqual(printed('Agent aborted: No further details'), { text: 'Agent aborted: No further details' });
  assert.deepEqual(report('[801252b8 · Grouped reports] Message from subagent (still running): Not yet.'), { agent: '801252b8', title: 'Grouped reports', running: true, text: 'Not yet.' });
  assert.deepEqual(report('[ce3d516d] T3 Code replays by sequence number.'), { agent: 'ce3d516d', running: false, text: 'T3 Code replays by sequence number.' });
  assert.deepEqual(report('8d195225 merged it'), { running: false, text: '8d195225 merged it' });
});

test('a summary\'s tags are pieces of their own where they begin it, a line or a sentence, and nowhere else', () => {
  assert.deepEqual(tagged('user: "merge 101" → talk: merged a831a5b. tool: worktree removed\necho: ok'), [
    { kind: 'user' }, { text: '"merge 101" → ' }, { kind: 'talk' }, { text: 'merged a831a5b. ' }, { kind: 'tool' }, { text: 'worktree removed\n' }, { kind: 'echo' }, { text: 'ok' },
  ]);
  assert.deepEqual(tagged('[IMP 2026-10-04] user: asked; the user: field stays'), [{ text: '[IMP 2026-10-04] ' }, { kind: 'user' }, { text: 'asked; the user: field stays' }]);
  assert.deepEqual(tagged('no tags here'), [{ text: 'no tags here' }]);
});

test('a line\'s badge is how many messages it holds', () => {
  assert.deepEqual([2, 256, 1024, 16384].map(size), ['2', '256', '1k', '16k']);
});
