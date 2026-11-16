// The ledger's "Today" is by the clock on the wall, and the terminal's lines below were taken in UTC.
process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
import { usage } from '../src/server/usage.ts';
import { App } from '../src/ui/store.ts';
import { breakdown, chart, headline, short } from '../src/ui/usage.ts';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome(), NOW = Date.UTC(2026, 10, 16, 12);
/** A ledger as pi-optchat writes one (`test/usage.jsonl`): every role, a record from before providers and sessions were
 * kept, two lines that cannot be read and an answer that was logged twice. */
const work = createProfile(home, 'work'), ledger = join(work, 'usage.jsonl');
copyFileSync(join(import.meta.dirname, 'usage.jsonl'), ledger);
/** What pi-optchat's own usage page said of that ledger at `NOW`, for each range (`test/usage-terminal.txt`): the lines
 * of `/optchat usage` in pi-optchat 0.11.13, 100 columns wide, without their colours. */
const terminal = Object.fromEntries(readFileSync(join(import.meta.dirname, 'usage-terminal.txt'), 'utf8').split(/^# /m).slice(1).map(block => {
  const [range, , , said, , , ...rest] = block.split('\n'), rows = rest.slice(0, rest.indexOf('')), warnings = rest.slice(rows.length + 2).filter(Boolean);
  return [range, { said, rows: rows.map(row => row.trim().split(/\s{2,}/)), warnings }];
}));

test('the page says what /optchat usage says in a terminal, for each range', () => {
  for (const [range, { said, rows, warnings }] of Object.entries(terminal)) {
    const read = usage(work, range, NOW);
    assert.equal(headline(read), said, range);
    // The terminal names a role on the first of its lines, and has no line for the role itself.
    assert.deepEqual(breakdown(read).flatMap(role => role.models.map(({ model, cost, share, out, cached }, index) => [...index ? [] : [role.short], model, cost, share, out, cached])), rows, range);
    assert.deepEqual(read.warnings, warnings, range);
  }
  assert.deepEqual(Object.keys(terminal), usage(work, undefined, NOW).ranges, 'and those are all the ranges there are');
  assert.equal(usage(work, undefined, NOW).range, 'Today');
  assert.deepEqual([999, 999.5, 12_345, 164_400, 999_950, 2_449_000].map(short), ['999', '1k', '12.3k', '164k', '1M', '2.4M']);
});

