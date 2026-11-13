import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { methods, type Params, type Result, type Setup as State } from '../protocol.ts';
import { killTree, Pi } from './pi.ts';

/** What a chat needs before it can run, and getting it: Pi, pi-optchat installed in that Pi, and a model provider that is logged
 * in. The shape follows T3 Code's provider checks (its `provider-pi/src/server/status.ts` and `providerMaintenanceRunner.ts`):
 * one state per thing with one message that names the exact command, and installs that push their latest line as they run. */

/** The Pi and pi-optchat this app is tested with; older ones are told to update. pi-optchat's Pi has to take what the app asks
 * of it through the profile's socket: a word to an agent (0.11.11) and a change of settings (0.11.12). An older one drops the
 * connection instead. */
export const MINIMUM_PI = '1.5.2', MINIMUM_OPTCHAT = '0.11.12';
const PI_PACKAGE = '@earendil-works/pi-coding-agent', OPTCHAT = 'npm:pi-optchat';
/** A command, and the arguments that are part of it (a script's path, for a Pi that is run through Node). */
export interface Launch { command: string; args: readonly string[] }
export interface SetupOptions {
  /** The app's own folder. The Pi the app installs goes in `pi` under it, and never anywhere else. */
  app: string;
  /** The Pi to look for first: yours, on the PATH. */
  pi?: Launch;
  /** The npm that installs Pi into the app's folder. */
  npm?: Launch;
  /** What opens a file in a terminal of its own, for Pi's sign-in (`terminal()`). Without it the app opens none. */
  opener?: Launch;
  push: (setup: State) => void;
}

/** A Pi that runs. `managed`: it is the one the app installed, so the app's to update. `listed`: it was found on your PATH. */
interface Found extends Launch { path: string; managed: boolean; listed: boolean; version: string }
/** What one look found: the Pi, if there is one, and what the page is told. Everything that asks reads the same look. */
interface Checked { found?: Found; state: Omit<State, 'job'> }
/** How much of what an install printed is kept to explain its failure, and how much of one line. */
const TAIL = 4000, LINE = 1000;
/** Whether a version is before another, by its three numbers: a pre-release counts as its release. */
const older = (version: string, than: string) => {
  const [a, b] = [version, than].map(v => /(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number) ?? [0, 0, 0]);
  return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
};
const same = (a: string, b: string) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
const runs = (file: string) => { try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; } };
/** The file a command is, as a whole path, so that it is the same file wherever it is run from: a window runs in its own
 * folder. A name is looked up on the PATH as a shell does, less the entries that are not whole paths, since those mean
 * another folder in each place. */
const where = (command: string) => command.includes(sep) ? resolve(command)
  : (process.env.PATH ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, command)).find(runs);
/** A word as a shell reads it, whole and as it is: in single quotes when it has more in it than a plain path does. */
const word = (text: string) => /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
/** A command as a line for a terminal. */
const shown = ({ command, args }: Launch, more: readonly string[] = []) => [command, ...args, ...more].map(word).join(' ');

/** Runs a command to its end, without a terminal: in its own session it cannot ask one a question, and is killed with what it
 * started when its time is up, or when `signal` says so. `missing`: there is no such command. `output` is everything it
 * printed, or with `tail` only that much of its end, for a command that may print without end. `onLine` gets each line as it
 * is printed. */
