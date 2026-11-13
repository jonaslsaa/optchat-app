import { existsSync } from 'node:fs';
import { loadConfig, profileOwner } from 'pi-optchat/files';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { methods, type ModelChoice, type Params, type PiRecord, type Push, type Result, type WindowState } from '../protocol.ts';
import { canComplete } from '../window.ts';
import { chosen, offered } from './models.ts';
import { Pi, reason } from './pi.ts';
import { profileDirectory } from './profiles.ts';
import { MINIMUM_OPTCHAT } from './setup.ts';

export interface WindowsOptions {
  home: string;
  /** Where a window's Pi runs unless `open` names a directory. */
  cwd(): string;
  /** The Pi to run, and arguments to give it before `--optchat-profile <name> --mode rpc`. It fails when there is none. */
  pi(): Promise<{ command: string; args: readonly string[] }>;
  /** The models Pi can use and what it runs on by itself, for a window that has no Pi to ask. */
  catalog(): Promise<Result<'models'>>;
  /** How long a Pi asked to stop may take before it is killed, in milliseconds. */
  grace: number;
  push(push: Push): void;
}
interface Opened {
  state: WindowState; pi?: Pi; starting?: Promise<Pi>;
  /** What Pi wrote since the latest run began, less the streaming updates a later record made redundant. */
  records: { seq: number; record: PiRecord }[];
  /** The number of the last record that is no longer kept. */
  dropped: number;
  /** What Pi's extensions show now, by what it is: outside `records`, since a status set at startup still stands runs later. */
  ui: Map<string, PiRecord>;
  /** What an extension said went wrong as the session started: why pi-optchat has no profile, if it has none. */
  fault?: string;
  /** A connected window on its way out: it starts no Pi, and leaves the list once its Pi has exited. */
  closed?: boolean;
  /** Asked to stop while its start had no Pi yet: that start spawns none. */
  stopping?: boolean;
  /** Its conversation is being handed off: Complete has not answered yet. */
  completing?: boolean;
  /** The model picked for it while it had no Pi: its Pi is given it as it starts, and it is kept until a Pi has taken it. */
  pick?: ModelChoice;
  /** The pick that is being made, which the next one waits for. */
  picking?: Promise<void>;
}
/** What the app asks of an agent it starts, on top of what pi-optchat tells it: handed to Pi with its own
 * `--append-system-prompt`, which puts it in the prompt as an `<addendum>`, and pi-optchat leaves that section alone. It
 * reaches the agent of a window the app started, not the agents those start, and not a chat that runs in a terminal.
 * The GitHub list finds an issue or pull request by its address, and an agent left to itself writes "#12". */
export const PROMPT = 'When you first mention a GitHub pull request or issue, give its full link.';
/** What pi-optchat says a Pi in RPC mode is to its profile: JSON in a `setStatus` with this key (its docs/connected-windows.md),
 * sent as the session starts, so before Pi's first answer; a Pi that has not sent it by then has no profile open. This is the
 * one place that reads it, and it reads only these fields. */
const ROLE_STATUS = 'optchat.role';
const Role = Type.Object({ profile: Type.String(), completed: Type.Optional(Type.Boolean()), after: Type.Optional(Type.Number()) });
/** pi-optchat's role as it stands, or nothing: from another program, or a pi-optchat too old to say. */
function role(status: unknown) {
  try {
    const role: unknown = JSON.parse(String(status));
    return Value.Check(Role, role) ? role : undefined;
  } catch { return undefined; }
}
const opens = ({ ui, state }: Opened) => role(ui.get(`status ${ROLE_STATUS}`)?.statusText)?.profile === state.profile;
const DIALOGS = ['select', 'confirm', 'input', 'editor'];
/** What the profile's main chat was last on: pi-optchat keeps it in the profile, and starts the main chat's Pi on it. */
function kept(directory: string) { try { return loadConfig(directory).main; } catch { return undefined; } }
const same = (a?: ModelChoice, b?: ModelChoice) => a?.provider === b?.provider && a?.model === b?.model && a?.thinking === b?.thinking;
const mainId = (profile: string) => `${profile}/main`;
const isMain = ({ state }: Opened) => state.id === mainId(state.profile);
/** Pi's answer to `command`, as the protocol promises it. */
function answered<S extends TSchema>(command: string, schema: S, data: unknown): Static<S> {
  if (!Value.Check(schema, data)) throw new Error(`Pi's answer to ${command} is not one this app knows. Update Pi or the app.`);
  return data;
}

