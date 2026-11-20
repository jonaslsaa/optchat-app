import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
// pi-optchat's own lock, which a Pi holds while it has a profile open.
import { describeOwner, lockProfile, readRuns } from 'pi-optchat/files';
import { fakeOwner } from './fake-owner.ts';
import { working } from '../src/agent.ts';
import { clamp, levels, type Thinking } from '../src/models.ts';

/** Stands in for `pi --mode rpc` with pi-optchat: the same records on stdin and stdout, scripted by the profile's name and the
 * prompt's words, so the server's tests and the UI's screenshots need no model.
 * - It says it owns its profile, or with `--optchat-connect join` that it is a window on it. An owner holds the profile's lock
 *   and answers for its agents (`fake-owner.ts`), and logs what is said to the profile's `main/`, as pi-optchat does; a window keeps its conversation to itself (`get_messages`), and writes a handoff
 *   when it is completed with `/complete`.
 * - A prompt holding "wait" stays mid-reply until a `release` command or an abort, and one holding "think" thinks before it answers; "ask" asks a dialog first and replies with its
 *   answer; "crash" kills it without an answer; after one holding "hold Complete" a window never answers `/complete`. A message sent during a run waits in the queue it was sent to: one that steers
 *   is answered next, one for later after those.
 * - `/skill:name …` of a skill it lists (`get_commands`) is sent as Pi sends it: the skill's file, with what was typed under it.
 * - FAKE_PI_SCRIPT names a JSON file of longer replies (`Script`), for the screenshots: a prompt holding one of its words gets
 *   that word's turns and answer.
 * - Profile `busy` fails as a profile another Pi owns, `stuck` ignores the request to shut down, `mute` never answers a command,
 *   `bare` is a Pi without pi-optchat, `old` one whose pi-optchat is from before 0.11.9 and names no role, and in `noisy`
 *   another extension fails. `slow` starts only once the file `go` is in FAKE_PI_HOME. `importing` has an import that was paused: pi-optchat takes no message for it, says why
 *   (`notify`) and answers the prompt as `handled`, as it answers a command it ran.
 * - Its owner stands for the pi-optchat FAKE_PI_HOME has installed as it starts (`fake-owner.ts`), and keeps it while it runs.
 * - It runs on a model, as Pi does: the one the profile keeps as its main chat's when it owns the profile, else the first it
 *   lists. `set_model` and `set_thinking_level` change it, and an owner keeps the pick in the profile, as pi-optchat does.
 * - It writes nowhere but in its profile and FAKE_PI_HOME, and in the file FAKE_PI_STOPPED names, where each one with a
 *   profile that is asked to stop says so, in the order they did. It does not run in your home folder: a test or a screenshot run that starts it
 *   there has forgotten to say where (`cwd`), and fails. */
if (process.cwd() === realpathSync(homedir())) { console.error('The fake Pi was started in your home folder. Give the server a `cwd`.'); process.exit(70); }
/** Pi outside a chat, as the app's setup asks it: its version, its packages (`list`, `install`, `update`), and the models it has
 * credentials for. FAKE_PI_HOME stands for Pi's own folder: `state.json` there says which Pi this is, and `install` puts a
 * package under it as Pi does. Without it this is Pi 1.5.2 with no packages and no login. */
/** `broken`: Pi cannot read its own logins, and says `invalid` when asked about one. `latest`: the newest Pi that is out, which
 * `update self` installs, as Pi's own updater does. */
interface Installed { version: string; providers: string[]; packages: Record<string, string>; broken?: boolean; latest?: string }
const folder = process.env.FAKE_PI_HOME, kept = folder && join(folder, 'state.json');
const installed: Installed = { version: '1.5.2', providers: [], packages: {}, ...kept && existsSync(kept) && JSON.parse(readFileSync(kept, 'utf8')) };
/** Models as Pi lists them (`get_available_models`), a few of each provider it knows, with the fields the app reads; a
 * provider it does not know has one model, named as the id is, as one a user adds in Pi's models.json. */
