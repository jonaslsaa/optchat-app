import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Message, PiRecord } from '../src/protocol.ts';
import { apply, chat, idle, logged, parts, replay, stopped, type Item, type PiMessage } from '../src/ui/transcript.ts';

const T = Date.UTC(2026, 0, 1), at = (seconds: number) => new Date(T + seconds * 1000).toISOString();
const user = (seconds: number, text: string): PiMessage => ({ role: 'user', timestamp: T + seconds * 1000, content: [{ type: 'text', text }] });
const reply = (seconds: number, ...content: object[]): PiMessage => ({ role: 'assistant', timestamp: T + seconds * 1000, content, stopReason: 'stop' });
const text = (text: string) => ({ type: 'text', text }), bash = (id: string, command: string) => ({ type: 'toolCall', id, name: 'bash', arguments: { command } });
const result = (seconds: number, output: string): PiMessage => ({ role: 'toolResult', timestamp: T + seconds * 1000, toolName: 'bash', content: [{ type: 'text', text: output }] });
const ended = (message: PiMessage): PiRecord => ({ type: 'message_end', message });
const run = (...records: PiRecord[]) => records.reduce((live, record, index) => apply(live, record, index + 1), idle());
const shown = (items: Item[]) => items.map(item => [item.key, item.kind, item.text]);
const entry = (i: number, kind: Message['kind'], seconds: number, text: string): Message => ({ i, kind, date: at(seconds), text });

test('a reply is the same items with the same keys while it streams, when it has ended, and once it is in the log', () => {
  const asked = [{ type: 'agent_start' }, ended(user(1, 'list the files'))];
  const update = (assistantMessageEvent: object): PiRecord => ({ type: 'message_update', assistantMessageEvent });
  const streaming = run(...asked, { type: 'message_start', message: reply(2) },
    update({ type: 'text_start', contentIndex: 0 }), update({ type: 'text_delta', contentIndex: 0, delta: 'Loo' }), update({ type: 'text_delta', contentIndex: 0, delta: 'king' }),
    update({ type: 'toolcall_start', contentIndex: 1, id: 'c1', toolName: 'bash' }));
  assert.deepEqual(chat([], streaming).map(item => [item.key, item.kind, item.text, item.streaming]), [
    [`${at(1)} 0`, 'user', 'list the files', undefined], [`${at(2)} 0`, 'talk', 'Looking', true], [`${at(2)} 1`, 'tool', 'bash {}', true],
  ]);

  const messages = [reply(2, text('Looking'), bash('c1', 'ls')), result(3, 'a.ts\nb.ts'), reply(4, text('Two files.'))];
  const done = run(...asked, ...messages.map(ended), { type: 'agent_settled' });
  const whole = [
    [`${at(1)} 0`, 'user', 'list the files'], [`${at(2)} 0`, 'talk', 'Looking'], [`${at(2)} 1`, 'tool', 'bash {"command":"ls"}'],
    [`${at(3)} 0`, 'echo', 'bash: a.ts\nb.ts'], [`${at(4)} 0`, 'talk', 'Two files.'],
  ];
  assert.deepEqual(shown(chat([], done)), whole);

  // pi-optchat logs the run as it goes: whatever the log has is shown from the log, and the rest from the run, once each.
  const log = [entry(0, 'user', 1, 'list the files'), entry(1, 'talk', 2, 'Looking'), entry(2, 'tool', 2, 'bash {"command":"ls"}'), entry(3, 'echo', 3, 'bash: a.ts\nb.ts'), entry(4, 'talk', 4, 'Two files.')];
  for (const length of [0, 1, 3, 4, 5]) assert.deepEqual(shown(chat(logged(log.slice(0, length)), done)), whole, `${length} entries logged`);
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

test('a client that connects late gets the same state from `records` as one that saw every record', () => {
  const status = { type: 'extension_ui_request', method: 'setStatus', statusKey: 'optchat', statusText: 'OptChat: work · 3 messages' };
  const dialog = { type: 'extension_ui_request', id: 'd1', method: 'confirm', title: 'Go on?' };
  // The run's records still have a dialog that was answered since; only `ui` says what is asked now.
  const answered = { type: 'extension_ui_request', id: 'd0', method: 'confirm', title: 'Sure?' };
  const records = [{ type: 'agent_start' }, answered, ended(user(1, 'hello')), { type: 'queue_update', steering: ['and this'], followUp: [] }].map((record, index) => ({ seq: index + 4, record }));
  const live = replay({ ui: [status, dialog], records }, 7);
  assert.partialDeepStrictEqual(live, { seq: 7, running: true, status: { optchat: 'OptChat: work · 3 messages' }, dialogs: [dialog], queued: { steering: ['and this'], followUp: [] } });
  assert.deepEqual(live.messages, [user(1, 'hello')]);
  // Its Pi died in the run: what it said stays, and nothing runs or is asked any more.
  assert.partialDeepStrictEqual(stopped(live), { seq: 7, running: false, dialogs: [], messages: [user(1, 'hello')] });
});

test('a reply is drawn as its work and then its answer: tool calls with their results in order, and what stopped it', () => {
  const items = chat([], run({ type: 'agent_start' },
    ended(user(1, 'check both')),
    ended(reply(2, text('On it.'), bash('c1', 'one'), bash('c2', 'two'))), ended(result(3, 'first')), ended(result(4, 'second')),
    ended(reply(5, text('Both fine.'))),
    ended(user(6, 'and again')),
    ended({ ...reply(7, bash('c3', 'three')), stopReason: 'aborted' }),
  ));
  const drawn = parts(items).map(part => part.type !== 'reply' ? part.item.text : {
    steps: part.steps.map(step => step.type === 'tool' ? [step.call.text, step.result?.text] : step.item.text), answer: part.answer?.text, from: part.from, to: part.to,
  });
  assert.deepEqual(drawn, [
    'check both',
    { steps: ['On it.', ['bash {"command":"one"}', 'bash: first'], ['bash {"command":"two"}', 'bash: second']], answer: 'Both fine.', from: at(2), to: at(5) },
    'and again',
    { steps: [['bash {"command":"three"}', undefined], 'Agent aborted: No further details'], answer: undefined, from: at(7), to: at(7) },
  ]);
});
