import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** A file the agent named, opened in your editor. The name is the model's, so it is only ever a file that is there, under the
 * folder the window runs in: resolved with its links followed, and not a folder or anything else. Nothing of it is run: the
 * editor is started with the path as one argument, whole, and never through a shell. */
export function inside(cwd: string, path: string): string | undefined {
  try {
    const root = realpathSync(cwd), file = realpathSync(resolve(root, path)), from = relative(root, file);
    return from && from.split(sep)[0] !== '..' && !isAbsolute(from) && statSync(file).isFile() ? file : undefined;
  } catch { return undefined; }
}

const PICTURES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
/** A picture a reply shows by its path (`safe.ts`), as the page is sent it: an absolute path, resolved with its links followed,
 * to a file of one of these kinds by its name, of 10 MB at most. Not SVG, which can carry script. The path is the model's, and
 * the agent can read any file anyway: this only lets you see it, and nothing leaves the machine. */
export function picture(path: string) {
  try {
    // Not `//host/share` nor `\\host\share`: on Windows that is a network path, which signs in to its host to be looked up.
    if (!isAbsolute(path) || /^[\\/]{2}/.test(path)) return undefined;
    const file = realpathSync(path), type = PICTURES[extname(file).toLowerCase()], stat = statSync(file);
    return type && stat.isFile() && stat.size <= 10 * 1024 * 1024 ? { type, data: readFileSync(file) } : undefined;
  } catch { return undefined; }
}

type Line = (file: string, line?: number) => string[];
// `-g` only with a line: with it, a file whose name ends in `:12` would be read as line 12 of another.
const goto: Line = (file, line) => line ? ['-g', `${file}:${line}`] : [file];
const jetbrains: Line = (file, line) => line ? ['--line', String(line), file] : [file];
/** The editors a file opens in, as T3 Code lists them (its `contracts/src/editor.ts`): how each is told the line, the command it
 * puts on your PATH, and the one inside its app, since most never put VS Code's `code` there. Finder shows the file in its
 * folder. */
export const EDITORS = {
  cursor: { label: 'Cursor', command: 'cursor', app: 'Cursor.app/Contents/Resources/app/bin/cursor', args: (file, line) => ['--classic', ...goto(file, line)] },
  vscode: { label: 'VS Code', command: 'code', app: 'Visual Studio Code.app/Contents/Resources/app/bin/code', args: goto },
  'vscode-insiders': { label: 'VS Code Insiders', command: 'code-insiders', app: 'Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders', args: goto },
  vscodium: { label: 'VSCodium', command: 'codium', app: 'VSCodium.app/Contents/Resources/app/bin/codium', args: goto },
  // Its app first, as T3 Code does: a `zed` on the PATH can be OpenZFS's event daemon.
  zed: { label: 'Zed', command: 'zed', app: 'Zed.app/Contents/MacOS/cli', appFirst: true, args: (file, line) => [line ? `${file}:${line}` : file] },
  idea: { label: 'IntelliJ IDEA', command: 'idea', app: 'IntelliJ IDEA.app/Contents/MacOS/idea', args: jetbrains },
  webstorm: { label: 'WebStorm', command: 'webstorm', app: 'WebStorm.app/Contents/MacOS/webstorm', args: jetbrains },
  pycharm: { label: 'PyCharm', command: 'pycharm', app: 'PyCharm.app/Contents/MacOS/pycharm', args: jetbrains },
  finder: { label: 'Finder', command: '/usr/bin/open', args: file => ['-R', file] },
} satisfies Record<string, { label: string; command: string; app?: string; appFirst?: true; args: Line }>;
export type EditorId = keyof typeof EDITORS;
export const isEditor = (id: string): id is EditorId => Object.hasOwn(EDITORS, id);
const IDS = Object.keys(EDITORS).filter(isEditor);
export interface Launch { command: string; args: string[] }
/** Where editors are looked for. The app opened from the Finder has your shell's PATH (`src/desktop/environment.ts`) unless
 * your shell did not answer; then `extra` is where Homebrew puts an editor's command. `apps` hold the apps themselves. */
export interface Places { env: NodeJS.ProcessEnv; extra: string[]; apps: string[] }
const PLACES: Places = { env: process.env, extra: ['/opt/homebrew/bin', '/usr/local/bin'], apps: ['/Applications', join(homedir(), 'Applications')] };
/** A command line's command: `zed` of `zed --wait`. */
const first = (line?: string) => line?.trim().split(/\s+/)[0] ?? '';
const runs = (file: string) => { try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; } };

/** The editors on this Mac, in the list's order, each with what starts it: the one your `$VISUAL` or `$EDITOR` names by its
 * whole path, else its command, else the one in its app. */
export function installed({ env, extra, apps }: Places = PLACES): Installed {
  const folders = [...(env.PATH ?? '').split(delimiter).filter(isAbsolute), ...extra], yours = [env.VISUAL, env.EDITOR].map(first).filter(isAbsolute);
  return new Map(IDS.flatMap(id => {
    const { command, app, appFirst }: { command: string; app?: string; appFirst?: true } = EDITORS[id];
    const onPath = folders.map(folder => join(folder, command)), inApp = app ? apps.map(folder => join(folder, app)) : [];
    const at = isAbsolute(command) ? [command] : [...yours.filter(path => basename(path) === command), ...appFirst ? [...inApp, ...onPath] : [...onPath, ...inApp]];
    const found = at.find(runs);
    return found ? [[id, found] as const] : [];
  }));
}
export type Installed = Map<EditorId, string>;

/** The editor a file opens in: the one you picked while it is there, else your `$VISUAL` or `$EDITOR` when it is one of these
 * (a terminal editor, vim or nano, has no terminal to run in), else VS Code, else the first there is. Finder is only ever
 * picked. */
export function preferred(found: Installed, choice?: string, env: NodeJS.ProcessEnv = process.env): EditorId | undefined {
  const named = [env.VISUAL, env.EDITOR].map(command => basename(first(command))).map(name => IDS.find(id => EDITORS[id].command === name));
  return [choice, ...named, 'vscode', ...IDS.filter(id => id !== 'finder')].find((id): id is EditorId => id !== undefined && isEditor(id) && found.has(id));
}
/** How `id`, started as `found` has it, opens `file` at `line`; with none, the Mac's text editor does (`open -t`): `open` on
 * the file itself would run a script or an app that has a handler for it. */
export function opening(found: Installed, id: EditorId | undefined, file: string, line?: number): Launch {
  const command = id && found.get(id);
  return command && id ? { command, args: EDITORS[id].args(file, line) } : { command: 'open', args: ['-t', file] };
}

/** Starts it on its own: the server neither waits for it nor keeps it. */
export function launch({ command, args }: Launch) {
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}
