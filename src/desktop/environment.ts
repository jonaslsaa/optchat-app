import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';

const MARK = '__OPTCHAT_APP_ENVIRONMENT__';
/** What the shell says of itself and not of you: where it stands, how deep it is, what it last ran. */
const ITS_OWN = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD']);

/** The environment a shell printed between two marks with `env -0`: a name and its value, parted by NUL, so a value may have
 * line breaks. What the shell's startup files print around the marks is not read. Without both marks there is none. */
export function parseEnvironment(output: string): Record<string, string> | undefined {
  const parts = output.split(MARK);
  if (parts.length < 3) return undefined;
  return Object.fromEntries(parts[1].split('\0').flatMap((entry): [string, string][] => {
    const at = entry.indexOf('='), name = entry.slice(0, at);
    return at > 0 && !ITS_OWN.has(name) ? [[name, entry.slice(at + 1)]] : [];
  }));
}
/** The environment a new terminal of yours has, asked of your login shell as T3 Code does (`-ilc`, so the files that set your
 * PATH are read). An app opened from the Finder has only launchd's, in which neither `pi` nor `npm` nor `gh` is found. A
 * shell that fails, or has not answered after `timeout`, gives none: the app then runs with what it has. */
export function loginEnvironment(shell = userInfo().shell || '/bin/zsh', timeout = 5000): Promise<Record<string, string> | undefined> {
  return new Promise(resolve => {
    // No terminal and a session of its own, so a shell that wants one cannot stop the app; nothing is typed to it.
    const child = spawn(shell, ['-ilc', `printf %s ${MARK}; /usr/bin/env -0; printf %s ${MARK}`], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    let output = '';
    // The answer is whole once both marks are read. Not waited for: the shell's end, or the end of what it printed to, which
    // something a startup file left running may hold open for good.
    const done = () => { clearTimeout(late); child.stdout.destroy(); resolve(parseEnvironment(output)); };
    // A shell that hangs is killed with what it started (its session is its process group).
    const late = setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* It is gone already. */ } done(); }, timeout);
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; if (output.split(MARK).length > 2) done(); });
    child.on('error', done);
    child.on('exit', code => { if (code !== 0) done(); });
  });
}
