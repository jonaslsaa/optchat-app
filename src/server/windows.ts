import { existsSync } from 'node:fs';
import { Value } from 'typebox/value';
import { methods, type Params, type PiRecord, type Push, type Result, type Window } from '../protocol.ts';
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
  state: Window; pi?: Pi; starting?: Promise<Pi>;
  /** Everything Pi wrote since the latest run began, less the streaming updates a later record made redundant. */
  records: Kept[]; bytes: number;
  /** The last record dropped to stay under `keep`. */
  dropped: number;
  /** No run is going, so the next `agent_start` begins a new one. */
  settled: boolean;
  /** Why pi-optchat could not open the profile in this Pi. */
  fault?: string;
}
const text = (error: unknown) => error instanceof Error ? error.message : String(error);

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
    const id = role === 'main' ? `${profile}/main` : `${profile}/${++this.connected}`;
    let opened = this.windows.get(id);
    if (!opened) {
      opened = { state: { id, profile, role, cwd: cwd ?? this.options.cwd, status: 'stopped', seq: 0 }, records: [], bytes: 0, dropped: 0, settled: true };
      this.windows.set(id, opened);
      this.changed(opened);
    } else if (cwd !== undefined && cwd !== opened.state.cwd) {
      if (opened.state.status !== 'stopped') throw new Error(`${id} is running in ${opened.state.cwd}. Close it to move it.`);
      opened.state.cwd = cwd; this.changed(opened);
    }
    return { window: opened.state };
  }
  async prompt({ window, text, images, whenBusy = 'steer' }: Params<'prompt'>): Promise<Result<'prompt'>> {
    const pi = await this.started(this.get(window));
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
    if (this.get(window).state.role !== 'connected') throw new Error('Complete hands a connected window back to the main chat. The main window has nothing to hand off.');
    await this.running(window).request({ type: 'prompt', message: '/complete' });
    return {};
  }
  async close({ window }: Params<'close'>): Promise<Result<'close'>> {
    const opened = this.get(window);
    await this.stop(opened);
    if (opened.state.role === 'connected') { this.windows.delete(window); opened.state.status = 'closed'; this.changed(opened); }
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
  private started(opened: Opened) { return opened.pi && !opened.starting ? Promise.resolve(opened.pi) : opened.starting ??= this.start(opened).finally(() => { opened.starting = undefined; }); }
  private async start(opened: Opened) {
    const { state } = opened, { home, pi: { command, args }, grace } = this.options;
    Object.assign(opened, { records: [], bytes: 0, dropped: state.seq, settled: true, fault: undefined });
    state.status = 'starting'; delete state.error; this.changed(opened);
    const pi: Pi = new Pi({ command, args: [...args, '--optchat-profile', state.profile], cwd: state.cwd, env: { ...process.env, OPTCHAT_HOME: home } },
      (record, bytes) => this.record(opened, record, bytes), error => this.exited(opened, pi, error));
    opened.pi = pi;
    try {
      // Pi answers once its extensions have started the session, so by now pi-optchat has the profile or has said why not.
      await pi.request({ type: 'get_state' });
      // Without its profile pi-optchat takes every prompt and answers nothing, so such a Pi is stopped, not left looking idle.
      if (opened.fault) throw new Error(opened.fault);
    } catch (error) {
      opened.fault ??= text(error);
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
  private forget(opened: Opened, redundant: (record: PiRecord) => boolean) {
    opened.records = opened.records.filter(kept => {
      if (!redundant(kept.record)) return true;
      opened.bytes -= kept.bytes; return false;
    });
  }
}
