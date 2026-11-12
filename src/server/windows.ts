import { existsSync } from 'node:fs';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { methods, type Params, type PiRecord, type Push, type Result, type WindowState } from '../protocol.ts';
import { profileDirectory } from './disk.ts';
import { Pi } from './pi.ts';

export interface WindowsOptions {
  home: string;
  /** Where a window's Pi runs unless `open` names a directory. */
  cwd: string;
  /** The Pi to run, and arguments to give it before `--optchat-profile <name> --mode rpc`. */
  pi: { command: string; args: readonly string[] };
  /** How long a Pi asked to stop may take before it is killed, in milliseconds. */
  grace: number;
  /** The most bytes of records a window keeps for clients that reconnect. */
  keep: number;
  push(push: Push): void;
}
interface Kept { seq: number; record: PiRecord; bytes: number }
interface Opened {
  state: WindowState; pi?: Pi; starting?: Promise<Pi>;
  /** Everything Pi wrote since the latest run began, less the streaming updates a later record made redundant. */
  records: Kept[]; bytes: number;
  /** The last record dropped to stay under `keep`. */
  dropped: number;
  /** No run is going, so the next `agent_start` begins a new one. */
  settled: boolean;
  /** Why pi-optchat could not open the profile in this Pi. */
  fault?: string;
  /** pi-optchat said this Pi joined the profile as a connected window. */
  joined: boolean;
}
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
/** What pi-optchat says a Pi in RPC mode is to its profile: JSON in a `setStatus` with this key (its docs/connected-windows.md). */
const ROLE_STATUS = 'optchat.role';
const Role = Type.Union([Type.Object({ role: Type.Literal('owner') }), Type.Object({ role: Type.Literal('window'), id: Type.String(), completed: Type.Boolean() })]);
const mainId = (profile: string) => `${profile}/main`;

/** The windows: one Pi in RPC mode each, started on a window's first prompt and kept when clients come and go. Pi and pi-optchat do
 * all the work; this only starts and stops them, passes commands in, and pushes out what Pi writes. */
export class Windows {
  private readonly windows = new Map<string, Opened>();
  private connected = 0;
  private readonly options: WindowsOptions;
  constructor(options: WindowsOptions) { this.options = options; }

