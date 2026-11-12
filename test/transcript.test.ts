import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Message, PiRecord } from '../src/protocol.ts';
import { act, apply, chat, failure, idle, logged, merged, news, parts, replay, spoken, stopped, took, without, type Item, type PiMessage, type Tool } from '../src/ui/transcript.ts';

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

test('a report is named by the title its agent was started under, once the chat reaches back to that start', () => {
  const start = [
    entry(0, 'tool', 0, 'spawn {"tasks":[{"title":"Why it flakes","task":"Look."},{"task":"No title."},{"title":"How T3 Code retries","task":"Read."}]}'),
    entry(1, 'echo', 1, 'spawn: Started: 1a2b3c4d, 22222222, 5e6f7a8b. Reports will arrive automatically.'),
  ];
  const reports = [entry(2, 'work', 2, '[5e6f7a8b] Capped at five seconds.'), entry(3, 'work', 3, '[22222222] Done.'), entry(4, 'work', 4, '[1a2b3c4d] A timer.')];
  // The page of the log with the reports is read first, and they go by their agents' numbers.
  const late = parts(logged(reports));
  assert.deepEqual(late.map(part => part.type === 'work' && [part.agent, part.title]), [['5e6f7a8b', undefined], ['22222222', undefined], ['1a2b3c4d', undefined]]);
  const whole = parts(logged([...start, ...reports]), late);
  assert.deepEqual(whole.slice(1).map(part => part.type === 'work' && part.title), ['How T3 Code retries', undefined, 'Why it flakes']);
  // Only the reports that got a title are made again, and none of them a second time.
  assert.deepEqual(whole.slice(1).map((part, at) => part === late[at]), [false, true, false]);
  assert.deepEqual(parts(logged([...start, ...reports]), whole).map((part, at) => part === whole[at]), [true, true, true, true]);
  // pi-optchat writes the title in front of the report itself, and under it a line for the main agent, which is no part of it.
  assert.partialDeepStrictEqual(parts(logged([entry(0, 'work', 0, '[1a2b3c4d · Read the notes] The answer is 42.\n\nFull chat: zoom("1a2b3c4d")')])),
    [{ type: 'work', agent: '1a2b3c4d', title: 'Read the notes', body: 'The answer is 42.' }]);
});

test('a tool call is said in words: what it did or is doing, and to what', () => {
  const call = (name: string, args: Record<string, unknown>, output?: string): Tool => ({ key: 0, type: 'tool', name, args, failed: false, ...output !== undefined && { output } });
  assert.deepEqual(act(call('bash', { command: 'npm test' }, 'ok'), false), { verb: 'Ran', subject: 'npm test', detail: [] });
  assert.deepEqual(act(call('bash', { command: 'npm test', timeout: null }), true), { verb: 'Running', subject: 'npm test', detail: [] });
  assert.deepEqual(act(call('read', { path: 'src/client.ts', offset: 40, limit: 60 }, '…'), false), { verb: 'Read', subject: 'src/client.ts, lines 40–99', detail: [] });
  assert.deepEqual(act(call('grep', { path: 'src', pattern: 'retry' }, ''), false), { verb: 'Searched for', subject: 'retry in src', detail: [] });
  assert.deepEqual(act(call('spawn', { tasks: [{ title: 'Why it flakes', task: 'Look.' }] }, 'Started: 1a2b3c4d.'), false), { verb: 'Started an agent:', subject: 'Why it flakes', detail: [{ text: 'Why it flakes\nLook.' }] });
  assert.partialDeepStrictEqual(act(call('spawn', { tasks: [{ title: 'One', task: '…' }, { title: 'Two', task: '…' }] }), true), { verb: 'Starting 2 agents:', subject: 'One, Two' });
  // OptChat's own tools are said in words too. A tool the app does not know goes by its name.
  assert.deepEqual(act(call('zoom', { n: 4, id: 128 }, '…'), false), { verb: 'Looked back at', subject: '128+4', detail: [] });
  assert.deepEqual(act(call('tell', { message: 'Stop there.', id: '1a2b3c4d' }, 'Sent.'), false), { verb: 'Told', subject: '1a2b3c4d', detail: [{ text: 'Stop there.' }] });
  assert.deepEqual(act(call('fetch', { url: 'https://pi.dev' }, '…'), false), { verb: 'fetch', subject: 'https://pi.dev', detail: [] });
});

