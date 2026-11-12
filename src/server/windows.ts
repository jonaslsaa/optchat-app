import { existsSync } from 'node:fs';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { methods, type Params, type PiRecord, type Push, type Result, type WindowState } from '../protocol.ts';
import { canComplete } from '../window.ts';
import { Pi, reason } from './pi.ts';
import { profileDirectory } from './profiles.ts';

export interface WindowsOptions {
  home: string;
  /** Where a window's Pi runs unless `open` names a directory. */
  cwd: string;
  /** The Pi to run, and arguments to give it before `--optchat-profile <name> --mode rpc`. */
  pi: { command: string; args: readonly string[] };
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
  /** Its conversation is being handed off: Complete has not answered yet. */
  completing?: boolean;
  /** When the window's Pi last said its conversation was handed off. */
  ended?: number;
}
/** What pi-optchat says a Pi in RPC mode is to its profile: JSON in a `setStatus` with this key (its docs/connected-windows.md),
 * sent as the session starts, so before Pi's first answer; a Pi that has not sent it by then has no profile open. This is the
 * one place that reads it, and it reads only these two fields. */
const ROLE_STATUS = 'optchat.role';
const Role = Type.Object({ profile: Type.String(), completed: Type.Optional(Type.Boolean()) });
/** pi-optchat's role as it stands, or nothing: from another program, or a pi-optchat too old to say. */
function role(status: unknown) {
  try {
    const role: unknown = JSON.parse(String(status));
    return Value.Check(Role, role) ? role : undefined;
  } catch { return undefined; }
}
const opens = ({ ui, state }: Opened) => role(ui.get(`status ${ROLE_STATUS}`)?.statusText)?.profile === state.profile;
const DIALOGS = ['select', 'confirm', 'input', 'editor'];
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
  open({ profile, role = 'main', cwd = this.options.cwd }: Params<'open'>): Result<'open'> {
    profileDirectory(this.options.home, profile);
    const id = role === 'main' ? mainId(profile) : `${profile}/${++this.connected}`;
    let opened = this.windows.get(id);
    if (!opened) {
      if (!existsSync(cwd)) throw new Error(`No such directory: ${cwd}`);
      opened = { state: { id, profile, role, cwd, status: 'stopped', seq: 0 }, records: [], dropped: 0, ui: new Map() };
      this.windows.set(id, opened);
      this.changed(opened);
    }
    return { window: opened.state };
  }
  async prompt({ window, text, images, whenBusy = 'steer' }: Params<'prompt'>): Promise<Result<'prompt'>> {
    const opened = this.get(window);
    // It would steer the agent while it writes its handoff, and be part of neither conversation.
    if (opened.completing) throw new Error('This conversation is being handed to the main chat. Send your message once it is.');
    const pi = await this.started(opened);
    // Always with a queueing behaviour, as T3 Code sends it: Pi then starts a run or queues the message, whichever is true by
    // the time it arrives, and a run that began meanwhile (a subagent's report) cannot make it fail.
    return answered('prompt', methods.prompt.result, await pi.request({ type: 'prompt', message: text, ...images?.length && { images }, streamingBehavior: whenBusy }));
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
    opened.completing = true;
    try { await this.running(window).request({ type: 'prompt', message: '/complete' }); } finally { opened.completing = false; }
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
    return { data: await this.running(window).request(command) };
  }
  answer({ window, ...response }: Params<'answer'>): Result<'answer'> {
    this.running(window).send({ type: 'extension_ui_response', ...response });
    this.get(window).ui.delete(`dialog ${response.id}`);
    return {};
  }
  /** Stops every Pi and starts no more. Connected windows go first: each hands its conversation to the profile's owner as it
   * leaves, so the owner has to be there still. */
  async shutdown() {
    this.closing = true;
    const windows = [...this.windows.values()];
    await Promise.all(windows.filter(opened => !isMain(opened)).map(opened => this.stop(opened)));
    await Promise.all(windows.filter(isMain).map(opened => this.stop(opened)));
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
    return opened.starting ??= this.start(opened).finally(() => { opened.starting = undefined; });
  }
  private async start(opened: Opened) {
    const { state } = opened, { home, pi: { command, args }, grace } = this.options, joins = !isMain(opened);
    // The first Pi on a profile owns it and a connected window is a later one, so the main window's Pi goes first.
    if (joins) await this.started(this.get(this.open({ profile: state.profile }).window.id));
    if (this.closing || opened.closed) throw new Error(`${state.id} was closed before it started.`);
    Object.assign(opened, { records: [], dropped: state.seq, fault: undefined });
    opened.ui.clear();
    state.status = 'starting'; delete state.error; this.changed(opened);
    // pi-optchat's --optchat-connect: a connected window only ever joins the profile's owner, and the main window only ever is
    // the owner. On a profile a Pi outside the app holds, it fails with who that is, and never joins it unasked.
    const pi: Pi = new Pi({ command, args: [...args, '--optchat-profile', state.profile, '--optchat-connect', joins ? 'join' : 'off'], cwd: state.cwd, env: { ...process.env, OPTCHAT_HOME: home } },
      record => this.record(opened, record), error => this.exited(opened, pi, error));
    opened.pi = pi;
    try {
      // Pi answers once its extensions have started the session, so by now pi-optchat has the profile or has said why not.
      // Without its profile it takes every prompt and answers nothing, so such a Pi is stopped, not left looking idle.
      await pi.request({ type: 'get_state' });
      if (!opens(opened)) throw new Error(opened.fault ?? 'pi-optchat did not open the profile. Is pi-optchat 0.11.9 or newer installed in this Pi? (pi install npm:pi-optchat)');
    } catch (error) {
      opened.fault = reason(error);
      await pi.stop(grace);
      throw error;
    }
    if (state.status === 'starting') { state.status = 'idle'; this.changed(opened); }
    return pi;
  }
  /** Stops the window's Pi, one that is still starting too: it need not answer first. */
  private async stop(opened: Opened) {
    // With no Pi yet, a start is waiting for the main window's Pi, and spawns none for a window that is closed.
    if (!opened.pi) return;
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
   * connected window's conversation is handed off: which Pi owns the profile and which is a window on it is the app's own doing.
   * A conversation that is handed off stays the window's until its Pi says it is in another, which it does as your next message
   * arrives and before the run: that one began after the last ended, and every message of it is later than that. Pi says a
   * conversation is handed off before it answers Complete, and no message is passed on until it has, so none can be earlier. */
  private role(opened: Opened, status: unknown) {
    const { state } = opened, completed = role(status)?.completed === true;
    if ((state.completed ?? false) === completed) return;
    if (completed) { state.completed = true; opened.ended = Date.now(); }
    else { delete state.completed; if (opened.ended !== undefined) state.since = opened.ended; }
    this.changed(opened);
  }
}