  list(): Result<'windows'> { return { windows: [...this.windows.values()].map(w => w.state) }; }
  open({ profile, role = 'main', cwd }: Params<'open'>): Result<'open'> {
    profileDirectory(this.options.home, profile);
    if (cwd !== undefined && !existsSync(cwd)) throw new Error(`No such directory: ${cwd}`);
    const id = role === 'main' ? mainId(profile) : `${profile}/${++this.connected}`;
    let opened = this.windows.get(id);
    if (!opened) {
      opened = { state: { id, profile, role, cwd: cwd ?? this.options.cwd, status: 'stopped', seq: 0 }, records: [], bytes: 0, dropped: 0, settled: true, joined: false };
      this.windows.set(id, opened);
      this.changed(opened);
    } else if (cwd !== undefined && cwd !== opened.state.cwd) {
      if (opened.state.status !== 'stopped') throw new Error(`${id} is running in ${opened.state.cwd}. Close it to move it.`);
      opened.state.cwd = cwd; this.changed(opened);
    }
    return { window: opened.state };
  }
  async prompt({ window, text, images, whenBusy = 'steer' }: Params<'prompt'>): Promise<Result<'prompt'>> {
    const opened = this.get(window);
    if (opened.state.completed) throw new Error('This connected conversation is completed and handed off. Open a new window to go on.');
    const pi = await this.started(opened);
    // Always with a queueing behaviour, as T3 Code sends it: Pi then starts a run or queues the message, whichever is true by
    // the time it arrives, and a run that began meanwhile (a subagent's report) cannot make it fail.
    const data = await pi.request({ type: 'prompt', message: text, ...images?.length && { images }, streamingBehavior: whenBusy });
    if (!Value.Check(methods.prompt.result, data)) throw new Error('Pi accepted the prompt without saying what became of it. Update Pi.');
    return data;
  }
  async abort({ window }: Params<'abort'>): Promise<Result<'abort'>> {
    const pi = this.running(window);
    const queued = await pi.request({ type: 'clear_queue' });
    await pi.request({ type: 'abort' });
    return Value.Check(methods.abort.result, queued) ? queued : { steering: [], followUp: [] };
  }
  async complete({ window }: Params<'complete'>): Promise<Result<'complete'>> {
    if (this.get(window).state.role !== 'connected') throw new Error('Complete hands a connected window to the main chat. The main chat has nothing to hand off.');
    await this.running(window).request({ type: 'prompt', message: '/complete' });
    return {};
  }
  async close({ window }: Params<'close'>): Promise<Result<'close'>> {
    const opened = this.get(window);
    await this.stop(opened);
    if (window !== mainId(opened.state.profile)) { this.windows.delete(window); opened.state.status = 'closed'; this.changed(opened); }
    return {};
  }
  records({ window, after = 0 }: Params<'records'>): Result<'records'> {
    const opened = this.get(window);
    return { records: opened.records.filter(r => r.seq > after).map(({ seq, record }) => ({ seq, record })), complete: after >= opened.dropped };
  }
  async command({ window, command }: Params<'command'>): Promise<Result<'command'>> { return { data: await this.running(window).request(command) }; }
  answer({ window, ...response }: Params<'answer'>): Result<'answer'> { this.running(window).send({ type: 'extension_ui_response', ...response }); return {}; }
  /** Stops every Pi, each in its own time. */
  async shutdown() { await Promise.all([...this.windows.values()].map(opened => this.stop(opened))); }

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
    const { state } = opened, { home, pi: { command, args }, grace } = this.options, joins = state.id !== mainId(state.profile);
    // The first Pi on a profile owns it, and a connected window is a later one: the main window's Pi goes first. If a Pi outside
    // the app owns the profile, the main window's joins it as well.
    if (joins) await this.started(this.get(this.open({ profile: state.profile }).window.id));
    Object.assign(opened, { records: [], bytes: 0, dropped: state.seq, settled: true, fault: undefined, joined: false });
    state.status = 'starting'; delete state.error; delete state.completed; delete state.agent; this.changed(opened);
    // pi-optchat's --optchat-connect: `join` never takes the profile itself, the default joins only a profile that is taken.
    const pi: Pi = new Pi({ command, args: [...args, '--optchat-profile', state.profile, ...joins ? ['--optchat-connect', 'join'] : []], cwd: state.cwd, env: { ...process.env, OPTCHAT_HOME: home } },
      (record, bytes) => this.record(opened, record, bytes), error => this.exited(opened, pi, error));
    opened.pi = pi;
    try {
      // Pi answers once its extensions have started the session, so by now pi-optchat has the profile or has said why not.
      await pi.request({ type: 'get_state' });
      // A pi-optchat up to 0.11.8 cannot join in RPC mode: it ignores the flag and fails on the taken profile, or takes a free one.
      if (joins && !opened.joined) opened.fault = `This Pi's pi-optchat cannot run a connected window yet: it needs the version after 0.11.8.${opened.fault ? ` (${opened.fault})` : ''}`;
      // Without its profile pi-optchat takes every prompt and answers nothing, so such a Pi is stopped, not left looking idle.
      if (opened.fault) throw new Error(opened.fault);
    } catch (error) {
      opened.fault ??= reason(error);
      await pi.stop(grace);
      throw error;
    }
    if (state.status === 'starting') { state.status = 'idle'; this.changed(opened); }
    return pi;
  }
  private async stop(opened: Opened) {
    await opened.starting?.catch(() => {});
    await opened.pi?.stop(this.options.grace);
  }
  private exited(opened: Opened, pi: Pi, error?: string) {
    if (opened.pi !== pi) return;
    opened.pi = undefined; opened.settled = true;
    const why = opened.fault ?? error;
    opened.state.status = 'stopped';
    if (why) opened.state.error = why;
    this.changed(opened);
  }
  private record(opened: Opened, record: PiRecord, bytes: number) {
    const { state } = opened;
    if (record.type === 'extension_error' && record.event === 'session_start') opened.fault = typeof record.error === 'string' ? record.error : 'pi-optchat could not start.';
    if (record.type === 'extension_ui_request' && record.statusKey === ROLE_STATUS && typeof record.statusText === 'string') this.role(opened, record.statusText);
    // A run begins at the first agent_start after Pi settled. Until agent_settled Pi may still retry, or go on with queued messages.
    if (record.type === 'agent_start' && opened.settled) { opened.records = []; opened.bytes = 0; opened.dropped = state.seq; opened.settled = false; }
    // A finished message or tool call carries all its streaming updates said, so those are no longer kept.
    if (record.type === 'message_end') this.forget(opened, r => r.type === 'message_update');
    if (record.type === 'tool_execution_end') this.forget(opened, r => r.type === 'tool_execution_update' && r.toolCallId === record.toolCallId);
    const seq = ++state.seq;
    opened.records.push({ seq, record, bytes }); opened.bytes += bytes;
    while (opened.bytes > this.options.keep && opened.records.length > 1) {
      const oldest = opened.records.shift()!;
      opened.bytes -= oldest.bytes; opened.dropped = oldest.seq;
    }
    this.options.push({ push: 'record', window: state.id, seq, record });
    if (record.type === 'agent_start' && state.status !== 'running') { state.status = 'running'; this.changed(opened); }
    if (record.type === 'agent_settled') { opened.settled = true; if (state.status === 'running') { state.status = 'idle'; this.changed(opened); } }
  }
  private role(opened: Opened, status: string) {
    let role: unknown;
    try { role = JSON.parse(status); } catch { return; }
    if (!Value.Check(Role, role)) return;
    const { state } = opened, window = role.role === 'window' ? role : undefined, completed = window?.completed || undefined;
    opened.joined = !!window;
    if (state.role === (window ? 'connected' : 'main') && state.agent === window?.id && state.completed === completed) return;
    state.role = window ? 'connected' : 'main';
    if (window) state.agent = window.id; else delete state.agent;
    if (completed) state.completed = true; else delete state.completed;
    this.changed(opened);
  }
  private forget(opened: Opened, redundant: (record: PiRecord) => boolean) {
    opened.records = opened.records.filter(kept => {
      if (!redundant(kept.record)) return true;
      opened.bytes -= kept.bytes; return false;
    });
  }
}