test('an opened tool call shows what its line does not say, and no JSON for a call the app knows', () => {
  const shown = (name: string, args: Record<string, unknown>) => act({ key: 0, type: 'tool', name, args, failed: false, output: '' }, false).detail;
  // An edit is the lines it took out and put in, one edit after the other. A line break at its end is a line too.
  assert.deepEqual(shown('edit', { path: 'a.ts', edits: [{ oldText: 'let a = 1;\nlet b;', newText: 'const a = 1;' }, { oldText: 'unused();\n', newText: '' }] }), [
    { change: 'removed', text: '− let a = 1;\n− let b;' }, { change: 'added', text: '+ const a = 1;' }, { text: '…' }, { change: 'removed', text: '− unused();\n− ' },
  ]);
  assert.deepEqual(shown('write', { path: 'notes.md', content: '# Notes\n\nOne.\n' }), [{ text: '# Notes\n\nOne.\n' }]);
  // A command is said by its line, unless it is more than a line: then the line has its first.
  assert.deepEqual(act({ key: 0, type: 'tool', name: 'bash', args: { command: 'cd src\nls' }, failed: false, output: '' }, false), { verb: 'Ran', subject: 'cd src …', detail: [{ text: 'cd src\nls' }] });
  // What the line leaves out of a call is shown as it was given.
  assert.deepEqual(shown('grep', { pattern: 'retry', glob: '*.ts', limit: null }), [{ text: '{\n  "pattern": "retry",\n  "glob": "*.ts"\n}' }]);
});

test('how long a reply took is said in hours past an hour', () => {
  const after = (seconds: number) => took('2026-01-01T00:00:00Z', new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString());
  assert.deepEqual([42, 185, 4503].map(after), ['42s', '3m 05s', '1h 15m']);
});

test('a tool call that failed is marked so', () => {
  // That a command failed is read off what Pi's bash adds under its output.
  const ran = (output: string) => parts(logged([entry(0, 'tool', 0, 'bash {"command":"npm test"}'), entry(1, 'echo', 1, `bash: ${output}`)]))[0];
  assert.partialDeepStrictEqual(ran('✖ one test\n\nCommand exited with code 1'), { steps: [{ failed: true }] });
  assert.partialDeepStrictEqual(ran('Command exited with code 1 is what I grep for\nfound'), { steps: [{ failed: false }] });
  const read = parts(logged([entry(0, 'tool', 0, 'read {"path":"ci.log"}'), entry(1, 'echo', 1, 'read: ✖ one test\n\nCommand exited with code 1')]))[0];
  assert.partialDeepStrictEqual(read, { steps: [{ failed: false }] }); // A file that says so was read all right.
});

test('pi-optchat\'s status line and Pi\'s failures are said as news, not as they were written for a terminal', () => {
  assert.deepEqual(news('OptChat: work · 350 messages · 0 pending · 0 agents'), []);
  assert.deepEqual(news('OptChat: work · 350 messages · 3 pending · 1 agents · importing'), ['3 summaries to write', '1 agent working', 'importing']);
  assert.deepEqual(news('OptChat: work · connected window · main window not reachable'), ['main window not reachable']);
  assert.deepEqual([news('OptChat: work · completed'), news('OptChat: choose profile'), news(undefined)], [[], [], []]);

  assert.deepEqual(failure('Pi exited (code 3). out of memory'), { title: 'Pi stopped', detail: 'Pi exited with code 3: out of memory', next: 'Your next message starts it again.' });
  assert.deepEqual(failure('Profile already running: work · PID 812 · macbook · /Users/me/code'),
    { title: 'work is running outside the app', detail: 'A Pi in a terminal has it open: PID 812 on macbook, in /Users/me/code.', next: 'Close it there, then send your message again.' });
  assert.partialDeepStrictEqual(failure('pi-optchat did not open the profile.'), { title: 'Pi is not running', detail: 'pi-optchat did not open the profile.' });
});

