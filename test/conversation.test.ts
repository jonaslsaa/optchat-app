import assert from 'node:assert/strict';
import { test } from 'node:test';
import { current } from '../src/ui/conversation.ts';
import type { PiMessage } from '../src/ui/transcript.ts';

/** A connected window's Pi as real Pi reports it (`get_messages`) once a conversation was completed and another begun. */
const message = (timestamp: number, role: string, text: string, more = {}): PiMessage => ({ role, timestamp, content: [{ type: 'text', text }], ...more });
const request = (timestamp: number) => message(timestamp, 'custom', '[OptChat] This connected conversation has ended', { customType: 'optchat-handoff-request', display: false });
const first = [message(1, 'system', ''), message(1, 'user', 'one?'), message(2, 'assistant', 'one'), request(3), message(4, 'assistant', 'Goal: the handoff')];
const second = [message(5, 'user', 'two?'), message(6, 'assistant', 'two')];
const texts = (messages: readonly PiMessage[]) => messages.map(({ content }) => JSON.stringify(content).match(/"text":"([^"]*)"/)?.[1]);

test('a connected window shows the conversation it is in, not the ones it completed', () => {
  // Completed: the finished conversation stays, with its handoff, while its own last run is all the page has heard since.
  assert.deepEqual(current(first, first.slice(3)), first);
  // Your next message begins a new conversation: it is in the run before the Pi is asked again, and the view starts empty.
  assert.deepEqual(current(first, [second[0]]), []);
  assert.deepEqual(texts(current([...first, ...second], second)), ['two?', 'two']);
  // And so on: completed again, then begun again.
  const twice = [...first, ...second, request(7), message(8, 'assistant', 'Goal: the second handoff')];
  assert.deepEqual(texts(current(twice, twice.slice(-2))), ['two?', 'two', '[OptChat] This connected conversation has ended', 'Goal: the second handoff']);
  assert.deepEqual(current(twice, [message(9, 'user', 'three?')]), []);
});
