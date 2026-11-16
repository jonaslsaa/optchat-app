import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { working } from '../src/agent.ts';
import { connect } from '../src/client.ts';
import type { Agent, PiRecord, Push, Result, Setup } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { PROMPT } from '../src/server/windows.ts';
import { transcript } from '../src/ui/agents.ts';
import { apply, chat, idle, isMessage, isObject, logged, parts, words, type Live, type Part } from '../src/ui/transcript.ts';
import { current } from '../src/window.ts';
import { createProfile, png, temporaryHome } from './support.ts';

/** `npm run test:live`: real turns through the installed Pi with pi-optchat, on throwaway profiles. It needs Pi logged in to
 * Anthropic and costs about a cent. Pi keeps no session file, and the real ~/.optchat is never opened.
 * `PI_OPTCHAT=<a pi-optchat checkout>` runs that pi-optchat in place of the one installed in Pi. */
const checkout = process.env.PI_OPTCHAT;
const flags = [...checkout ? ['--no-extensions', '-e', join(checkout, 'src/index.ts')] : [], '--no-session', '--model', 'anthropic/claude-haiku-5-5', '--thinking', 'off'];
/** Pi's records as they are pushed, and a wait for one. */
function watch() {
  const pushes: Push[] = [], waiting = new Set<() => void>();
  const record = (window: string, match: (record: PiRecord) => boolean, after = 0) => new Promise<Extract<Push, { push: 'record' }>>(resolve => {
    const check = () => {
      const found = pushes.find(push => push.push === 'record' && push.window === window && push.seq > after && match(push.record));
      if (found?.push === 'record') { waiting.delete(check); resolve(found); }
    };
    waiting.add(check); check();
  });
  return { pushes, record, onPush: (push: Push) => { pushes.push(push); for (const check of waiting) check(); } };
}
const said = (record: PiRecord, role: string) => record.type === 'message_end' && JSON.stringify(record.message).startsWith(`{"role":"${role}"`);