test('the bars cover the range from its first spending to now, add up to its total, and a role\'s line to its models\'', () => {
  const cost = (bar: { cost: Record<string, number> }) => Object.values(bar.cost).reduce((a, b) => a + b, 0);
  for (const [range, step, count] of [['Last hour', 'minutes', 9], ['Today', 'hour', 10], ['Last 7 days', 'day', 7], ['All time', 'day', 21]] as const) {
    const read = usage(work, range, NOW);
    assert.deepEqual([read.step, read.bars.length], [step, count], range);
    assert.ok(Math.abs(read.bars.reduce((sum, bar) => sum + cost(bar), 0) - read.usage.cost.total) < 1e-9, range);
    assert.equal(read.bars.reduce((sum, bar) => sum + bar.tokens, 0), read.usage.totalTokens, range);
  }
  const today = usage(work, 'Today', NOW), drawn = chart(today, 'en-GB', 'UTC');
  assert.deepEqual(today.bars.map(bar => bar.start.slice(11, 16)), ['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00']);
  assert.deepEqual(today.bars.map(bar => Object.entries(bar.cost).filter(([, spent]) => spent > 0).map(([role]) => role)), [['compactor'], ['subagent'], [], [], ['subagent'], [], [], [], ['main', 'subagent', 'compactor'], []]);
  assert.deepEqual([drawn.ends, drawn.peak, drawn.bars[8].title, drawn.bars[8].height, drawn.bars[9].height], [['03:00', '12:00'], '$0.80', '11:00 · $0.80 · 503k tokens', 1, 0]);
  assert.deepEqual(drawn.bars[8].parts.map(part => part.role), ['main', 'subagent', 'compactor']);
  // Bars of hours that go past midnight say the day, and longer ones the day alone.
  const nothing = { tokens: 0, cost: { main: 0, subagent: 0, compactor: 0, import: 0 } };
  assert.deepEqual(chart({ step: 'hour', bars: [{ start: '2026-11-16T23:00:00.000Z', ...nothing }, { start: '2026-11-17T00:00:00.000Z', ...nothing }] }, 'en-GB', 'UTC').ends, ['16 Nov, 23:00', '17 Nov, 00:00']);
  assert.deepEqual(chart(usage(work, 'All time', NOW), 'en-GB', 'UTC').ends, ['27 Oct', '16 Nov']);
  // The night the clocks go back an hour comes twice (here 01:00 to 02:00 in New York, at 05:00 and at 06:00 UTC): the bars go on
  // through both, five minutes each, and an answer in the second is in its own bar, not in the first hour's.
  const night = createProfile(home, 'night'), at = (time: string) => `2026-11-01T${time}:00.000Z`;
  const spent = (date: string) => `${JSON.stringify({ date, role: 'main', model: 'claude-opus-5-5', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, total: 1 } } })}\n`;
  writeFileSync(join(night, 'usage.jsonl'), [at('05:50'), at('06:35')].map(spent).join(''));
  process.env.TZ = 'America/New_York';
  try {
    assert.deepEqual(usage(night, 'Last hour', Date.parse(at('06:45'))).bars.map(bar => [bar.start.slice(11, 16), bar.tokens]),
      [['05:50', 2], ...['05:55', '06:00', '06:05', '06:10', '06:15', '06:20', '06:25', '06:30'].map(time => [time, 0]), ['06:35', 2], ['06:40', 0], ['06:45', 0]]);
    // Where the clocks go forward at midnight (Santiago, 6 September) that day begins at one, and the next at midnight again:
    // an answer half an hour into the 7th is the 7th's.
    process.env.TZ = 'America/Santiago';
    const spring = createProfile(home, 'spring');
    writeFileSync(join(spring, 'usage.jsonl'), ['2026-09-04T16:00:00.000Z', '2026-09-07T03:30:00.000Z'].map(spent).join(''));
    assert.deepEqual(usage(spring, 'Last 7 days', Date.parse('2026-09-08T12:00:00.000Z')).bars.map(bar => [bar.start.slice(5, 16), bar.tokens]), [['09-04T04:00', 2], ['09-05T04:00', 0], ['09-06T04:00', 0], ['09-07T03:00', 2], ['09-08T03:00', 0]]);
  } finally { process.env.TZ = 'UTC'; }
  const [main, subagents] = breakdown(today);
  assert.deepEqual([main.name, main.cost, main.share, main.out, main.cached, subagents.name, subagents.cost, subagents.share, subagents.out, subagents.cached], ['Main chat', '$0.31', '34%', '3.9k', '98%', 'Subagents', '$0.55', '60%', '11.8k', '90%']);
});

test('the server reads a profile\'s ledger without writing to it, and the page keeps what it said', { timeout: 30_000 }, async t => {
  createProfile(home, 'new');
  const server = await startServer({ home, cwd: home, now: () => NOW }), client = await connect(server.url), before = [readFileSync(ledger, 'utf8'), statSync(ledger).mtimeMs];
  t.after(async () => { client.close(); await server.close(); });
  const week = await client.request('usage', { profile: 'work', range: 'Last 7 days' });
  assert.deepEqual(week, usage(work, 'Last 7 days', NOW));
  assert.equal(headline(week), terminal['Last 7 days'].said);
  // A profile that has used nothing yet, which has no ledger.
  const none = await client.request('usage', { profile: 'new' });
  assert.deepEqual([none.range, none.usage.totalTokens, none.cached, none.roles, none.bars, none.warnings], ['Today', 0, 0, [], [], []]);
  await assert.rejects(client.request('usage', { profile: 'work', range: 'This session' }), /^Error: No usage range named This session: there are Last hour, Today, Last 7 days, All time\.$/);
  await assert.rejects(client.request('usage', { profile: 'nobody' }), /No profile named nobody\./);
  assert.deepEqual([readFileSync(ledger, 'utf8'), statSync(ledger).mtimeMs], before);

  const app = new App({ storage: () => ({ getItem: () => null, setItem: () => {} }) });
  t.after(() => app.close());
  await app.start(server.url);
  await app.readUsage('work', 'All time');
  assert.equal(headline(app.state.usage.work), terminal['All time'].said);
});
