import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message, PiRecord } from '../src/protocol.ts';
import { apply, chat, idle, logged, parts, replay, type Item, type PiMessage } from '../src/ui/transcript.ts';

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
  const partial = { ...reply(2, text('Looking'), { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }), stopReason: 'pending' };
  const streaming = run(...asked, { type: 'message_start', message: reply(2) }, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, partial } });
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

test('a client that connects late gets the same state from `records` as one that saw every record', () => {
  const status = { type: 'extension_ui_request', method: 'setStatus', statusKey: 'optchat', statusText: 'OptChat: work · 3 messages' };
  const dialog = { type: 'extension_ui_request', id: 'd1', method: 'confirm', title: 'Go on?' };
  const records = [{ type: 'agent_start' }, ended(user(1, 'hello')), { type: 'queue_update', steering: ['and this'], followUp: [] }].map((record, index) => ({ seq: index + 5, record }));
  const live = replay({ ui: [status, dialog], records }, 7);
  assert.partialDeepStrictEqual(live, { seq: 7, running: true, status: { optchat: 'OptChat: work · 3 messages' }, dialogs: [dialog], queued: { steering: ['and this'], followUp: [] } });
  assert.deepEqual(live.messages, [user(1, 'hello')]);
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