test('a real Pi turn on a throwaway profile, end to end through the WebSocket', { timeout: 120_000 }, async t => {
  const home = temporaryHome(), profile = createProfile(home, 'live');
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), flags });
  t.after(() => server.close());
  assert.deepEqual(await (await connect(server.url)).request('history', { profile: 'live' }), { total: 0, messages: [] });

  const pushes: Push[] = [];
  let settled = () => {};
  const done = new Promise<void>(resolve => { settled = resolve; });
  const client = await connect(server.url, push => { pushes.push(push); if (push.push === 'record' && push.record.type === 'agent_settled') settled(); });
  const { window } = await client.request('open', { profile: 'live' });
  assert.equal(existsSync(join(profile, 'lock.sock')), false, 'no Pi holds the profile before the first prompt');
  assert.deepEqual(await client.request('prompt', { window: window.id, text: 'Reply with exactly this word and nothing else: pong' }), { disposition: 'started' });
  await done;

  // Pi's own records came through: pi-optchat opened the profile, and the reply streamed and ended.
  const records = pushes.flatMap(push => push.push === 'record' ? [push.record] : []);
  assert.ok(records.some(r => r.type === 'extension_ui_request' && r.method === 'setStatus' && String(r.statusText).startsWith('OptChat: live')));
  assert.ok(records.some(r => r.type === 'message_update'));
  assert.ok(records.some(r => r.type === 'message_end' && /"role":"assistant".*pong/.test(JSON.stringify(r))));
  assert.deepEqual(pushes.flatMap(push => push.push === 'window' ? [push.window.status] : []).filter((status, k, all) => status !== all[k - 1]), ['stopped', 'starting', 'idle', 'running', 'idle']);

  // The turn is in the profile's memory, written by Pi and read by the app from disk.
  const { messages } = await client.request('history', { profile: 'live' });
  assert.deepEqual(messages.map(m => [m.kind, m.text]), [['user', 'Reply with exactly this word and nothing else: pong'], ['talk', 'pong']]);
  // The UI shows a run from Pi's records until it is logged: both must read the same, down to the dates the two are joined by.
  // And the reply is there while Pi still writes it: its text shows before the message has ended.
  const pushed = pushes.flatMap(push => push.push === 'record' ? [push] : []);
  const ending = pushed.findIndex(push => said(push.record, 'assistant'));
  const writing = pushed.slice(0, ending).reduce((live, push) => apply(live, push.record, push.seq), idle());
  assert.partialDeepStrictEqual(chat([], writing).at(-1), { kind: 'talk', text: 'pong', streaming: true });
  const run = pushed.reduce((live, push) => apply(live, push.record, push.seq), idle());
  assert.deepEqual(chat([], run).map(({ kind, text, date }) => ({ kind, text, date })), messages.map(({ kind, text, date }) => ({ kind, text, date })));
  assert.equal(chat(logged(messages), run).length, messages.length);
  // Your message is in the chat from when it is sent (`Live.sent`): Pi's own copy of it took its place, so it is there once.
  const sent = { role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: 'Reply with exactly this word and nothing else: pong' }] };
  const shown = pushed.reduce<Live>((live, push) => apply(live, push.record, push.seq), { ...idle(), sent });
  assert.deepEqual([shown.sent, chat([], shown).filter(item => item.kind === 'user').length], [undefined, 1]);
  // The memory view of that turn, as Pi's files have it: a line for each message, and under a line the message as it was said.
  const view = await client.request('view', { profile: 'live' });
  assert.deepEqual(view.lines, messages.map(({ i, kind, text, date }) => ({ id: i, n: 1, text: `${kind}: ${text}`, from: date, to: date })));
  assert.ok(view.total === 2 && view.size > 0 && view.size < view.budget);
  assert.deepEqual((await client.request('original', { profile: 'live', id: 1 })).messages, [messages[1]]);
  // And a search of it, which finds what was said in any case, newest first.
  assert.deepEqual((await client.request('search', { profile: 'live', text: 'PONG' })).hits.map(hit => [hit.id, hit.match]), [[1, 'pong'], [0, 'pong']]);

  // The model the chat runs on is Pi's word, and so is the list it is picked from. A pick goes to Pi, which takes the nearest
  // level the model has, and pi-optchat keeps it in the profile; Pi's own settings are no business of it.
  const model = () => pushes.findLast(push => push.push === 'window')?.window.model;
  assert.deepEqual(model(), { provider: 'anthropic', model: 'claude-haiku-5-5', thinking: 'off' });
  const { models, preset } = await client.request('models', { window: window.id });
  assert.equal(preset, undefined);
  assert.deepEqual(models.find(model => model.provider === 'anthropic' && model.id === 'claude-haiku-5-5'), { provider: 'anthropic', id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] });
  await client.request('setModel', { window: window.id, model: { provider: 'anthropic', model: 'claude-haiku-5-5', thinking: 'minimal' } });
  assert.deepEqual(model(), { provider: 'anthropic', model: 'claude-haiku-5-5', thinking: 'low' });
  assert.deepEqual(JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')).main, model());

  // A second client finds the window and its run; closing the server lets Pi release the profile.
  const second = await connect(server.url);
  assert.partialDeepStrictEqual((await second.request('windows', {})).windows, [{ id: 'live/main', status: 'idle' }]);
  assert.equal((await second.request('records', { window: window.id })).records[0].record.type, 'agent_start');
  assert.equal(existsSync(join(profile, 'lock.sock')), true);
  await server.close();
  assert.equal(existsSync(join(profile, 'lock.sock')), false);
});