function run({ command, args }: Launch, more: readonly string[], { cwd, timeout, signal, tail, onLine }: { cwd: string; timeout: number; signal: AbortSignal; tail?: number; onLine?: (line: string) => void }) {
  return new Promise<{ code: number | null; missing: boolean; output: string }>(resolve => {
    const child = spawn(command, [...args, ...more], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', rest = '';
    const say = (text: string) => { const line = stripVTControlCharacters(text).replace(/\s+/g, ' ').trim(); if (line) onLine?.(line); };
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (tail !== undefined) output = output.slice(-tail);
      // A progress bar redraws its line with a carriage return: each redraw is a line here.
      const lines = (rest + chunk.toString()).split(/\r\n|\r|\n/);
      rest = (lines.pop() ?? '').slice(-LINE); // A line that never ends is not kept whole.
      for (const line of lines) say(line);
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    // Its output is let go of as well: something it started and left behind may hold that open after it is gone itself.
    const end = () => { killTree(child); child.stdout.destroy(); child.stderr.destroy(); }, kill = setTimeout(end, timeout);
    if (signal.aborted) end(); else signal.addEventListener('abort', end);
    const done = (code: number | null, missing = false) => { clearTimeout(kill); signal.removeEventListener('abort', end); say(rest); resolve({ code, missing, output: stripVTControlCharacters(output).trim() }); };
    child.once('error', error => done(null, 'code' in error && error.code === 'ENOENT'));
    child.once('close', code => done(code));
  });
}
const Models = Type.Object({ models: Type.Array(Type.Object({ provider: Type.String(), id: Type.String() })) });
/** What opens a `.command` file in a terminal of its own on this system: macOS's `open`. Elsewhere there is none yet, and the
 * page shows the command to run. */
export const terminal = (): Launch | undefined => process.platform === 'darwin' ? { command: '/usr/bin/open', args: [] } : undefined;

export class Setup {
  private readonly options: Required<Omit<SetupOptions, 'opener'>> & Pick<SetupOptions, 'opener'>;
  /** The Pi the app installed, if it has. */
  private readonly managed: Launch;
  private checked?: Promise<Checked>;
  private job?: State['job'];
  private pushing?: ReturnType<typeof setTimeout>;
  private readonly closing = new AbortController();
  constructor({ app, push, opener, pi = { command: 'pi', args: [] }, npm = { command: 'npm', args: [] } }: SetupOptions) {
    this.options = { app, push, pi, npm, opener };
    this.managed = { command: join(app, 'pi', 'node_modules', '.bin', 'pi'), args: [] };
  }
  /** The Pi a window runs: yours if you have one, else the one the app installed. */
  async launch(): Promise<Launch> {
    let { found } = await this.look();
    // It may have been installed since, in a terminal: the page hears of what a second look finds.
    if (!found) { ({ found } = await this.look(true)); void this.push(); }
    if (!found) throw new Error('Pi is not installed. Open the settings to install it.');
    return found;
  }
  /** What is there, as last checked; `fresh` checks again. */
  async state({ fresh = false }: Params<'setup'> = {}): Promise<State> {
    return { ...(await this.look(fresh)).state, ...this.job && { job: this.job } };
  }
  /** Starts an install, or an update of what is too old. One runs at a time, and only of what is the app's to change: a Pi
   * goes into the app's own folder with npm, running no package's scripts, and pi-optchat is installed by the Pi that has it. */
  async install({ what }: Params<'install'>) {
    const { found, state } = await this.look(), need = what === 'pi' ? state.pi : state.optchat, { npm } = this.options;
    const launch = what === 'pi' ? { ...npm, command: where(npm.command) ?? npm.command } : found;
    if (this.job?.state === 'running') throw new Error('An install is already running.');
    if (need.state === 'ok') throw new Error('It is installed already, and new enough.');
    if (!need.installable || !launch) throw new Error(need.message ?? 'Install Pi first.');
    const args = what === 'pi' ? ['install', '--prefix', join(this.options.app, 'pi'), '--ignore-scripts', '--no-audit', '--no-fund', `${PI_PACKAGE}@latest`]
      : [need.state === 'old' ? 'update' : 'install', OPTCHAT];
    mkdirSync(this.options.app, { recursive: true });
    void this.work(what, launch, args);
  }
  private async work(what: Params<'install'>['what'], launch: Launch, args: string[]) {
    this.job = { what, state: 'running', line: `Running: ${shown(launch, args)}` };
    void this.push();
    let failed: string | undefined, last = '';
    const { code, missing, output } = await run(launch, args, {
      cwd: this.options.app, timeout: 30 * 60_000, signal: this.closing.signal, tail: TAIL,
      onLine: line => {
        last = line;
        if (/error|fail/i.test(line)) failed ??= line;
        // An install prints faster than anyone reads: the latest line goes out once a second.
        this.job = { what, state: 'running', line: line.slice(0, 200) };
        this.pushing ??= setTimeout(() => void this.push(), 1000);
      },
    });
    if (this.closing.signal.aborted) return;
    // It worked if what it was for is there now, whatever the command said of itself.
    const { state } = await this.look(true), name = basename(launch.command);
    this.job = (what === 'pi' ? state.pi : state.optchat).state === 'ok' ? { what, state: 'done', line: 'Done.' } : {
      what, state: 'failed', output,
      line: (missing ? `${launch.command} was not found on this machine.` : code === 0 ? `${name} ran to its end, but what it was to install is not there.` : `${name} ended with code ${code}: ${failed ?? last}`).slice(0, 300),
    };
    void this.push();
  }
  /** Opens a terminal of your own in which Pi signs you in to `provider`: `pi auth login`, which needs a terminal, and opens
   * your browser itself. The line is written to a file in the app's folder and that file is opened. Nothing from the page is
   * in it but the provider, which is one of the few the protocol names. What is asked, typed and stored there is between you
   * and Pi: the app reads none of it. */
  async signIn(params: Params<'signIn'>) {
    if (!Value.Check(methods.signIn.params, params)) throw new Error('Not a provider the app signs in to.');
    const { opener, app } = this.options, pi = await this.launch();
    // A file for each provider, so that a second sign-in started meanwhile cannot change what the first terminal runs.
    const file = join(app, `sign-in-${params.provider}.command`);
    if (!opener) throw new Error(`The app cannot open a terminal on this system. Run this in one: ${shown(pi, ['auth', 'login', params.provider])}`);
    // The Pi in the terminal keeps its files where the app's Pi does, should that not be the usual place.
    const folder = process.env.PI_CODING_AGENT_DIR;
    const lines = ['#!/bin/sh', ...folder ? [`export PI_CODING_AGENT_DIR=${word(folder)}`] : [], shown(pi, ['auth', 'login', params.provider]), 'echo', `echo 'You can close this window and go back to OptChat.'`];
    mkdirSync(app, { recursive: true });
    rmSync(file, { force: true }); // Written anew, so that it is this server's file with this mode, whatever was there.
    writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o700, flag: 'wx' });
    const { code, output } = await run(opener, [file], { cwd: app, timeout: 20_000, signal: this.closing.signal });
    if (code !== 0) throw new Error(`Could not open a terminal: ${output || basename(opener.command)}`);
  }
  /** Whether Pi can use `provider` now. Pi is asked for its word only: it refreshes nothing, and prints no credential. */
  async signedIn({ provider }: Params<'signedIn'>): Promise<Result<'signedIn'>> {
    const pi = await this.launch(), check = ['auth', 'check', '--provider', provider];
    const { output } = await this.ask(pi, [...check, '--json', '--no-refresh'], 20_000);
    let answer: unknown;
    try { answer = JSON.parse(output.split('\n').findLast(line => line.startsWith('{')) ?? ''); } catch {} // Its answer, past any warning.
    if (Value.Check(methods.signedIn.result, answer)) return { status: answer.status };
    // Pi's third word is `invalid`: it cannot read its own logins. Asking again would not change that; asking in a terminal shows it.
    const folder = process.env.PI_CODING_AGENT_DIR; // Asked where this Pi keeps its files, as the sign-in is.
    throw new Error(`Pi could not say whether it is signed in. Try in a terminal: ${folder ? `PI_CODING_AGENT_DIR=${word(folder)} ` : ''}${shown(pi, check)}`);
  }
  /** Ends what is running: the server is closing. What an install left half done, the next one puts right. */
  close() { this.closing.abort(); clearTimeout(this.pushing); }
  private async push() {
    clearTimeout(this.pushing);
    this.pushing = undefined;
    this.options.push(await this.state());
  }

  /** What is there: as last looked, or looked for again. One look at a time, each after the one before it, so what the page
   * is told last is what was found last. */
  private look(fresh = false) {
    const before = this.checked;
    return fresh || !before ? this.checked = (async () => { await before; return this.check(); })() : before;
  }
  /** One of Pi's commands that ends by itself, and everything it printed. */
  private ask(launch: Launch, args: string[], timeout: number) { return run(launch, args, { cwd: homedir(), timeout, signal: this.closing.signal }); }
  private async find(): Promise<Found | undefined> {
    for (const [{ command, args }, listed] of [[this.options.pi, true], [this.managed, false]] as const) {
      const path = where(command);
      if (!path) continue;
      const launch = { command: path, args }, { code, output } = await this.ask(launch, ['--version'], 10_000);
      // Only a Pi that ran to its end and said its version is one. A `pi` that did not is passed over for the next: the app
      // neither runs a chat through it nor changes it.
      const version = code === 0 ? /\bv?(\d+\.\d+\.\d+)\b/.exec(output)?.[1] : undefined;
      // The app's own Pi is the app's wherever it was found: its folder may be on your PATH by now.
      if (version) return { ...launch, listed, managed: same(path, this.managed.command), path, version };
    }
  }
  private async check(): Promise<Checked> {
    const found = await this.find(), unknown = { state: 'unknown' as const };
    if (!found) return { state: { pi: { state: 'missing', installable: true, message: 'Not installed. The app can install it into its own folder, where it changes nothing else on this machine.' }, optchat: unknown, login: { ...unknown, providers: [], models: [] } } };
    // In a terminal, a Pi on your PATH goes by its name; the app's own, while it is not on it, by where it is.
    const { path, managed, listed, version } = found, named = { command: listed ? this.options.pi.command : path, args: found.args };
    const pi: State['pi'] = {
      version, path,
      // Its folder as it is, whatever is in its name, then the PATH there was.
      ...!listed && { shell: `export PATH=${word(dirname(path))}:"$PATH"` },
      ...!older(version, MINIMUM_PI) ? { state: 'ok' }
        : managed ? { state: 'old', installable: true, message: `Older than ${MINIMUM_PI}, which this app is tested with.` }
        : { state: 'old', message: `Older than ${MINIMUM_PI}, which this app is tested with. It is a Pi of yours, so the app leaves it alone: update it in a terminal.`, command: shown(named, ['update', 'self']) },
    };
    const [optchat, offered] = await Promise.all([this.optchat(found, named), this.models(found)]), terminal = this.options.opener !== undefined;
    const providers = [...new Set(offered?.map(model => model.provider))].sort(), models = offered?.map(model => `${model.provider}/${model.id}`).sort() ?? [];
    const login: State['login'] = !offered ? { state: 'unknown', providers, models, message: 'Pi did not say which models it can use.' }
      : providers.length ? { state: 'ok', providers, models, terminal }
      : { state: 'missing', providers, models, terminal, message: `No model provider is logged in. Log in ${terminal ? 'with your account here, or ' : 'to one '}in a terminal (anthropic, openai-codex, github-copilot or another), then check again:`, command: shown(named, ['auth', 'login', 'anthropic']) };
    return { found, state: { pi, optchat, login } };
  }
  /** pi-optchat as this Pi has it: `pi list` prints each package's source and under it the folder it is in. A package from npm
   * is the app's to install and update; a folder of yours (a checkout) is not. */
  private async optchat(pi: Found, named: Launch): Promise<State['optchat']> {
    const { code, output } = await this.ask(pi, ['list', '--no-approve'], 20_000);
    if (code !== 0) return { state: 'unknown', message: 'Pi did not list its packages.', command: shown(named, ['list']) };
    const lines = output.split('\n').map(line => line.trim());
    for (const [at, path] of lines.entries()) {
      if (!isAbsolute(path)) continue;
      let manifest: unknown;
      try { manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')); } catch { continue; }
      if (!Value.Check(Type.Object({ name: Type.Literal('pi-optchat'), version: Type.String() }), manifest)) continue;
      const { version } = manifest;
      if (!older(version, MINIMUM_OPTCHAT)) return { state: 'ok', version, path };
      return { state: 'old', version, path, ...lines[at - 1] === OPTCHAT
        ? { installable: true, message: `Older than ${MINIMUM_OPTCHAT}, which this app needs. Update it here, or in a terminal:`, command: shown(named, ['update', OPTCHAT]) }
        : { message: `Older than ${MINIMUM_OPTCHAT}, which this app needs. It is a folder of yours, so the app leaves it alone: update it there.` } };
    }
    return { state: 'missing', installable: true, message: 'Not installed in this Pi. Install it here, or in a terminal:', command: shown(named, ['install', OPTCHAT]) };
  }
  /** The models Pi can use: it lists only those of the providers it has credentials for. Asked of a Pi that opens no session,
   * loads no extension and goes nowhere on the network. */
  private async models(launch: Launch) {
    const { signal } = this.closing;
    if (signal.aborted) return undefined;
    const pi = new Pi({ ...launch, args: [...launch.args, '--no-session', '--offline', '--no-extensions'], cwd: homedir(), env: process.env }, () => {}, () => {});
    const end = () => void pi.stop(0), late = setTimeout(end, 30_000);
    signal.addEventListener('abort', end);
    try {
      const answer = await pi.request({ type: 'get_available_models' });
      return Value.Check(Models, answer) ? answer.models : undefined;
    } catch { return undefined; } finally { clearTimeout(late); signal.removeEventListener('abort', end); await pi.stop(2000); }
  }
}