/** The windows: one Pi in RPC mode each, started on a window's first prompt and kept when clients come and go. Pi and pi-optchat do
 * all the work; this only starts and stops them, passes commands in, and pushes out what Pi writes. */
export class Windows {
  private readonly windows = new Map<string, Opened>();
  private connected = 0;
  private closing = false;
  private readonly options: WindowsOptions;
  constructor(options: WindowsOptions) { this.options = options; }

  list(): Result<'windows'> { return { windows: [...this.windows.values()].map(w => w.state) }; }
  async open({ profile, role = 'main', cwd }: Params<'open'>): Promise<Result<'open'>> {
    const opened = this.window(profile, role, cwd);
    if (isMain(opened)) await this.look(opened);
    return { window: opened.state };
  }
  async prompt({ window, text, images, whenBusy = 'steer' }: Params<'prompt'>): Promise<Result<'prompt'>> {
    const opened = this.get(window), pi = await this.started(opened);
    // It would steer the agent while it writes its handoff, and be part of neither conversation.
    if (opened.completing) throw new Error('This conversation is being handed to the main chat. Send your message once it is.');
    // Always with a queueing behaviour, as T3 Code sends it: Pi then starts a run or queues the message, whichever is true by
    // the time it arrives, and a run that began meanwhile (a subagent's report) cannot make it fail.
    const send = () => pi.request({ type: 'prompt', message: text, ...images?.length && { images }, streamingBehavior: whenBusy });
    // pi-optchat's command, typed as a message, is Complete all the same.
    return answered('prompt', methods.prompt.result, await (text.trim() === '/complete' ? this.handingOff(opened, send) : send()));
  }
  async abort({ window }: Params<'abort'>): Promise<Result<'abort'>> {
    const pi = this.running(window);
    const queued = answered('clear_queue', methods.abort.result, await pi.request({ type: 'clear_queue' }));
    await pi.request({ type: 'abort' });
    return queued;
  }
  async complete({ window }: Params<'complete'>): Promise<Result<'complete'>> {
    const opened = this.get(window);
    if (opened.completing || !canComplete(opened.state)) throw new Error('Complete hands a connected conversation to the main chat. This window has none to hand off.');
    await this.handingOff(opened, () => this.running(window).request({ type: 'prompt', message: '/complete' }));
    return {};
  }
  async close({ window }: Params<'close'>): Promise<Result<'close'>> {
    const opened = this.get(window);
    if (!isMain(opened)) opened.closed = true;
    await this.stop(opened);
    if (opened.closed && this.windows.delete(window)) { opened.state.status = 'closed'; this.changed(opened); }
    return {};
  }
  records({ window, after = 0 }: Params<'records'>): Result<'records'> {
    const { state, records, dropped, ui } = this.get(window);
    return { seq: state.seq, records: records.filter(r => r.seq > after), complete: after >= dropped, ui: [...ui.values()] };
  }
  async command({ window, command }: Params<'command'>): Promise<Result<'command'>> {
    if (command.type === 'extension_ui_response') throw new Error('Pi does not answer an extension_ui_response. Send it with `answer`.');
    if (['prompt', 'steer', 'follow_up'].includes(command.type)) throw new Error('Send a message with `prompt`, which knows when a window takes one.');
    return { data: await this.running(window).request(command) };
  }
  async models({ window }: Params<'models'>): Promise<Result<'models'>> {
    const { pi } = this.get(window);
    return pi ? { models: await offered(pi) } : this.options.catalog();
  }
  async setModel({ window, model }: Params<'setModel'>): Promise<Result<'setModel'>> {
    const opened = this.get(window), { state } = opened;
    // One pick at a time. A model and its level are two commands to Pi, which takes the next command while it still sets a
    // model: two picks at once could leave it on the model of one with the level of the other.
    const picking = (opened.picking ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (state.outside) throw new Error('This chat is running outside the app. Its model is picked there.');
      // A Pi that is starting is waited for, so the pick it starts with (`start`) is made before this one too.
      const pi = await (opened.starting ?? opened.pi);
      if (pi) await this.choose(opened, pi, model); else state.model = opened.pick = model;
      this.changed(opened);
    });
    opened.picking = picking;
    await picking;
    return {};
  }
  answer({ window, ...response }: Params<'answer'>): Result<'answer'> {
    this.running(window).send({ type: 'extension_ui_response', ...response });
    this.get(window).ui.delete(`dialog ${response.id}`);
    return {};
  }
  /** A Pi has the profile open once this answers: one outside the app, or else the main window's, started if it has none. A
   * profile's agents live in that Pi, and are reached through it. */
  async owned(profile: string) {
    const main = this.window(profile);
    await this.look(main);
    if (!main.state.outside) await this.started(main);
  }
  /** Stops every Pi and starts no more. Connected windows go first: each hands its conversation to the profile's owner as it
   * leaves, so the owner has to be there still. */
  async shutdown() {
    this.closing = true;
    const windows = [...this.windows.values()];
    await Promise.all(windows.filter(opened => !isMain(opened)).map(opened => this.stop(opened)));
    await Promise.all(windows.filter(isMain).map(opened => this.stop(opened)));
  }

  /** Sends pi-optchat's `/complete`. Until Pi has answered it, the window takes no other message. */
  private async handingOff<T>(opened: Opened, send: () => Promise<T>) {
    opened.completing = true;
    try { return await send(); } finally { opened.completing = false; }
  }
  /** The profile's main window, made the first time it is asked for, or a new connected window. */
  private window(profile: string, role: WindowState['role'] = 'main', cwd = this.options.cwd()) {
    profileDirectory(this.options.home, profile);
    const id = role === 'main' ? mainId(profile) : `${profile}/${++this.connected}`;
    let opened = this.windows.get(id);
    if (!opened) {
      if (!existsSync(cwd)) throw new Error(`No such directory: ${cwd}`);
      opened = { state: { id, profile, role, cwd, status: 'stopped', seq: 0 }, records: [], dropped: 0, ui: new Map() };
      this.windows.set(id, opened);
      this.changed(opened);
    }
    return opened;
  }
  /** Whether a Pi outside the app holds a main window's profile, as it is now: one in a terminal, which the app never joins
   * unasked. It is looked at when the window is opened (which is what the page's "Check again" does) and before a Pi starts
   * on the profile, and at no other time. */
  private async look(main: Opened) {
    const { state } = main, directory = profileDirectory(this.options.home, state.profile);
    if (main.pi || this.closing) return; // The app's own Pi holds it, or soon will.
    // A holder that does not say who it is still holds the profile.
    const outside = await profileOwner(directory).then(owner => owner && { pid: owner.pid, host: owner.host, cwd: owner.cwd }, () => 'unknown' as const);
    if (main.pi || this.closing) return;
    // The model is looked at with it: a Pi in a terminal changes the one the profile keeps, and the page says which it is.
    // A model picked here before that Pi came is not what that chat runs on: it waits for a Pi of the app's.
    const before = state.outside, model = (outside ? undefined : main.pick) ?? kept(directory) ?? state.model;
    if (same(model, state.model) && (outside === before || typeof outside === 'object' && typeof before === 'object' && outside.pid === before.pid && outside.host === before.host && outside.cwd === before.cwd)) return;
    if (outside) state.outside = outside; else delete state.outside;
    state.model = model;
    this.changed(main);
  }
  private get(id: string) {
    const opened = this.windows.get(id);
    if (!opened) throw new Error(`No window ${id}.`);
    return opened;
  }
  private running(id: string) {
    const { pi } = this.get(id);
    if (!pi) throw new Error(`${id} has no Pi running: it starts on its first prompt.`);
    return pi;
  }
  private changed({ state }: Opened) { this.options.push({ push: 'window', window: { ...state } }); }
  /** The window's Pi, started first if it has none; a start under way is shared. */
  private started(opened: Opened) {
    if (opened.pi && !opened.starting) return Promise.resolve(opened.pi);
    return opened.starting ??= this.start(opened).finally(() => { opened.starting = undefined; opened.stopping = false; });
  }
  private async start(opened: Opened) {
    const { state } = opened, { home, grace } = this.options, joins = !isMain(opened), main = this.window(state.profile);
    // The first Pi on a profile owns it and a connected window is a later one, so the main window's Pi goes first. On a profile
    // a Pi outside the app holds, that one is the owner: a connected window joins it, and the main window does not start.
    // A window closed while its start was finding something out starts nothing: not its own Pi, and not the main window's.
    const closed = () => { if (this.closing || opened.closed || opened.stopping) throw new Error(`${state.id} was closed before it started.`); };
    await this.look(main);
    closed();
    if (joins && !main.state.outside) await this.started(main);
    if (!joins && state.outside) throw new Error('This chat is running outside the app.');
    const { command, args } = await this.options.pi();
    closed();
    Object.assign(opened, { records: [], dropped: state.seq, fault: undefined });
    opened.ui.clear();
    state.status = 'starting'; delete state.error; this.changed(opened);
    // pi-optchat's --optchat-connect: a connected window only ever joins the profile's owner, and the main window only ever is
    // the owner. Should a Pi outside the app take the profile just now, it fails with who that is, and never joins it unasked.
    const pi: Pi = new Pi({ command, args: [...args, '--append-system-prompt', PROMPT, '--optchat-profile', state.profile, '--optchat-connect', joins ? 'join' : 'off'], cwd: state.cwd, env: { ...process.env, OPTCHAT_HOME: home } },
      record => this.record(opened, record), error => this.exited(opened, pi, error));
    opened.pi = pi;
    try {
      // Pi answers once its extensions have started the session, so by now pi-optchat has the profile or has said why not.
      // Without its profile it takes every prompt and answers nothing, so such a Pi is stopped, not left looking idle.
      await pi.request({ type: 'get_state' });
      if (!opens(opened)) throw new Error(opened.fault ?? `pi-optchat did not open the profile. Is pi-optchat ${MINIMUM_OPTCHAT} or newer installed in this Pi? (pi install npm:pi-optchat)`);
      // The model picked before it ran. A Pi that cannot take it does not start, and says why; the pick is kept, so that the
      // next message does not go to another model unasked.
      await this.choose(opened, pi, opened.pick);
      opened.pick = undefined;
    } catch (error) {
      opened.fault = reason(error);
      await pi.stop(grace);
      if (!joins) await this.look(opened);
      throw error;
    }
    if (state.status === 'starting') { state.status = 'idle'; this.changed(opened); }
    return pi;
  }
  /** Gives a Pi the model `wanted`, if any, and takes its word for what it then runs on. Pi's `set_model` picks a thinking
   * level of its own for the model, so the level is set after it. */
  private async choose({ state }: Opened, pi: Pi, wanted?: ModelChoice) {
    if (wanted) {
      await pi.request({ type: 'set_model', provider: wanted.provider, modelId: wanted.model });
      await pi.request({ type: 'set_thinking_level', level: wanted.thinking });
    }
    state.model = await chosen(pi) ?? state.model;
  }
  /** Stops the window's Pi, one that is still starting too: it need not answer first. */
  private async stop(opened: Opened) {
    // With no Pi yet, a start is still finding out what to run (who holds the profile, which Pi, the main window's Pi for a
    // connected one): it is told to spawn none.
    if (!opened.pi) { opened.stopping = opened.starting !== undefined; return; }
    await opened.pi.stop(this.options.grace);
    await opened.starting?.catch(() => {});
  }
  private exited(opened: Opened, pi: Pi, error?: string) {
    if (opened.pi !== pi) return;
    const { state } = opened, why = state.status === 'starting' ? opened.fault ?? error : error;
    opened.pi = undefined; opened.ui.clear();
    state.status = 'stopped'; delete state.completed;
    if (why) state.error = why;
    this.changed(opened);
  }
  private record(opened: Opened, record: PiRecord) {
    const { state } = opened;
    // A run begins at the first agent_start since Pi settled: until agent_settled it may still retry, or go on with queued messages.
    const begins = record.type === 'agent_start' && state.status !== 'running';
    switch (record.type) {
      case 'agent_start': if (begins) { opened.records = []; opened.dropped = state.seq; } break;
      // A finished message or tool call carries all its streaming updates said, so those are no longer kept.
      case 'message_end': opened.records = opened.records.filter(kept => kept.record.type !== 'message_update'); break;
      case 'tool_execution_end': opened.records = opened.records.filter(kept => kept.record.type !== 'tool_execution_update' || kept.record.toolCallId !== record.toolCallId); break;
      case 'extension_error': if (record.event === 'session_start') opened.fault = typeof record.error === 'string' ? record.error : 'pi-optchat could not start.'; break;
      case 'extension_ui_request': this.shown(opened, record); break;
    }
    const seq = ++state.seq;
    opened.records.push({ seq, record });
    this.options.push({ push: 'record', window: state.id, seq, record });
    if (begins || record.type === 'agent_settled' && state.status === 'running') { state.status = begins ? 'running' : 'idle'; this.changed(opened); }
  }
  /** Keeps what an extension shows until it replaces or clears it, and a dialog until it is answered. */
  private shown(opened: Opened, record: PiRecord) {
    const { method, id, statusKey, statusText, widgetKey, widgetLines, timeout } = record;
    const keep = (key: string, shows = true) => { if (shows) opened.ui.set(key, record); else opened.ui.delete(key); };
    if (method === 'setTitle') keep('title');
    else if (method === 'setWidget') keep(`widget ${String(widgetKey)}`, widgetLines !== undefined);
    else if (method === 'setStatus') {
      keep(`status ${String(statusKey)}`, statusText !== undefined);
      if (statusKey === ROLE_STATUS) this.role(opened, statusText);
    } else if (typeof id === 'string' && typeof method === 'string' && DIALOGS.includes(method)) {
      keep(`dialog ${id}`);
      // Pi answers a dialog itself when its time is up.
      if (typeof timeout === 'number' && timeout > 0) setTimeout(() => opened.ui.delete(`dialog ${id}`), timeout).unref();
    }
  }
  /** `status` is pi-optchat's role as JSON, or nothing once its Pi has no profile open. All the app needs of it is whether a
   * connected window's conversation is handed off, and where the one it is in began (`after`, which pi-optchat says once a
   * conversation goes on in a session that has one handed off: as your next message arrives, and before the run). Which Pi
   * owns the profile and which is a window on it is the app's own doing. The cut outlives the Pi that said it, since the page
   * still shows that Pi's messages; a Pi started later says none, and all it says is later than the cut there was. */
  private role(opened: Opened, status: unknown) {
    const { state } = opened, { completed = false, after = state.since } = role(status) ?? {};
    if ((state.completed ?? false) === completed && state.since === after) return;
    if (completed) state.completed = true; else delete state.completed;
    if (after !== undefined) state.since = after;
    this.changed(opened);
  }
}