test('pi-optchat does not take a message for a profile whose import is paused: it says why, and answers that it dealt with it', { timeout: 60_000 }, async t => {
  const home = temporaryHome(), profile = createProfile(home, 'live'), id = '11111111-2222-3333-4444-555555555555';
  // What pi-optchat leaves when an import is paused (its `imports/pending.json`).
  mkdirSync(join(profile, 'imports'));
  writeFileSync(join(profile, 'imports', 'pending.json'), JSON.stringify({ id, mode: 'append', previous: '.', target: `memories/${id}`, created: new Date().toISOString(), added: 0, skipped: 0, total: 0, inputBytes: 0 }));
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), flags });
  t.after(() => server.close());
  const { onPush, pushes, record } = watch(), client = await connect(server.url, onPush);
  const { window } = await client.request('open', { profile: 'live' });
  assert.deepEqual(await client.request('prompt', { window: window.id, text: 'Hello there' }), { disposition: 'handled' });
  await record(window.id, r => r.method === 'notify' && String(r.message).startsWith('This profile has an import in progress'));
  // The page shows it, and no run began: the message was not taken.
  const live = pushes.reduce((live, push) => push.push === 'record' ? apply(live, push.record, push.seq) : live, idle());
  assert.partialDeepStrictEqual(live.notices.at(-1), { kind: 'info' });
  assert.equal(pushes.some(push => push.push === 'record' && push.record.type === 'agent_start'), false);
  assert.deepEqual((await client.request('history', { profile: 'live' })).messages, []);
});

test('asking a window for its commands starts its Pi and writes nothing to the profile\'s memory, nor does closing the window unused', { timeout: 120_000 }, async t => {
  const home = temporaryHome(), profile = createProfile(home, 'live'), cwd = mkdtempSync(join(home, 'cwd-'));
  // The profile's files with what is in them, without the sockets a Pi has while it runs.
  const files = (directory = profile): string[] => readdirSync(directory).flatMap(name => {
    const path = join(directory, name), stat = statSync(path);
    return stat.isDirectory() ? [`${name}/`, ...files(path).map(file => `${name}/${file}`)] : stat.isFile() ? [`${name}: ${readFileSync(path, 'utf8')}`] : [];
  });
  const asked = async () => {
    const server = await startServer({ home, cwd, flags });
    t.after(() => server.close()); // Whatever fails here, no Pi is left holding the profile.
    const { onPush, pushes } = watch(), client = await connect(server.url, onPush);
    const { window: main } = await client.request('open', { profile: 'live' });
    const { commands } = await client.request('commands', { window: main.id });
    const first = files();
    // A connected window is a second Pi, which tells the main one it is there: asked too, then closed without a message.
    const { window: side } = await client.request('open', { profile: 'live', role: 'connected' });
    const theirs = await client.request('commands', { window: side.id });
    await client.request('close', { window: side.id });
    await sleep(2000);
    const then = files(), { total } = await client.request('history', { profile: 'live' });
    client.close(); await server.close();
    return { commands, theirs: theirs.commands, first, then, total, ran: pushes.some(push => push.push === 'record' && push.record.type === 'agent_start') };
  };
  const once = await asked();
  // Pi's own list: pi-optchat's three commands among what else this Pi has, each with its kind.
  for (const list of [once.commands, once.theirs]) assert.deepEqual(['complete', 'tell-main', 'optchat'].map(name => list.find(command => command.name === name)?.source), ['extension', 'extension', 'extension']);
  // Opening a profile for the first time lays out its empty folders and lists, as a first message would. Nothing is said in
  // it: no message in its log, no run, and the window that came and went left nothing.
  assert.deepEqual([once.total, once.ran, once.first.filter(file => file.startsWith('main/'))], [0, false, ['main/']]);
  assert.deepEqual(once.then, once.first);
  // And on a profile that was opened before, nothing at all is written.
  const again = await asked();
  assert.deepEqual([again.first, again.then, again.total], [once.then, once.then, 0]);
});

