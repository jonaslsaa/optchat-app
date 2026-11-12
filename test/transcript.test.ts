import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Message, PiRecord } from '../src/protocol.ts';
import { apply, chat, idle, logged, merged, parts, replay, spoken, stopped, without, type Item, type PiMessage } from '../src/ui/transcript.ts';

const T = Date.UTC(2026, 0, 1), at = (seconds: number) => new Date(T + seconds * 1000).toISOString();
const user = (seconds: number, text: string): PiMessage => ({ role: 'user', timestamp: T + seconds * 1000, content: [{ type: 'text', text }] });
const reply = (seconds: number, ...content: object[]): PiMessage => ({ role: 'assistant', timestamp: T + seconds * 1000, content, stopReason: 'stop' });
const text = (text: string) => ({ type: 'text', text }), bash = (id: string, command: string) => ({ type: 'toolCall', id, name: 'bash', arguments: { command } });
const result = (seconds: number, output: string): PiMessage => ({ role: 'toolResult', timestamp: T + seconds * 1000, toolName: 'bash', content: [{ type: 'text', text: output }] });
const ended = (message: PiMessage): PiRecord => ({ type: 'message_end', message });
const update = (assistantMessageEvent: object): PiRecord => ({ type: 'message_update', assistantMessageEvent });
const run = (...records: PiRecord[]) => records.reduce((live, record, index) => apply(live, record, index + 1), idle());
const shown = (items: Item[]) => items.map(item => [item.key, item.kind, item.text]);
const entry = (i: number, kind: Message['kind'], seconds: number, text: string): Message => ({ i, kind, date: at(seconds), text });

test('a reply is the same items under the same keys while it streams, when it has ended, and once it is in the log', () => {
  // The log has 40 entries already; what the run says is numbered on from there, as the log will number it.
  const earlier = logged([entry(38, 'user', -9, 'hello'), entry(39, 'talk', -8, 'Hello.')]);
  const asked = [{ type: 'agent_start' }, ended(user(1, 'list the files'))];
  const streaming = run(...asked, { type: 'message_start', message: reply(2) },
    update({ type: 'text_start', contentIndex: 0 }), update({ type: 'text_delta', contentIndex: 0, delta: 'Loo' }), update({ type: 'text_delta', contentIndex: 0, delta: 'king' }),
    update({ type: 'toolcall_start', contentIndex: 1, id: 'c1', toolName: 'bash' }));
  assert.deepEqual(chat(earlier, streaming).slice(2).map(item => [item.key, item.kind, item.text, item.streaming]), [
    [40, 'user', 'list the files', undefined], [41, 'talk', 'Looking', true], [42, 'tool', 'bash {}', true],
  ]);

  const messages = [reply(2, text('Looking'), bash('c1', 'ls')), result(3, 'a.ts\nb.ts'), reply(4, text('Two files.'))];
  const done = run(...asked, ...messages.map(ended), { type: 'agent_settled' });
  const whole = [[40, 'user', 'list the files'], [41, 'talk', 'Looking'], [42, 'tool', 'bash {"command":"ls"}'], [43, 'echo', 'bash: a.ts\nb.ts'], [44, 'talk', 'Two files.']];
  assert.deepEqual(shown(chat(earlier, done)).slice(2), whole);

  // pi-optchat logs the run as it goes: whatever the log has is shown from the log, and the rest from the run, once each.
  const log = [entry(40, 'user', 1, 'list the files'), entry(41, 'talk', 2, 'Looking'), entry(42, 'tool', 2, 'bash {"command":"ls"}'), entry(43, 'echo', 3, 'bash: a.ts\nb.ts'), entry(44, 'talk', 4, 'Two files.')];
  for (const length of [0, 1, 3, 4, 5]) assert.deepEqual(shown(chat([...earlier, ...logged(log.slice(0, length))], done)).slice(2), whole, `${length} entries logged`);
  // The log does not name a tool call, and what a running call has printed goes by its name: the run gives the logged call its name.
  const calling = run(...asked, ended(messages[0]), { type: 'tool_execution_update', toolCallId: 'c1', partialResult: { content: [text('a.ts')] } });
  assert.deepEqual(chat(logged(log.slice(0, 3)), calling).map(item => item.call), [undefined, undefined, 'c1']);
  assert.deepEqual(calling.tools, { c1: 'a.ts' });
  // A connected window's conversation is not in the log: its items are numbered by their place in it.
  assert.deepEqual(shown(chat(spoken([user(1, 'list the files'), messages[0]]), done)), whole.map(([key, ...rest]) => [Number(key) - 40, ...rest]));
});