interface Model { provider: string; id: string; name: string; reasoning: boolean; thinkingLevelMap?: Record<string, string | null> }
const ALL = { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, HIGHEST = { off: null, xhigh: 'xhigh', max: 'max' };
const NONE = { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, MINIMAL = { ...NONE, minimal: 'low' };
const KNOWN: Record<string, [id: string, name: string, map?: Model['thinkingLevelMap'], reasoning?: boolean][]> = {
  anthropic: [['claude-fable-5', 'Claude Fable 5', HIGHEST], ['claude-haiku-4-5', 'Claude Haiku 4.5 (latest)'], ['claude-haiku-5-5', 'Claude Haiku 5.5', { minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }], ['claude-opus-5-5', 'Claude Opus 5.5', ALL], ['claude-sonnet-5-5', 'Claude Sonnet 5.5', ALL]],
  'github-copilot': [['claude-opus-5.5', 'Claude Opus 5.5', ALL], ['gemini-4-argon', 'Gemini 4 Argon'], ['gpt-6-sol', 'GPT-6 Sol', NONE]],
  openai: [['gpt-4.1', 'GPT-4.1', undefined, false], ['gpt-5.5', 'GPT-5.5', { ...NONE, max: null }], ['gpt-6-sol', 'GPT-6 Sol', NONE], ['gpt-6.1-terra', 'GPT-6.1 Terra', NONE], ['o3', 'o3', { ...ALL, xhigh: null, max: null }]],
  'openai-codex': [['gpt-5.6-luna', 'GPT-5.6 Luna', { xhigh: 'xhigh', max: 'max', minimal: 'low' }], ['gpt-6-sol', 'GPT-6 Sol', MINIMAL]],
};
const models: Model[] = installed.providers.flatMap(provider => (KNOWN[provider] ?? [['a-model', 'a-model']]).map(([id, name, thinkingLevelMap, reasoning = true]) => ({ provider, id, name, reasoning, ...thinkingLevelMap && { thinkingLevelMap } })));
const [verb, source = ''] = process.argv.slice(2);
if (verb === '--version') { console.log(installed.version); process.exit(0); }
if (verb === 'list') {
  const packages = Object.entries(installed.packages);
  console.log(packages.length ? ['User packages:', ...packages.map(([source, path]) => `  ${source}\n    ${path}`)].join('\n') : 'No packages installed.');
  process.exit(0);
}
// Pi's sign-in asks its questions on a terminal, and says so where there is none.
if (verb === 'auth' && source === 'login') { console.error('"pi auth login <provider> [--api-key] [--no-browser]" requires an interactive terminal'); process.exit(1); }
if (verb === 'auth' && source === 'check') {
  const provider = process.argv[process.argv.indexOf('--provider') + 1], ready = installed.providers.includes(provider);
  if (installed.broken) { console.log(JSON.stringify({ status: 'invalid', provider, reason: 'invalid_state' })); process.exit(2); }
  console.log(JSON.stringify(ready ? { status: 'ready', provider, authType: 'oauth' } : { status: 'not_ready', provider, reason: 'credentials_not_configured' }));
  process.exit(ready ? 0 : 1);
}
if ((verb === 'install' || verb === 'update') && folder && kept) {
  if (source === 'self') installed.version = installed.latest ?? '1.5.2';
  else {
    const name = source.replace('npm:', ''), path = join(folder, 'npm', 'node_modules', name);
    console.log(`Installing ${source}...\n`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '0.12.2' }));
    installed.packages[source] = path;
    console.log(`added 1 package in 409ms\nInstalled ${source}`);
  }
  writeFileSync(kept, JSON.stringify(installed));
  process.exit(0);
}

const profile = process.argv[process.argv.indexOf('--optchat-profile') + 1], joins = process.argv[process.argv.indexOf('--optchat-connect') + 1] === 'join';
const write = (record: object) => process.stdout.write(`${JSON.stringify(record)}\n`);
let noticed = 0;
const status = (statusKey: string, statusText: string) => write({ type: 'extension_ui_request', id: statusKey, method: 'setStatus', statusKey, statusText });
/** pi-optchat's role. `after`: when the conversation before this one was handed off, which it says from the next message on. */
const role = (completed = false, after?: number) => status('optchat.role', JSON.stringify(joins ? { role: 'window', profile, id: 'w1', connected: true, completed, ...after !== undefined && { after } } : { role: 'owner', profile }));

type Image = { type: 'image'; data: string; mimeType: string };
export type Content = { type: 'text'; text: string } | Image | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };
interface Said { role: string; content: Content[]; timestamp: number; stopReason?: string; errorMessage?: string; toolCallId?: string; toolName?: string; customType?: string; display?: boolean }
const messages: Said[] = [];
let completed = false, marked: number | undefined, after: number | undefined, holds = false;
/** Replies by a word of the prompt: turns of the agent's work, each a reply with tool calls and what those print, and then its
 * answer. With `clock` the messages' times start there and go up a second a message, where they are otherwise the time it is.
 * `handoff` is what a window writes for the main chat when it is completed. */