test('an image sent with a message reaches the model, in the main chat and in a connected window, and the main chat\'s is the profile\'s', { timeout: 180_000 }, async t => {
  const home = temporaryHome();
  createProfile(home, 'live');
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), flags });
  t.after(() => server.close());
  const { pushes, record, onPush } = watch(), client = await connect(server.url, onPush);
  const ask = async (role: 'main' | 'connected', colour: [number, number, number]) => {
    const { window } = await client.request('open', { profile: 'live', role }), data = png(200, colour);
    await client.request('prompt', { window: window.id, text: 'What colour is this square? Answer with the one word.', images: [{ type: 'image', data: data.toString('base64'), mimeType: 'image/png' }] });
    await record(window.id, r => r.type === 'agent_settled');
    const replies = pushes.flatMap(push => push.push === 'record' && push.window === window.id && said(push.record, 'assistant') && isMessage(push.record.message) ? [words(push.record.message.content)] : []);
    return { data, reply: replies.at(-1) };
  };
  const main = await ask('main', [220, 40, 40]);
  assert.match(main.reply ?? '', /^red\.?$/i);
  // pi-optchat keeps it in the profile and names it in the log, which is where the chat draws it from.
  const [{ text }] = (await client.request('history', { profile: 'live' })).messages;
  const [, name] = /^What colour is this square\? Answer with the one word\.\n\[image ([0-9a-f]{16})\]$/.exec(text) ?? [];
  assert.deepEqual(Buffer.from(await (await fetch(`${server.page}images/live/${name}`)).arrayBuffer()), main.data);
  assert.match((await ask('connected', [40, 70, 220])).reply ?? '', /^blue\.?$/i);
});

test('a connected window reads the profile\'s memory, and Complete hands its conversation to the main chat', { timeout: 180_000 }, async t => {
  const home = temporaryHome(), sent = process.env.OPTCHAT_APP_SENT = join(home, 'sent.jsonl');
  createProfile(home, 'live');
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), flags: [...flags, '-e', join(import.meta.dirname, 'sent.ts')] });
  t.after(() => server.close());
  const { pushes, record, onPush } = watch(), client = await connect(server.url, onPush);
  const main = (await client.request('open', { profile: 'live' })).window.id;
  await client.request('prompt', { window: main, text: 'Remember: the secret word is "marzipan". Reply with exactly: noted' });
  await record(main, r => r.type === 'agent_settled');

  // A second Pi on the profile: it joins the first, and answers from the memory the main chat just wrote.
  const { window } = await client.request('open', { profile: 'live', role: 'connected' });
  await client.request('prompt', { window: window.id, text: 'What is the secret word from the main chat? Reply with just the word.' });
  assert.match(JSON.stringify((await record(window.id, r => said(r, 'assistant'))).record), /marzipan/);
  await record(window.id, r => r.type === 'agent_settled');
  const [connected] = (await client.request('windows', {})).windows.filter(w => w.id === window.id);
  assert.partialDeepStrictEqual(connected, { role: 'connected', status: 'idle' });
  // What the app asks of its agents is in the prompt the model was sent, beside pi-optchat's own: in both windows, every time.
  const requests = readFileSync(sent, 'utf8').trim().split('\n').map((line): { window: boolean; payload: { system?: unknown } } => JSON.parse(line));
  for (const [inWindow, optchat] of [[false, 'You are OptChat'], [true, 'You are a connected window of OptChat']] as const) {
    const prompts = requests.filter(request => request.window === inWindow).map(request => JSON.stringify(request.payload.system));
    assert.ok(prompts.length > 0 && prompts.every(prompt => prompt.includes(optchat) && prompt.includes(`<addendum>\\n${PROMPT}\\n</addendum>`)), `${optchat}: ${prompts[0]?.slice(0, 200)}`);
  }

  // Complete: the window writes its handoff, and the main chat gets it as that agent's report, in its memory.
  await client.request('complete', { window: window.id });
  assert.ok(pushes.some(push => push.push === 'window' && push.window.id === window.id && push.window.completed));
  const handoff = /\[[0-9a-f]{8}\] Connected conversation completed by user\./;
  const report = await record(main, r => said(r, 'custom') && handoff.test(JSON.stringify(r.message)));
  await record(main, r => r.type === 'agent_settled', report.seq);
  const { messages } = await client.request('history', { profile: 'live' });
  assert.ok(messages.some(m => m.kind === 'work' && handoff.test(m.text)), 'the handoff is in the profile\'s log');

  // The window is not spent: its next prompt begins a new conversation in the same Pi, which says so in its role.
  const again = (await client.request('windows', {})).windows.find(w => w.id === window.id)!.seq;
  await client.request('prompt', { window: window.id, text: 'Reply with exactly: here' });
  await record(window.id, r => r.type === 'agent_settled', again);
  const after = (await client.request('windows', {})).windows.find(w => w.id === window.id)!;
  assert.deepEqual([after.completed, after.status], [undefined, 'idle']);
  // Its Pi still has the conversation that was handed off; the window's is what came since.
  const kept = (await client.request('command', { window: window.id, command: { type: 'get_messages' } })).data;
  assert.ok(isObject(kept) && Array.isArray(kept.messages) && kept.messages.every(isMessage));
  assert.ok(kept.messages.some(message => /marzipan/.test(JSON.stringify(message))));
  assert.deepEqual(current(after, kept.messages).map(message => [message.role, words(message.content)]), [['user', 'Reply with exactly: here'], ['assistant', 'here']]);
});