test('a turn as real Pi writes it in RPC mode shows while it streams: text as it grows, a tool call by name before its arguments', () => {
  // test/pi-turn.jsonl is Pi 1.5.2's own output for one turn with a tool call, without its token counts and system prompt.
  const records: PiRecord[] = readFileSync(join(import.meta.dirname, 'pi-turn.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const seen: string[] = [];
  let live = idle();
  for (const [index, record] of records.entries()) {
    live = apply(live, record, index + 1);
    const last = chat([], live).at(-1), line = last && `${last.kind}${last.streaming ? ' (streaming)' : ''}: ${last.text}`;
    if (line && line !== seen.at(-1)) seen.push(line);
  }
  assert.deepEqual(seen, [
    'user: Use the bash tool to run: echo hi. Then reply with: done counting to five, one two three four five.',
    'talk (streaming): I\'ll run the command',
    'talk (streaming): I\'ll run the command first.',
    'tool (streaming): bash {}',
    'tool (streaming): bash {"…":"{\\"command\\": \\"echo"}',
    'tool (streaming): bash {"…":"{\\"command\\": \\"echo hi"}',
    'tool (streaming): bash {"…":"{\\"command\\": \\"echo hi\\", \\"timeout\\": null"}',
    'tool (streaming): bash {"command":"echo hi","timeout":null}',
    'tool: bash {"command":"echo hi","timeout":null}',
    'echo: bash: hi\n',
    'talk (streaming): done counting to five, one two',
    'talk (streaming): done counting to five, one two three four five.',
    'talk: done counting to five, one two three four five.',
  ]);
  assert.equal(live.running, false);
});

test('a client that connects late gets the state of one that saw every record', () => {
  const status = { type: 'extension_ui_request', method: 'setStatus', statusKey: 'optchat', statusText: 'OptChat: work · 3 messages' };
  const answered = { type: 'extension_ui_request', id: 'd0', method: 'confirm', title: 'Sure?' }, asked = { type: 'extension_ui_request', id: 'd1', method: 'confirm', title: 'Go on?' };
  // Pi started and set its status, an earlier run came and went, and the latest run asked twice; the first was answered.
  const earlier = [status, { type: 'agent_start' }, ended(user(1, 'hi')), { type: 'agent_settled' }];
  const latest = [{ type: 'agent_start' }, answered, ended(user(2, 'hello')), asked, { type: 'queue_update', steering: ['and this'], followUp: [] }];
  const there = without(run(...earlier, ...latest), 'd0');

  // The server keeps the latest run's records, and apart from them what stands now: the status, and the dialog still open.
  const kept = latest.map((record, index) => ({ seq: earlier.length + index + 1, record }));
  const late = replay({ ui: [status, asked], records: kept }, there.seq);
  assert.deepEqual(late, there);
  assert.deepEqual([late.running, late.dialogs, late.queued.steering], [true, [asked], ['and this']]);
  // Its Pi died in the run: what it said stays, and nothing runs or is asked any more.
  assert.partialDeepStrictEqual(stopped(late), { seq: there.seq, running: false, dialogs: [], messages: [user(2, 'hello')] });
});

test('the chat is drawn in parts: your message with its images, a report by its agent, and a reply as its work and then its answer', () => {
  const items = chat(logged([entry(0, 'note', 0, 'Prefers short answers.'), entry(1, 'user', 0, 'look at this [image 0123456789abcdef]'), entry(2, 'work', 0, '[1a2b3c4d] **Done.** All green.'), entry(3, 'work', 0, 'A report without a name')]), run({ type: 'agent_start' },
    ended(user(1, 'check both')),
    ended(reply(2, text('On it.'), bash('c1', 'one'), bash('c2', 'two'))), ended(result(3, 'first')), ended(result(4, 'Error: no such file')),
    ended(reply(5, text('One failed.'))),
    ended(user(6, 'and again')),
    ended({ ...reply(7, bash('c3', 'three')), stopReason: 'aborted' }),
  ));
  assert.deepEqual(parts(items).map(({ items: _, ...part }) => part), [
    { key: 0, type: 'note', text: 'Prefers short answers.' },
    { key: 1, type: 'user', date: at(0), text: 'look at this', images: ['0123456789abcdef'] },
    { key: 2, type: 'work', date: at(0), agent: '1a2b3c4d', body: '**Done.** All green.' },
    { key: 3, type: 'work', date: at(0), body: 'A report without a name' },
    { key: 4, type: 'user', date: at(1), text: 'check both', images: [] },
    {
      key: 5, type: 'reply', from: at(2), to: at(5), stopped: false, answer: { text: 'One failed.' },
      steps: [
        { key: 5, type: 'talk', text: 'On it.' },
        { key: 6, type: 'tool', name: 'bash', args: { command: 'one' }, call: 'c1', output: 'first', failed: false },
        { key: 7, type: 'tool', name: 'bash', args: { command: 'two' }, call: 'c2', output: 'Error: no such file', failed: true },
      ],
    },
    { key: 11, type: 'user', date: at(6), text: 'and again', images: [] },
    {
      key: 12, type: 'reply', from: at(7), to: at(7), stopped: true,
      steps: [{ key: 12, type: 'tool', name: 'bash', args: { command: 'three' }, call: 'c3', failed: false }, { key: 13, type: 'fault', text: 'Agent aborted: No further details' }],
    },
  ]);
});

test('while a reply streams only its own part is made again, so the chat above it is not drawn again', () => {
  const before = logged([entry(0, 'user', -9, 'hello'), entry(1, 'talk', -8, 'Hello.'), entry(2, 'user', -7, 'more'), entry(3, 'talk', -6, 'More.')]);
  const asked = [{ type: 'agent_start' }, ended(user(1, 'go on')), { type: 'message_start', message: reply(2) }, update({ type: 'text_start', contentIndex: 0 })];
  const first = parts(chat(before, run(...asked, update({ type: 'text_delta', contentIndex: 0, delta: 'So' }))));
  const second = parts(chat(before, run(...asked, update({ type: 'text_delta', contentIndex: 0, delta: 'So far' }))), first);
  assert.deepEqual(second.map((part, index) => part === first[index]), [true, true, true, true, true, false]);
  // The log read again says the same, in new objects: nothing is made again.
  const read = () => logged([entry(0, 'user', -9, 'hello'), entry(1, 'talk', -8, 'Hello.')]), once = parts(read());
  assert.deepEqual(parts(read(), once).map((part, index) => part === once[index]), [true, true]);
  assert.partialDeepStrictEqual(second.at(-1), { type: 'reply', answer: { text: 'So far', streaming: true } });
});

test('pages of the log join by their entries\' numbers, whichever order they arrive in and however they overlap', () => {
  const page = (from: number, to: number) => Array.from({ length: to - from }, (_, n) => entry(from + n, 'talk', from + n, `message ${from + n}`));
  const numbers = (entries: Message[]) => entries.map(entry => entry.i);
  const newest = merged([], page(6, 10));
  assert.deepEqual(numbers(merged(newest, page(2, 6))), [2, 3, 4, 5, 6, 7, 8, 9]);
  // The same older page twice, and the newest page again once the log has grown: nothing is doubled.
  assert.deepEqual(numbers(merged(merged(newest, page(2, 6)), page(2, 6))), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(numbers(merged(newest, page(8, 12))), [6, 7, 8, 9, 10, 11]);
  // The log grew by more than a page while nobody read it: what was loaded no longer reaches the newest page, and is let go.
  assert.deepEqual(numbers(merged(newest, page(15, 18))), [15, 16, 17]);
});