export interface Script { clock?: number; handoff?: string; replies: Record<string, { turns: { content: Content[]; results: string[] }[]; answer: string }> }
const script: Script = process.env.FAKE_PI_SCRIPT ? JSON.parse(readFileSync(process.env.FAKE_PI_SCRIPT, 'utf8')) : { replies: {} };
/** Each message gets a later time than the one before, and by the real clock none that has not come yet: the server tells a
 * window's conversations apart by when they were said. */
let clock = script.clock ?? 0;
function now() {
  if (script.clock !== undefined) return clock += 1000;
  while (Date.now() <= clock); // Under a millisecond.
  return clock = Date.now();
}

/** What it runs on. An owner starts on the model the profile keeps for its main chat, where it lists that one, and keeps a pick
 * there (pi-optchat's `main` in config.json); everything else starts on the first it lists, thinking at Pi's `medium`. */
const config = join(process.env.OPTCHAT_HOME ?? '.', 'profiles', profile, 'config.json');
const saved: { provider: string; model: string; thinking: Thinking } | undefined = !joins && existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')).main : undefined;
let model = models.find(model => model.provider === saved?.provider && model.id === saved.model) ?? models.at(0), thinkingLevel: Thinking = model ? clamp(levels(model), saved?.thinking ?? 'medium') : 'medium';
function picked() {
  if (model && !joins && existsSync(config)) writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, 'utf8')), main: { provider: model.provider, model: model.id, thinking: thinkingLevel } }));
}

/** An image's name in the profile: a hash of it, as pi-optchat names one (its images.ts). */
const named = (image: Image) => createHash('sha256').update(image.data).digest('hex').slice(0, 16);
/** The profile's log, as pi-optchat writes it: one entry for each thing a message said. */
const main = join(process.env.OPTCHAT_HOME ?? '.', 'profiles', profile, 'main');
let logged = existsSync(main) ? readdirSync(main).reduce((count, name) => count + readFileSync(join(main, name), 'utf8').split('\n').filter(Boolean).length, 0) : 0;
function log(message: Said) {
  const entries: [string, string][] = [];
  // An image is kept in the profile and named in the log by a hash of it, as pi-optchat does (its images.ts).
  const kept = (image: Image) => {
    const name = named(image);
    mkdirSync(join(main, '../images'), { recursive: true });
    writeFileSync(join(main, '../images', `${name}.${image.mimeType.replace('image/', '').replace('jpeg', 'jpg')}`), Buffer.from(image.data, 'base64'));
    return `[image ${name}]`;
  };
  if (message.role === 'user') entries.push(['user', message.content.map(c => c.type === 'text' ? c.text : c.type === 'image' ? kept(c) : '').filter(Boolean).join('\n')]);
  if (message.role === 'toolResult') entries.push(['echo', `${message.toolName}: ${message.content.map(c => c.type === 'text' ? c.text : '').join('\n')}`]);
  if (message.role === 'assistant') {
    for (const c of message.content) if (c.type === 'text') entries.push(['talk', c.text]); else if (c.type === 'toolCall') entries.push(['tool', `${c.name} ${JSON.stringify(c.arguments)}`]);
    if (message.stopReason === 'aborted') entries.push(['echo', 'Agent aborted: No further details']);
  }
  mkdirSync(main, { recursive: true });
  for (const [kind, text] of entries) appendFileSync(join(main, 'fake.jsonl'), `${JSON.stringify({ i: logged++, kind, date: new Date(message.timestamp).toISOString(), text })}\n`);
}
function ended(message: Said) {
  write({ type: 'message_end', message });
  messages.push(message);
  if (!joins) log(message);
}
const SKILLS: Record<string, string> = { 'sol-loop': 'Review a code change in a loop with an OpenAI GPT Sol subagent and fix what it finds, before (or after) opening a PR. Use when the user says "sol loop".', 'use-codex': 'Run the Codex CLI (a separate OpenAI coding agent) headlessly as an independent second opinion.', 'write-a-skill': 'Create new agent skills with proper structure, progressive disclosure, and bundled resources.' };
const skillFile = (name: string) => `/home/.agents/skills/${name}/SKILL.md`;
/** As Pi sends `/skill:name what was typed` for a skill it knows: the skill's file, and what was typed under it. */
function expanded(text: string) {
  const [, name = '', typed] = /^\/skill:(\S+)(?: ([\s\S]*))?$/.exec(text) ?? [];
  if (!Object.hasOwn(SKILLS, name)) return text;
  const skill = `<skill name="${name}" location="${skillFile(name)}">\nReferences are relative to /home/.agents/skills/${name}.\n\n# ${name}\n\n${SKILLS[name]}\n</skill>`;
  return typed?.trim() ? `${skill}\n\n${typed.trim()}` : skill;
}
const user = (text: string, images: Image[] = []) => { const message: Said = { role: 'user', content: [{ type: 'text', text }, ...images], timestamp: now() }; write({ type: 'message_start', message }); ended(message); };