test('a profile\'s settings are changed in its file while no Pi has it, and in the chat that is running once one does', { timeout: 120_000 }, async t => {
  const home = temporaryHome(), sent = process.env.OPTCHAT_APP_SENT = join(home, 'sent.jsonl'), profile = createProfile(home, 'live');
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), flags: [...flags, '-e', join(import.meta.dirname, 'sent.ts')] });
  t.after(() => server.close());
  const { record, onPush } = watch(), client = await connect(server.url, onPush);
  const kept = () => JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8'));
  /** The tools the model was offered in each request so far. */
  const offered = () => readFileSync(sent, 'utf8').trim().split('\n').map((line): string[] => JSON.parse(line).payload.tools.map((tool: { name: string }) => tool.name));
  const nowhere = { provider: 'anthropic', model: 'no-such-model', thinking: 'off' } as const, haiku = { ...nowhere, model: 'claude-haiku-5-5' };

  // No Pi has the profile: pi-optchat writes the file, and a model is kept as it is written, with no Pi there to know it.
  await client.request('configure', { profile: 'live', key: 'maxAgents', value: 3 });
  await client.request('configure', { profile: 'live', key: 'compactor', value: nowhere });
  assert.partialDeepStrictEqual(kept(), { maxAgents: 3, compactor: nowhere });
  await client.request('configure', { profile: 'live', key: 'compactor', value: haiku });

  const main = (await client.request('open', { profile: 'live' })).window.id;
  await client.request('prompt', { window: main, text: 'Reply with exactly this word and nothing else: one' });
  const first = await record(main, r => r.type === 'agent_settled'), before = offered();
  assert.ok(before.length > 0 && before.every(tools => tools.includes('zoom') && !tools.includes('search')), JSON.stringify(before));

  // The Pi that has the profile is told, and is the judge: it knows which models it has, which the file could not.
  await assert.rejects(client.request('configure', { profile: 'live', key: 'compactor', value: nowhere }), /^Error: compactor: anthropic\/no-such-model with thinking off is not offered by this Pi/);
  const changed = await client.request('configure', { profile: 'live', key: 'memorySearch', value: true });
  assert.equal(changed.settings.find(setting => setting.key === 'memorySearch')?.value, true);
  assert.partialDeepStrictEqual(kept(), { memorySearch: true, maxAgents: 3, compactor: haiku });
  // And the chat that is running has it, with no restart: its next turn offers the model the tool the setting turns on.
  await client.request('prompt', { window: main, text: 'Reply with exactly this word and nothing else: two' });
  await record(main, r => r.type === 'agent_settled', first.seq);
  assert.ok(offered().slice(before.length).every(tools => tools.includes('search')) && offered().length > before.length, JSON.stringify(offered()));
});