test('Complete\'s handoff is a part of its own under the conversation, and not the answer to what you asked', () => {
  const asks: PiMessage = { role: 'custom', customType: 'optchat-handoff-request', display: false, timestamp: T + 9000, content: '[OptChat] This connected conversation has ended.' };
  const conversation = [user(1, 'what is the port?'), reply(2, bash('c1', 'grep port')), result(3, '8080'), reply(4, text('It is 8080.'))];
  const kinds = (items: Item[]) => parts(items).map(part => [part.type, part.type === 'reply' ? part.answer?.text : part.type === 'handoff' ? part.body : undefined]);
  const answered = ['user', undefined], reply4 = ['reply', 'It is 8080.'];

  // While the agent writes it, the handoff is there with nothing in it, and the answer above it is as it was.
  const asked = run({ type: 'agent_start' }, ended(asks));
  assert.deepEqual(kinds(chat(spoken(conversation), asked)), [answered, reply4, ['handoff', '']]);
  const writing = apply(apply(asked, { type: 'message_start', message: reply(10) }, 3), update({ type: 'text_delta', contentIndex: 0, delta: 'Goal: the' }), 4);
  assert.deepEqual(kinds(chat(spoken(conversation), writing)), [answered, reply4, ['handoff', '']]);
  // Written, it reads the same from the run, from the window's Pi, and from both when the Pi was asked in the middle of it.
  const handoff = reply(10, text('Goal: the port.'), text('Done: it is 8080.')), whole = [answered, reply4, ['handoff', 'Goal: the port.\n\nDone: it is 8080.']];
  const done = run({ type: 'agent_start' }, ended(asks), ended(handoff), { type: 'agent_settled' });
  for (const session of [conversation, [...conversation, asks], [...conversation, asks, handoff]]) assert.deepEqual(kinds(chat(spoken(session), done)), whole);
  // A handoff that did not end on its text is none: the main chat writes it then.
  assert.deepEqual(kinds(spoken([...conversation, asks, reply(10, text('Let me check first.'), bash('c2', 'ls')), result(11, 'a.ts'), { ...reply(12), stopReason: 'error' }])).at(-1), ['handoff', '']);
  assert.deepEqual(kinds(spoken([...conversation, asks, reply(10, bash('c2', 'ls'), text('Checking first.'))])).at(-1), ['handoff', '']);
  // Your next message is a conversation again.
  assert.deepEqual(kinds(spoken([...conversation, asks, handoff, user(20, 'and the host?'), reply(21, text('localhost'))])), [...whole, answered, ['reply', 'localhost']]);

  // An answer in several blocks is one answer, and none of it is folded away with the work.
  assert.partialDeepStrictEqual(parts(spoken([user(1, 'and?'), reply(2, text('On it.'), bash('c1', 'ls')), result(3, 'a.ts'), reply(4, text('One file.'), text('It is a.ts.'))]))[1],
    { steps: [{ type: 'talk', text: 'On it.' }, { type: 'tool' }], answer: { text: 'One file.\n\nIt is a.ts.' } });

  // Complete stops a reply that is being written: what it had said by then stays in view, and is said to have been stopped.
  const cut = parts(spoken([user(1, 'what is the port?'), { ...reply(2, text('It is 80')), stopReason: 'aborted' }, asks, handoff]));
  assert.partialDeepStrictEqual(cut, [{ type: 'user' }, { type: 'reply', stopped: true, answer: { text: 'It is 80' }, steps: [{ type: 'fault' }] }, { type: 'handoff' }]);
});

test('a message says what pi-optchat would log, with an image named as one and a tool call by its id', () => {
  const picture = { type: 'image', data: 'aGk=', mimeType: 'image/png' };
  // A connected window's messages are drawn from Pi, not from the log: one that is only a picture is not an empty bubble.
  assert.deepEqual(spoken([{ role: 'user', timestamp: T, content: [picture] }]).map(item => [item.kind, item.text]), [['user', '[image]']]);
  assert.deepEqual(spoken([{ role: 'toolResult', timestamp: T, toolName: 'read', content: [text('a chart'), picture] }]).map(item => [item.kind, item.text]), [['echo', 'read: a chart\n[image]']]);
  assert.deepEqual(spoken([reply(1, text('Looking.'), bash('call-1', 'ls'), bash('call-2', 'pwd'))]).map(item => [item.kind, item.text, item.call]),
    [['talk', 'Looking.', undefined], ['tool', 'bash {"command":"ls"}', 'call-1'], ['tool', 'bash {"command":"pwd"}', 'call-2']]);
});