const THOUGHT = 'The user wants the shutdown path checked.\n\nFirst `stop()` closes stdin, then waits for the grace period.\nThe timer is never cleared, so a clean exit still waits the whole grace period.\nI should read src/server/pi.ts before saying so.';
let running = false, settled = Promise.resolve(), steering: string[] = [], followUp: string[] = [], release: ((held: { aborted: boolean; answer?: string }) => void) | undefined;
const held = () => new Promise<{ aborted: boolean; answer?: string }>(resolve => { release = held => { release = undefined; resolve(held); }; });

/** Streams a reply block by block, in the records real Pi writes in RPC mode (test/pi-turn.jsonl is a capture): a start, deltas
 * and the whole block at its end, each naming the block by `contentIndex` and none carrying the reply so far. `pause` holds it
 * before each block `at` is finished, and `again` once all of that block has come, before it ends. */
async function reply(content: Content[], stopReason: string, pause?: { at: number[]; again?: boolean }) {
  const message: Said = { role: 'assistant', content: [], timestamp: now(), stopReason: 'pending' };
  write({ type: 'message_start', message });
  const update = (assistantMessageEvent: object) => write({ type: 'message_update', assistantMessageEvent });
  for (const [contentIndex, block] of content.entries()) {
    const text = block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : block.type === 'toolCall' ? JSON.stringify(block.arguments) : '';
    const kind = block.type === 'toolCall' ? 'toolcall' : block.type, half = Math.ceil(text.length / 2);
    update({ type: `${kind}_start`, contentIndex, ...block.type === 'toolCall' && { id: block.id, toolName: block.name } });
    update({ type: `${kind}_delta`, contentIndex, delta: text.slice(0, half) });
    if (pause?.at.includes(contentIndex) && (await held()).aborted) {
      ended({ ...message, content: content.slice(0, contentIndex), stopReason: 'aborted' });
      return true;
    }
    update({ type: `${kind}_delta`, contentIndex, delta: text.slice(half) });
    if (pause?.again && pause.at.includes(contentIndex) && (await held()).aborted) {
      ended({ ...message, content: content.slice(0, contentIndex), stopReason: 'aborted' });
      return true;
    }
    update(block.type === 'toolCall' ? { type: 'toolcall_end', contentIndex, toolCall: block } : { type: `${kind}_end`, contentIndex, content: text });
  }
  ended({ ...message, content, stopReason });
  return false;
}
function tool(call: Extract<Content, { type: 'toolCall' }>, output: string) {
  write({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: call.arguments });
  write({ type: 'tool_execution_update', toolCallId: call.id, toolName: call.name, args: call.arguments, partialResult: { content: [{ type: 'text', text: output.slice(0, 20) }] } });
  write({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, result: { content: [{ type: 'text', text: output }] }, isError: false });
  const message: Said = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: output }], timestamp: now() };
  write({ type: 'message_start', message }); ended(message);
}
async function run(text: string, images?: Image[]) {
  running = true;
  write({ type: 'agent_start' });
  user(expanded(text), images);
  // Asked for a picture, it shows the ones it was sent, as the profile keeps them.
  let aborted = false, answer = text.includes('picture') && images?.length ? images.map(image => `![yours](/images/${profile}/${named(image)})`).join(' ') : 'reply';
  if (text.includes('ask')) {
    write({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Go on?', message: 'The agent wants to continue.' });
    const answered = await held();
    aborted = answered.aborted;
    answer = answered.answer ?? answer;
  }
  const scripted = Object.entries(script.replies).find(([word]) => text.includes(word))?.[1];
  // A run stopped at its dialog says nothing more.
  for (const { content, results } of aborted ? [] : scripted?.turns ?? []) {
    await reply(content, 'toolUse');
    content.filter(block => block.type === 'toolCall').forEach((call, at) => tool(call, results[at]));
  }
  // Asked to think, it thinks first, as a model does that Pi lets think, and a "wait" then holds it in the middle of its thought, and once it is released, in the middle of its answer ("slowly": and again with all of it out).
  const thought: Content[] = text.includes('think') ? [{ type: 'thinking', thinking: THOUGHT }] : [];
  if (!aborted) aborted = await reply([...thought, { type: 'text', text: scripted?.answer ?? answer }], 'stop', text.includes('wait') ? { at: thought.length ? [0, 1] : [0], again: text.includes('slowly') } : undefined);
  write({ type: 'agent_end', messages: [] });
  const next = aborted ? undefined : steering.shift() ?? followUp.shift();
  if (next !== undefined) { write({ type: 'queue_update', steering, followUp }); return run(next); }
  running = false;
  write({ type: 'agent_settled', aborted });
}
/** /complete in a window, as pi-optchat does it: a request the chat does not show, which the agent answers with its handoff in
 * a run of its own. */
function handoff() {
  write({ type: 'agent_start' });
  const request: Said = { role: 'custom', customType: 'optchat-handoff-request', display: false, content: [{ type: 'text', text: '[OptChat] This connected conversation has ended.' }], timestamp: now() };
  write({ type: 'message_start', message: request }); ended(request);
  void reply([{ type: 'text', text: script.handoff ?? 'Goal: what was asked.\n\nDone: it was answered.\n\nOpen: nothing.' }], 'stop'); // It does not pause, so it is written by now.
  write({ type: 'agent_end', messages: [] });
  write({ type: 'agent_settled', aborted: false });
}
const commands: Record<string, (command: Record<string, unknown>) => unknown> = {
  get_state: () => ({ model, thinkingLevel, isStreaming: running, pid: process.pid, args: process.argv.slice(2), home: process.env.OPTCHAT_HOME, cwd: process.cwd() }),
  get_messages: () => ({ messages }),
  get_available_models: () => ({ models }),
  // As Pi lists them: what extensions add (pi-optchat's three, and Pi's own `mcp`), a prompt template, and skills.
  get_commands: () => ({ commands: [
    ...profile === 'bare' ? [] : [['complete', 'End this connected conversation and hand off to the main agent'], ['tell-main', 'Send a message to the main agent from this connected window'], ['optchat', 'OptChat profiles, settings, models, agents, instructions, memory browser, and imports']].map(([name, description]) => ({ name, description, source: 'extension', sourceInfo: { path: '/pi/pi-optchat/src/index.ts', source: 'npm:pi-optchat', scope: 'user', origin: 'package', baseDir: '/pi/pi-optchat' } })),
    { name: 'mcp', description: 'Manage MCP servers: sign in, reconnect, enable or disable, and change exposure', source: 'extension', sourceInfo: { path: 'builtin:mcp', source: 'builtin', scope: 'temporary', origin: 'top-level' } },
    { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt', sourceInfo: { path: '/home/.pi/agent/prompts/fix-tests.md', source: 'local', scope: 'user', origin: 'top-level' } },
    ...Object.entries(SKILLS).map(([name, description]) => ({ name: `skill:${name}`, description, source: 'skill', sourceInfo: { path: skillFile(name), source: 'auto', scope: 'user', origin: 'top-level', baseDir: '/home/.agents' } })),
  ] }),
  // Pi answers with the model, and gives it a level it can think at; one it does not list is an error (below).
  set_model: ({ provider, modelId }) => {
    const found = models.find(model => model.provider === provider && model.id === modelId);
    if (!found) throw new Error(`Model not found: ${String(provider)}/${String(modelId)}`);
    const take = () => { model = found; thinkingLevel = clamp(levels(found), thinkingLevel); picked(); return found; };
    // Pi sets a model in its own time (it looks for the provider's key first) and takes its next command meanwhile.
    return found.id === 'gpt-6.1-terra' ? new Promise(done => setTimeout(() => done(take()), 100)) : take();
  },
  set_thinking_level: ({ level }) => { if (model) thinkingLevel = clamp(levels(model), level as Thinking); picked(); },
  prompt: ({ message, images, streamingBehavior }) => {
    const text = String(message);
    if (text === '/complete') {
      if (holds) return new Promise(() => {});
      // A reply being written is stopped first, and the handoff follows once that run has ended.
      const hand = () => { handoff(); marked = now(); role(completed = true, after); };
      if (running) { release?.({ aborted: true }); void settled.then(hand); } else hand();
      return { disposition: 'handled' };
    }
    if (profile === 'importing' || existsSync(join(process.env.OPTCHAT_HOME ?? '.', 'profiles', profile, 'imports', 'pending.json'))) {
      if (!text.startsWith('/')) write({ type: 'extension_ui_request', id: `notice-${++noticed}`, method: 'notify', message: 'This profile has an import in progress. Use /optchat import to resume or discard it, or switch profiles.', notifyType: 'info' });
      return { disposition: 'handled' };
    }
    if (completed) role(completed = false, after = marked); // The next message begins a new conversation, and pi-optchat says so, and from when, before the run.
    if (text.includes('hold Complete')) holds = true;
    if (text.includes('crash')) { process.stderr.write('out of memory\n'); process.exit(3); }
    if (running) { (streamingBehavior === 'followUp' ? followUp : steering).push(expanded(text)); write({ type: 'queue_update', steering, followUp }); return { disposition: 'queued' }; }
    settled = run(text, Array.isArray(images) ? images : []); return { disposition: 'started' };
  },
  release: () => { release?.({ aborted: false }); },
  clear_queue: () => {
    const cleared = { steering, followUp };
    steering = []; followUp = [];
    write({ type: 'queue_update', steering, followUp });
    return cleared;
  },
  abort: () => { release?.({ aborted: true }); },
  extension_ui_response: ({ confirmed }) => { release?.({ aborted: false, answer: `confirmed: ${confirmed}` }); },
};

if (profile === 'busy') {
  status('optchat', 'OptChat: choose profile');
  write({ type: 'extension_error', extensionPath: 'pi-optchat', event: 'session_start', error: `Profile already running: ${profile} · PID 1 · a-terminal · /somewhere` });
} else if (profile !== 'bare') {
  if (profile === 'noisy') write({ type: 'extension_error', extensionPath: 'something-else', event: 'session_start', error: 'No API key' });
  // pi-optchat counts the main chat's own agents at work, as their records have them when it starts.
  const agents = readRuns(join(process.env.OPTCHAT_HOME ?? '.', 'profiles', profile)).filter(run => !run.connected && !run.parentId && working(run)).length;
  status('optchat', joins ? `OptChat: ${profile} · connected window` : `OptChat: ${profile} · ${logged} messages · 0 pending · ${agents} agents${profile === 'importing' ? ' · import paused: /optchat import' : ''}`);
  if (profile !== 'old') role();
}
// An owner has its profile before it answers anything, as Pi has once its session has started.
const directory = join(process.env.OPTCHAT_HOME ?? '.', 'profiles', profile);
if (!joins && !['busy', 'bare'].includes(profile) && existsSync(directory)) {
  await lockProfile(directory, describeOwner({ profile, pid: process.pid, host: hostname(), cwd: process.cwd() }));
  // The pi-optchat it loaded as it started, which it keeps whatever is installed later.
  const optchat = Object.values(installed.packages).flatMap((path): { name?: string; version?: string }[] => { try { return [JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))]; } catch { return []; } })
    .find(read => read.name === 'pi-optchat')?.version;
  await fakeOwner(directory, () => script.clock ?? Date.now(), optchat);
}
let buffer = '';
// `slow` takes its time to start: it reads nothing it is sent until the file `go` is in FAKE_PI_HOME.
const read = () => {
  if (profile === 'slow' && folder && !existsSync(join(folder, 'go'))) { setTimeout(read, 50); return; }
  for (let end: number; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) {
    const command: Record<string, unknown> = JSON.parse(buffer.slice(0, end)), handler = commands[String(command.type)];
    if (profile === 'mute') continue;
    if (command.type === 'extension_ui_response') handler(command);
    else if (handler) {
      const answer = (data: unknown) => write({ id: command.id, type: 'response', command: command.type, success: true, data });
      try { const data = handler(command); if (data instanceof Promise) void data.then(answer); else answer(data); }
      catch (error) { write({ id: command.id, type: 'response', command: command.type, success: false, error: (error as Error).message }); }
    }
    else write({ id: command.id, type: 'response', command: command.type, success: false, error: `Unknown command: ${String(command.type)}` });
  }
};
process.stdin.on('data', chunk => { buffer += String(chunk); read(); });
process.stdin.on('end', () => {
  if (profile === 'stuck') { setInterval(() => {}, 1000); return; }
  if (process.env.FAKE_PI_STOPPED && process.argv.includes('--optchat-profile')) appendFileSync(process.env.FAKE_PI_STOPPED, `${profile} ${joins ? 'window' : 'owner'}\n`);
  process.exit(0);
});