test('an agent the main chat starts is listed while it works and once it has reported, with its chat', { timeout: 180_000 }, async t => {
  const home = temporaryHome(), cwd = mkdtempSync(join(home, 'cwd-'));
  createProfile(home, 'live');
  writeFileSync(join(cwd, 'notes.txt'), 'the answer is 42\n');
  const server = await startServer({ home, cwd, flags });
  t.after(() => server.close());
  const client = await connect(server.url);
  const { window } = await client.request('open', { profile: 'live' });
  const task = 'Run `sleep 4` with bash, then read notes.txt, and report the answer in it.';
  await client.request('prompt', { window: window.id, text: `Use spawn to start ONE subagent titled "Read the notes" with exactly this task: "${task}" Then say only: started.` });

  // The list is read from the profile's files, again and again, as the page does: the agent is there at work, then done.
  const seen: Result<'agents'>['agents'] = [];
  while (seen.at(-1)?.state !== 'completed') {
    await new Promise(resolve => setTimeout(resolve, 250));
    const { agents } = await client.request('agents', { profile: 'live' });
    assert.ok(agents.length <= 1);
    if (agents[0] && JSON.stringify(agents[0]) !== JSON.stringify(seen.at(-1))) seen.push(agents[0]);
  }
  const { id } = seen[0], last = seen.at(-1)!;
  assert.deepEqual(seen.map(agent => agent.state).filter((state, k, all) => state !== all[k - 1]), ['running', 'completed']);
  assert.partialDeepStrictEqual(last, { id, title: 'Read the notes', task, doing: [] });
  assert.match(last.headline ?? '', /42/);
  // While it worked, the list said on what: the tool calls it was waiting on.
  assert.ok(seen.some(agent => agent.doing.some(call => call.name === 'bash' && call.args.command === 'sleep 4')), JSON.stringify(seen.map(agent => agent.doing)));

  // Its chat is its Pi session: the task alone first, its tool calls, and its last answer, which is what it reported.
  const { messages, report } = await client.request('agent', { profile: 'live', id });
  const own = messages.filter(isMessage);
  assert.partialDeepStrictEqual(own[0], { role: 'user', content: task });
  assert.ok(own.some(message => message.role === 'toolResult' && message.toolName === 'read' && words(message.content).includes('the answer is 42')));
  assert.equal(words(own.at(-1)?.content), report);
  assert.deepEqual(transcript({ messages: own, report }, true).at(-1)?.kind, 'talk');

  // And the main chat got the report, named by the agent and its title: the card that opens this chat.
  let reports: Part[] = [];
  while (!reports.length) {
    await new Promise(resolve => setTimeout(resolve, 250));
    reports = parts(logged((await client.request('history', { profile: 'live' })).messages)).filter(part => part.type === 'work');
  }
  assert.partialDeepStrictEqual(reports, [{ agent: id, title: 'Read the notes', body: report }]);
});

