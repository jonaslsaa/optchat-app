import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { PiRecord } from '../protocol.ts';

export interface PiOptions { command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }
const isRecord = (value: unknown): value is PiRecord => typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
/** How much of Pi's stderr is kept to explain an exit. */
const STDERR = 4000;

/** One `pi --mode rpc` process (Pi's docs: rpc.md), `args` going before `--mode`. Commands go in as JSON lines and are matched to their responses by id; every
 * other record Pi writes goes to `onRecord`, with its size as written. `onExit` gets why Pi exited when it failed. */
export class Pi {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  private requests = 0;
  private stderr = '';
  private readonly exited: Promise<void>;
  constructor({ command, args, cwd, env }: PiOptions, onRecord: (record: PiRecord, bytes: number) => void, onExit: (error?: string) => void) {
    // Its own process group, as T3 Code does: a Ctrl+C in the server's terminal then reaches only the server, which stops Pi in
    // order, and a kill takes the tools Pi started with it.
    const child = this.child = spawn(command, [...args, '--mode', 'rpc'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    // Records end at a line feed and nowhere else: U+2028 and U+2029 are legal inside JSON strings, so no readline.
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      for (let end: number; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) {
        const line = buffer.slice(0, end);
        let record: unknown;
        try { record = JSON.parse(line); } catch { continue; }
        if (!isRecord(record)) continue;
        const waiting = record.type === 'response' && typeof record.id === 'string' ? this.pending.get(record.id) : undefined;
        if (!waiting) { onRecord(record, line.length); continue; }
        this.pending.delete(String(record.id));
        if (record.success === true) waiting.resolve(record.data);
        else waiting.reject(new Error(typeof record.error === 'string' ? record.error : 'Pi refused the command.'));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-STDERR); });
    child.stdin?.on('error', () => {}); // Writing to a Pi that just exited: its exit says what happened.
    this.exited = new Promise(resolve => {
      let over = false;
      const done = (error?: string) => {
        if (over) return;
        over = true;
        for (const { reject } of this.pending.values()) reject(new Error(error ?? 'Pi exited.'));
        this.pending.clear();
        onExit(error); resolve();
      };
      child.once('error', error => done(`Could not start ${command}: ${error.message}`));
      child.once('exit', (code, signal) => done(code === 0 || this.stopping ? undefined : `Pi exited (${signal ?? `code ${code}`}). ${this.stderr.trim()}`.trim()));
    });
  }
  private stopping = false;
  get pid() { return this.child.pid; }
  /** Sends a command and resolves with its response's `data`, or rejects with its error. */
  request(command: PiRecord) {
    return new Promise<unknown>((resolve, reject) => {
      const id = `app-${++this.requests}`;
      this.pending.set(id, { resolve, reject });
      this.send({ ...command, id });
    });
  }
  /** Sends a record that gets no response, such as an `extension_ui_response`. */
  send(record: PiRecord) { this.child.stdin?.write(`${JSON.stringify(record)}\n`); }
  /** Closing stdin asks Pi for an orderly shutdown: pi-optchat saves its memory and releases the profile. Pi and what it started
   * are killed only if it has not exited after `grace` milliseconds. */
  async stop(grace: number) {
    this.stopping = true;
    this.child.stdin?.end();
    const kill = setTimeout(() => {
      const { pid } = this.child;
      if (pid === undefined || this.child.exitCode !== null || this.child.signalCode !== null) return;
      try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL'); } catch {}
    }, grace);
    await this.exited;
    clearTimeout(kill);
  }
}
