import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** A file the agent named, opened in your editor. The name is the model's, so it is only ever a file that is there, under the
 * folder the window runs in: resolved with its links followed, and not a folder or anything else. Nothing of it is run: the
 * editor is started with the path as one argument, whole, and never through a shell. */
export function inside(cwd: string, path: string): string | undefined {
  try {
    const root = realpathSync(cwd), file = realpathSync(resolve(root, path)), from = relative(root, file);
    return from && from.split(sep)[0] !== '..' && !isAbsolute(from) && statSync(file).isFile() ? file : undefined;
  } catch { return undefined; }
}

/** How each editor is told the line: `code -g file:42`, or `zed file:42`. */
const EDITORS: Record<string, (file: string) => string[]> = {
  code: file => ['-g', file], 'code-insiders': file => ['-g', file], cursor: file => ['-g', file], codium: file => ['-g', file], windsurf: file => ['-g', file],
  zed: file => [file], subl: file => [file],
};
// The app opened from the Finder has your shell's PATH (`src/desktop/environment.ts`) unless your shell did not answer; then
// these are where Homebrew puts an editor's command.
const BREW = ['/opt/homebrew/bin', '/usr/local/bin'];
const runs = (file: string) => { try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; } };
export interface Launch { command: string; args: string[] }

/** Your editor, as `$VISUAL` or `$EDITOR` names it when it is one that opens a window of its own, else VS Code when its `code`
 * is there. A terminal editor (vim, nano) is passed over: there is no terminal to run it in. */
export function editor(env: NodeJS.ProcessEnv = process.env, extra = BREW) {
  const find = (name: string) => [...(env.PATH ?? '').split(delimiter).filter(isAbsolute), ...extra].map(directory => join(directory, name)).find(runs);
  for (const named of [env.VISUAL, env.EDITOR, 'code']) {
    const command = named?.trim().split(/\s+/)[0] ?? '', name = basename(command), at = Object.hasOwn(EDITORS, name) && (isAbsolute(command) ? runs(command) && command : find(name));
    if (at) return (file: string, line?: number): Launch => ({ command: at, args: EDITORS[name](line ? `${file}:${line}` : file) });
  }
}
/** With no editor, the file opens in what the system has for text (`open -t`), and on Linux its folder does: `open` and
 * `xdg-open` on the file itself would run a script or an app that has a handler for it. */
export const fallback = (file: string, platform = process.platform): Launch => platform === 'darwin' ? { command: 'open', args: ['-t', file] } : { command: 'xdg-open', args: [dirname(file)] };

/** Starts it on its own: the server neither waits for it nor keeps it. */
export function launch({ command, args }: Launch) {
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}
