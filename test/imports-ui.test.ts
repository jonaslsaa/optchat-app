import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ImportPreview } from '../src/protocol.ts';
import { asks, chosen, key, modes, picked, projects, summary, toggled, type Scans } from '../src/ui/imports.ts';

const now = Date.UTC(2026, 10, 17), day = 86_400_000;
const found = (id: string, project: string, ago: number, title = `talk ${id}`) => ({ id, title, project, date: new Date(now - ago * day).toISOString(), size: 1000 });
const scans: Scans = {
  claude: { found: [found('a', '~/code/app', 1), found('b', '~/code/app', 40, 'the CSV export'), found('c', '~/code/app', 400), found('d', '~/notes', 2)], warnings: [] },
  codex: { found: [found('a', '~/code/app', 5), found('e', '~/code/app', 6)], warnings: [] },
  pi: { error: 'unreadable' },
};

test('projects are each source\'s own, busiest first, and hold only what is in the range', () => {
  assert.deepEqual(projects(scans, ['claude', 'codex'], 'All', now).map(p => [p.source, p.project, p.conversations.length]),
    [['claude', '~/code/app', 3], ['codex', '~/code/app', 2], ['claude', '~/notes', 1]]);
  assert.deepEqual(projects(scans, ['claude'], '30 days', now).map(p => [p.project, p.conversations.map(c => c.id)]), [['~/code/app', ['a']], ['~/notes', ['d']]]);
  // The filter keeps a project by its name with all of it, or by the titles that have the text, with only those.
  assert.deepEqual(projects(scans, ['claude'], 'All', now, 'csv').map(p => p.conversations.map(c => c.id)), [['b']]);
  assert.deepEqual(projects(scans, ['claude'], 'All', now, 'NOTES').map(p => p.project), ['~/notes']);
  assert.deepEqual(projects(scans, ['pi'], 'All', now), []);
});

test('a pick is what was ticked of the chosen sources in the range; the filter only hides', () => {
  const [app] = projects(scans, ['claude'], 'A year', now);
  let picks = toggled(app, new Set());
  assert.equal(picked(app, picks), 'all');
  assert.deepEqual(chosen(scans, ['claude'], 'A year', now, picks), [{ source: 'claude', id: 'a' }, { source: 'claude', id: 'b' }]);
  // The same id in another source is another conversation.
  assert.deepEqual(chosen(scans, ['claude', 'codex'], 'A year', now, picks).length, 2);
  picks.delete(key('claude', 'a'));
  assert.equal(picked(app, picks), 'some');
  picks = toggled(app, picks);
  assert.equal(picked(app, picks), 'all');
  assert.equal(picked(app, toggled(app, picks)), 'none');
  // A narrower range leaves out what it does not reach, and a wider one brings back only what was ticked.
  assert.deepEqual(chosen(scans, ['claude'], '30 days', now, picks), [{ source: 'claude', id: 'a' }]);
  assert.deepEqual(chosen(scans, ['claude'], 'All', now, picks).map(c => c.id), ['a', 'b']);
  // A source that is not chosen any more brings nothing.
  assert.deepEqual(chosen(scans, [], 'All', now, picks), []);
});

test('the footer says what is picked and what the compactor would read for it', () => {
  const preview: ImportPreview = { conversations: 214, added: 12_960, skipped: 5440, warnings: [], memory: { messages: 10, summaries: 9 }, append: { tokens: 3_000_000, summaries: 12_000, bytes: 12_000_000 }, rebuild: { tokens: 3_100_000, summaries: 13_000, bytes: 12_400_000 } };
  assert.deepEqual(summary(0, undefined, 'append', 'Sonnet 5.5'), ['Nothing picked yet']);
  assert.deepEqual(summary(214, undefined, 'append', 'Sonnet 5.5'), ['214 picked', 'Counting…']);
  assert.deepEqual(summary(214, preview, 'append', 'Sonnet 5.5'), ['214 conversations', '12,960 new messages', '5,440 already in memory', 'about 9M tokens through Sonnet 5.5']);
  assert.equal(summary(214, preview, 'rebuild', 'Sonnet 5.5').at(-1), 'about 9.3M tokens through Sonnet 5.5', 'the estimate is the way picked');
  assert.deepEqual(summary(1, { ...preview, conversations: 1, added: 0, skipped: 3 }, 'append', 'Sonnet 5.5'), ['1 conversation', '0 new messages', '3 already in memory']);
  // Only a memory that has messages is asked how the history joins them: not with nothing picked, and not a new profile's.
  assert.deepEqual([asks(undefined), asks({ ...preview, memory: { messages: 0, summaries: 0 } }), asks(preview)], [false, false, true]);
  // Each way it can join a memory says what it costs, by its own estimate.
  assert.deepEqual(modes(preview).map(m => [m.mode, m.line.split(' · ')[1]]), [['append', 'about 9M tokens'], ['rebuild', 'about 9.3M tokens']]);
});