test('an agent is told, interrupted, resumed and stopped from the app, and an agent\'s own agent too while it works', { timeout: 300_000 }, async t => {
  const home = temporaryHome(), cwd = mkdtempSync(join(home, 'cwd-')), directory = createProfile(home, 'live'), config = join(directory, 'config.json');
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, 'utf8')), subagentLevels: 2 })); // An agent may start agents here.
  const server = await startServer({ home, cwd, flags });
  t.after(() => server.close());
  const { pushes, record, onPush } = watch(), client = await connect(server.url, onPush);
  const { window } = await client.request('open', { profile: 'live' });
  const listed = async () => (await client.request('agents', { profile: 'live' })).agents;
  /** What the agents did, for a failure: a model does not always do what it was asked, and then the test says what it did. */
  const did = (agents: Agent[]) => agents.map(agent => `"${agent.title}" ${agent.state}${agent.doing.length ? `, in ${agent.doing.map(call => call.name === 'bash' ? call.args.command : call.name).join(', ')}` : ''}${agent.headline ? `, reporting: ${agent.headline}` : ''}`).join('; ') || 'none';
  /** Whether an agent goes on by itself: one that has ended does not, however it ended (a Pi that died leaves it `interrupted`),
   * and a paused one waits for a message that the test is not about to send. */
  const goes = (agent: Agent) => working(agent) && agent.state !== 'paused';
  /** The agent of this title once it stands so, read from the profile's files as the page reads it. What can no longer come
   * fails at once instead of being waited for: an agent that goes no further and stands otherwise, and one that is not there
   * when no agent is at work that could start it (the main chat's own turn is over by then: `spawn`). */
  const stands = async (title: string, so: (agent: Agent) => boolean) => {
    for (;;) {
      const agents = await listed(), found = agents.find(agent => agent.title === title);
      if (found && so(found)) return found;
      if (found && !goes(found)) assert.fail(`The agent "${title}" goes no further, without having done what it was asked. The agents: ${did(agents)}`);
      if (!found && !agents.some(goes)) assert.fail(`No agent "${title}" was started, and none is at work that could start it. The agents: ${did(agents)}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };
  const runs = (command: string) => (agent: Agent) => agent.doing.some(call => call.name === 'bash' && call.args.command === command);
  /** Asks the main chat for an agent, and waits for the turn that takes the message to end: by then the agent is started, or
   * the model did not start it, which is said with its own words. The message may join a turn a report began. */
  const spawn = async (title: string, task: string) => {
    const before = pushes.findLast(push => push.push === 'record')?.seq ?? 0;
    await client.request('prompt', { window: window.id, text: `Use spawn to start ONE subagent titled "${title}" with exactly the task between the tags: <task>${task}</task> Then say only: started.` });
    const asked = await record(window.id, r => r.type === 'message_end' && isMessage(r.message) && r.message.role === 'user' && words(r.message.content).includes(`titled "${title}"`), before);
    const settled = await record(window.id, r => r.type === 'agent_settled', asked.seq);
    const answer = pushes.findLast(push => push.push === 'record' && push.seq < settled.seq && said(push.record, 'assistant'));
    if (!(await listed()).some(agent => agent.title === title)) assert.fail(`The main chat started no agent "${title}". It said: ${answer?.push === 'record' && isMessage(answer.record.message) ? words(answer.record.message.content) : 'nothing'}`);
  };

  // Told while it works: the message waits until it reads it. Interrupted: its step is cut, and it goes on with the message at once.
  await spawn('Word', 'Run `sleep 30` with bash. If it is cut short, do not run it again. Then report only the word you were told while you worked, or the word nothing if you were told none.');
  const word = { profile: 'live', id: (await stands('Word', runs('sleep 30'))).id };
  assert.deepEqual(await client.request('tellAgent', { ...word, text: 'The word is kiwi.' }), { resumed: false });
  assert.deepEqual((await client.request('agent', word)).queued, ['The word is kiwi.']);
  assert.deepEqual(await client.request('interruptAgent', word), {});
  const cut = await stands('Word', agent => agent.state === 'completed');
  assert.match(cut.headline ?? '', /kiwi/i);
  assert.ok(cut.ended! - cut.started < 30_000, 'the sleep did not run to its end');
  const read = await client.request('agent', word);
  assert.ok(read.queued === undefined && read.messages.filter(isMessage).some(message => message.role === 'user' && words(message.content).includes('The word is kiwi.')));

  // Ended, it is resumed with the next message, in the conversation it had: you do not choose between the two.
  assert.deepEqual(await client.request('tellAgent', { ...word, text: 'Now report exactly this word: mango' }), { resumed: true });
  assert.match((await stands('Word', agent => agent.state === 'completed' && /mango/i.test(agent.headline ?? ''))).headline ?? '', /mango/i);
  // Stopped, an agent ends, and its report says who stopped it.
  await spawn('Sleeper', 'Run `sleep 30` with bash, then report: slept.');
  const sleeper = { profile: 'live', id: (await stands('Sleeper', runs('sleep 30'))).id };
  assert.deepEqual(await client.request('stopAgent', sleeper), {});
  await stands('Sleeper', agent => agent.state === 'stopped');
  assert.match((await client.request('agent', sleeper)).report ?? '', /^Stopped by the user\./);

  // An agent's own agent is told and stopped the same way while it works. It does what it was told, so the message reached it.
  // The task says what a small model has got wrong here: that it may delegate (one said that a subagent cannot), and that the
  // command is not its own to run (one ran it). And it is another task than the one just stopped, which the main chat was
  // told not to delegate again: it has answered "started" to that without starting anything.
  await spawn('Outer', 'Your whole task is to delegate, which you can: you have a spawn tool. Call it once, to start ONE subagent titled "Inner" with exactly this task: "Run `sleep 25` with bash, then report: rested." Do not run that command yourself. When its report reaches you, report what it said.');
  const found = await stands('Inner', runs('sleep 25')), inner = { profile: 'live', id: found.id };
  assert.equal(found.parent, (await stands('Outer', () => true)).id);
  assert.deepEqual(await client.request('tellAgent', { ...inner, text: 'Change of plan: run `sleep 21` with bash now, then report: slept.' }), { resumed: false });
  assert.deepEqual(await client.request('interruptAgent', inner), {});
  await stands('Inner', runs('sleep 21'));
  assert.deepEqual(await client.request('stopAgent', inner), {});
  await stands('Inner', agent => agent.state === 'stopped');
  // Ended, it is its parent's to resume, and pi-optchat says so.
  await assert.rejects(client.request('tellAgent', { ...inner, text: 'Go on.' }), new RegExp(`Only ${inner.id}'s parent ${found.parent} can resume it`));
});

test('the app installs Pi into its own folder, that Pi runs a chat, and it installs pi-optchat with Pi\'s own installer', { timeout: 240_000 }, async t => {
  const home = temporaryHome(), app = mkdtempSync(join(home, 'app-')), nowhere = { command: join(home, 'no-such-pi'), args: [] };
  createProfile(home, 'live');
  /** A server on a machine without Pi, and a wait for the install it runs to end. */
  async function machine() {
    const { pushes, record, onPush } = watch(), waiting = new Set<() => void>();
    const server = await startServer({ home, app, cwd: mkdtempSync(join(home, 'cwd-')), pi: nowhere, flags });
    const client = await connect(server.url, push => { onPush(push); for (const check of waiting) check(); });
    const installed = () => new Promise<Setup>(resolve => {
      const check = () => { const last = pushes.findLast(push => push.push === 'setup'); if (last?.push === 'setup' && last.setup.job && last.setup.job.state !== 'running') { waiting.delete(check); resolve(last.setup); } };
      waiting.add(check); check();
    });
    return { server, client, record, installed };
  }

  // No Pi: the app installs one with npm, into its own folder and nowhere else.
  const first = await machine();
  t.after(() => first.server.close());
  assert.equal((await first.client.request('setup', {})).pi.state, 'missing');
  await first.client.request('install', { what: 'pi' });
  const { pi, job } = await first.installed();
  assert.deepEqual([job?.state, job?.output], ['done', undefined]);
  assert.partialDeepStrictEqual(pi, { state: 'ok', path: join(app, 'pi', 'node_modules', '.bin', 'pi'), shell: `export PATH=${join(app, 'pi', 'node_modules', '.bin')}:"$PATH"` });
  // It was installed without running its packages' install scripts. It still runs a turn, with a tool, through pi-optchat
  // (the one in your Pi's settings, which this Pi reads too).
  const { window } = await first.client.request('open', { profile: 'live' });
  await first.client.request('prompt', { window: window.id, text: 'Use the bash tool to run: echo hello-from-the-app. Then reply with exactly what it printed.' });
  await first.record(window.id, r => r.type === 'agent_settled');
  const { messages } = await first.client.request('history', { profile: 'live' });
  assert.match(messages.find(m => m.kind === 'echo')?.text ?? '', /^bash: hello-from-the-app/);
  assert.partialDeepStrictEqual(messages.at(-1), { kind: 'talk' });
  await first.server.close();

  // A Pi with nothing in it (its own folder is a throwaway one): no pi-optchat, no login. The app installs pi-optchat.
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(home, 'agent-'));
  t.after(() => { delete process.env.PI_CODING_AGENT_DIR; });
  const second = await machine();
  t.after(() => second.server.close());
  assert.partialDeepStrictEqual(await second.client.request('setup', {}), { pi: { state: 'ok' }, optchat: { state: 'missing', installable: true }, login: { state: 'missing', providers: [] } });
  await second.client.request('install', { what: 'optchat' });
  const done = await second.installed();
  assert.partialDeepStrictEqual(done, { optchat: { state: 'ok' }, job: { what: 'optchat', state: 'done' } });
  assert.ok(done.optchat.path?.startsWith(process.env.PI_CODING_AGENT_DIR));
});
