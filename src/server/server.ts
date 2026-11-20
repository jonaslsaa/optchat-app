import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { dataHome } from 'pi-optchat/files';
import { Value } from 'typebox/value';
import { WebSocket, WebSocketServer } from 'ws';
import { Envelope, methods, REFUSED, type Method, type Params, type Push, type Result, type ServerMessage, type Updating } from '../protocol.ts';
import { Agents } from './agents.ts';
import { inside, installed, picture, opening, preferred, EDITORS, type Installed, type Launch as Opened } from './files.ts';
import { GitHub } from './github.ts';
import { Imports } from './imports.ts';
import { mentions } from './mentions.ts';
import { reason } from './pi.ts';
import { profileDirectory, Profiles } from './profiles.ts';
import { appHome, isDirectory, readSettings, readThemes, writeSettings } from './settings.ts';
import { Setup, type Launch } from './setup.ts';
import { usage } from './usage.ts';
import { Windows, type WindowsOptions } from './windows.ts';

export interface ServerOptions extends Partial<Pick<WindowsOptions, 'home' | 'grace'>> {
  port?: number;
  /** The app's own folder: its settings, and the Pi it installs. */
  app?: string;
  /** Where windows run while the settings name no folder, and a Pi that is only asked something (its version, its models).
   * It has no default, so a test cannot forget it and start something in your home folder: the app itself names that. */
  cwd: string;
  /** How Pi is run: yours on the PATH unless named. Where there is none, the Pi the app installed is run. */
  pi?: Launch;
  /** More arguments for a window's Pi, such as the cheap model the live tests name. Only a window's: after them, a word like
   * `list` would be a message to the agent, so nothing that asks Pi about itself gets them. */
  flags?: readonly string[];
  /** The GitHub CLI that says how issues and pull requests stand: `gh` on the PATH unless said. */
  gh?: Launch;
  /** The npm that installs Pi into the app's folder. */
  npm?: Launch;
  /** What opens a file in a terminal of its own, for Pi's sign-in. Without it the server opens none. */
  opener?: Launch;
  /** How the newest Pi that is out is learned (`newestPi` in `setup.ts`). Without it the server neither tells of a newer Pi nor
   * installs a patch of its own Pi, so no test asks the network. */
  latest?: () => Promise<string | undefined>;
  /** What time it is, for what a profile used "Today": the clock's, unless said. */
  now?: () => number;
  /** What starts your editor on a file the chat named (`launch` in `files.ts`). Without it the server opens none, so nothing a
   * test starts can. */
  launcher?: (launch: Opened) => void;
  /** The editors on this machine (`installed` in `files.ts`, unless said): a test names its own, so it does not depend on yours. */
  editors?: () => Installed;
  /** The home folder whose other tools' histories may be imported (`.claude`, `.codex`, `.pi`, `.omp` in it): yours in the app,
   * `npm start` and `npm run dev`. Without it no history is read but a ChatGPT export that was uploaded, so no test reads yours. */
  histories?: string;
  /** The built UI's directory (`npm run build`), served as the page at `/`. */
  ui?: string;
  /** Origins that may connect besides the server's own page: the scheme a desktop shell loads the UI from, as T3 Code's
   * `t3code://app`, or Vite's address in development. */
  origins?: readonly string[];
  /** What a click on a page's update button does, in an app that updates itself: the desktop app's, which also says what its
   * updater is doing (`updating`). A server without it has no updater, and its pages show nothing of updates. */
  update?: () => void;
  /** The secret a client connects with (`url`, and `page` after its #): a new one each start unless said, so a page or a
   * program from before it started again is refused. A test that starts a server again on the same address names it. */
  token?: string;
}
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const loopback = (url: string) => { try { return LOOPBACK.includes(new URL(url).hostname); } catch { return false; } };

/** Starts the app's server on this machine only: the protocol of `protocol.ts` on a WebSocket at `/ws`, a profile's images at
 * `/images/<profile>/<name>`, a picture on this machine a reply shows at `/file?path=<path>&token=<token>` (`picture`), and the
 * UI's page everywhere else. `close` stops every Pi it started and waits for them. */
export async function startServer({ port = 0, origins = [], ui = join(import.meta.dirname, '../../dist/ui'), home = dataHome(), app = appHome(), cwd, pi, flags = [], npm, gh, opener, latest, launcher, editors = () => installed(), update, histories, grace = 15_000, now = Date.now, token = randomBytes(32).toString('base64url') }: ServerOptions) {
  ui = resolve(ui);
  home = resolve(home); // Pi runs in each window's directory, and has to find the same profiles from there.
  app = resolve(app); // And npm runs in the app's folder, where a path that is not whole would be another folder.
  const profiles = new Profiles(home), agents = new Agents(home), github = new GitHub(profiles, gh), sockets = new WebSocketServer({ noServer: true });
  let closing = false;
  const send = (socket: WebSocket, message: ServerMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  const push = (push: Push) => { for (const socket of sockets.clients) send(socket, push); };
  let settings = readSettings(app), updating: Updating | undefined;
  const setup = new Setup({ app, cwd, pi, npm, opener, push: setup => push({ push: 'setup', setup }), installed: () => void everywhere(), latest });
  // A window runs in the folder the settings name, unless that folder is gone since it was kept.
  const windows = new Windows({ home, grace, push, cwd: () => settings.cwd && isDirectory(settings.cwd) ? settings.cwd : cwd, pi: async () => { const { command, args } = await setup.launch(); return { command, args: [...args, ...flags] }; }, versions: () => setup.versions(), catalog: () => setup.catalog() });
  const imports = new Imports({ home, histories, app, owned: profile => windows.owned(profile) });
  // A Pi of the app's on a pi-optchat older than the one installed now is started again while nothing is at work in its
  // profile (`Windows.current`): before what an older one may not know (resuming agents), and once
  // pi-optchat may have changed (an install here, the setup's "Check again" after a pull in a checkout).
  const current = (profile: string) => windows.current(profile, async () => !agents.atWork(profile) && (await imports.status({ profile }).catch(() => undefined))?.state !== 'running');
  const everywhere = () => Promise.all(windows.list().windows.filter(window => window.role === 'main').map(({ profile }) => current(profile).catch(() => {})));
  // The folder the files a window's chat names are read from: where its Pi runs, which for a main chat a Pi outside the app
  // holds is that Pi's, and none when that Pi is on another machine or does not say.
  const folder = (id: string) => {
    const window = windows.list().windows.find(window => window.id === id);
    if (!window) throw new Error(`No window ${id}.`);
    const { outside } = window;
    return !outside ? window.cwd : outside !== 'unknown' && outside.host === hostname() ? outside.cwd : undefined;
  };
  // A file opens in the editor in the settings, or the one `preferred` finds: only ever one of `EDITORS`, given the path whole.
  const open = (file: string, line?: number) => {
    if (!launcher) throw new Error('This server opens no editor.');
    const found = editors();
    launcher(opening(found, preferred(found, settings.editor), file, line));
  };
  const handlers: { [M in Method]: (params: Params<M>) => Result<M> | Promise<Result<M>> } = {
    agents: params => agents.list(params), agent: params => agents.one(params), github: params => github.list(params),
    isFile: ({ window, path }) => { const at = folder(window); return { file: at !== undefined && inside(at, path) !== undefined }; },
    openFile: ({ window, path, line }) => {
      const at = folder(window), file = at && inside(at, path);
      if (!file) throw new Error(`${path} is not a file in the folder this chat runs in.`);
      open(file, line);
      return {};
    },
    mentions: async ({ window, query }) => { const at = folder(window); return { mentions: at === undefined ? [] : await mentions(at, query) }; },
    openInstructions: ({ profile }) => { open(join(profileDirectory(home, profile), 'AGENTS.md')); return {}; },
    editors: () => {
      const found = editors();
      return { editors: [...found.keys()].map(id => ({ id, label: EDITORS[id].label })), current: preferred(found, settings.editor) };
    },
    config: params => profiles.config(params), configure: params => profiles.configure(params), instruct: params => profiles.instruct(params),
    // An agent is reached through the Pi that has its profile open, and a message to one is worth starting that Pi for.
    tellAgent: async params => { await windows.owned(params.profile); return agents.tell(params); },
    interruptAgent: params => agents.interrupt(params), stopAgent: params => agents.stop(params),
    cutOff: async () => ({ profiles: (await Promise.all(profiles.list().profiles.map(async ({ name }) => ({ profile: name, agents: await agents.cutOff(name) })))).filter(cut => cut.agents.length) }),
    // As a message to an agent is, resuming them is worth starting the Pi that reaches them.
    resumeAgents: async ({ profile }) => { await windows.owned(profile); await current(profile); await agents.resume(profile); return {}; },
    restart: async ({ profile }) => { await windows.restart(profile); return {}; },
    profiles: () => profiles.list(), createProfile: params => profiles.create(params), history: params => profiles.history(params), view: params => profiles.view(params), zoom: params => profiles.zoom(params), original: params => profiles.original(params), search: params => profiles.search(params),
    windows: () => windows.list(), open: params => windows.open(params), prompt: params => windows.prompt(params), dequeue: params => windows.dequeue(params), abort: params => windows.abort(params),
    complete: params => windows.complete(params), close: params => windows.close(params), rename: params => windows.rename(params), records: params => windows.records(params),
    command: params => windows.command(params), answer: params => windows.answer(params), commands: params => windows.commands(params), models: params => windows.models(params), setModel: params => windows.setModel(params),
    importScan: params => imports.found(params), importUpload: params => imports.receive(params), importPreview: params => imports.preview(params),
    importStart: params => imports.start(params), importControl: params => imports.control(params), importStatus: params => imports.status(params),
    usage: ({ profile, range }) => usage(profileDirectory(home, profile), range, now()),
    update: () => ({ ...updating && { update: updating } }),
    updateNow: () => { if (!update || !updating) throw new Error('This app does not update itself.'); update(); return {}; },
    settings: () => settings,
    setSettings: params => { settings = writeSettings(app, settings, params); push({ push: 'settings', settings }); return settings; },
    themes: () => readThemes(app),
    openThemes: () => {
      if (!launcher) throw new Error('This server opens no folder.');
      const { folder } = readThemes(app);
      mkdirSync(folder, { recursive: true });
      launcher({ command: process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', args: [folder] });
      return {};
    },
    setup: async params => { const state = await setup.state(params); if (params.fresh) await everywhere(); return state; }, install: async params => { await setup.install(params); return {}; },
    signIn: async params => { await setup.signIn(params); return {}; }, signedIn: params => setup.signedIn(params),
  };
  const isMethod = (method: string): method is Method => Object.hasOwn(handlers, method);
  const call = <M extends Method>(method: M, params: unknown) => {
    if (!Value.Check<(typeof methods)[M]['params']>(methods[method].params, params)) throw new Error(`Invalid ${method} request: ${Value.Errors(methods[method].params, params)[0]?.message ?? 'wrong parameters'}.`);
    return handlers[method](params);
  };
  /** The windows run an agent with a shell, so only the server's own page may reach it. A page anywhere can open a WebSocket to
   * any address, hence the Origin, which has to be this server's page (or one of `origins`): another program's page on this
   * machine is as foreign as one on the internet. A name pointed at 127.0.0.1 makes a foreign page's requests same-origin,
   * hence the Host. A program that is not a browser sends either as it likes, and no Origin at all on a GET: what keeps it
   * off the socket is the token, which only the address that opens the page has. */
  const allowed = ({ headers: { host, origin } }: IncomingMessage) => {
    const { port } = server.address() as AddressInfo;
    return loopback(`http://${host}`) && (origin === undefined || origin === `http://127.0.0.1:${port}` || origins.includes(origin));
  };
  sockets.on('connection', socket => {
    socket.on('error', () => socket.terminate()); // A broken frame or a dropped connection ends that client, not the server.
    socket.on('message', async data => {
      let request: unknown;
      try { request = JSON.parse(String(data)); } catch { return; }
      if (!Value.Check(Envelope, request)) return; // Without a number to answer under, there is nothing to say.
      const { id, method, params } = request;
      try {
        if (closing) throw new Error('The server is closing.');
        if (!isMethod(method)) throw new Error(`Unknown method: ${method}.`);
        send(socket, { id, result: await call(method, params) });
      } catch (error) { send(socket, { id, error: reason(error) }); }
    });
  });
  /** A file of the built UI. Its assets have their content's hash in their names, so they never change; the page is asked for anew. */
  const page = (path: string) => {
    const file = join(ui, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ui + sep) || !existsSync(file) || !statSync(file).isFile()) return undefined;
    return { type: TYPES[extname(file)] ?? 'application/octet-stream', cache: path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', data: readFileSync(file) };
  };
  const server = createServer((request, response) => {
    // No page may show this one in a frame, and this one loads nothing from elsewhere: what the agent writes is shown as
    // Markdown, and must not be able to fetch an address of its choosing.
    response.setHeader('x-frame-options', 'DENY');
    // Nor may another page show a picture of it (an <img> sends no Origin), and nothing it serves is read as another type.
    response.setHeader('cross-origin-resource-policy', 'same-origin');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    try {
      if (request.method !== 'GET' || !allowed(request)) { response.writeHead(404).end(); return; }
      const { pathname, searchParams } = new URL(request.url ?? '/', 'http://localhost'), image = /^\/images\/([^/]+)\/([0-9a-f]{16})$/.exec(pathname);
      if (pathname === '/file') {
        // Behind the socket's token: a file anywhere on this machine is for the page alone.
        const shown = searchParams.get('token') === token ? picture(searchParams.get('path') ?? '') : undefined;
        if (shown) response.writeHead(200, { 'content-type': shown.type, 'cache-control': 'no-store' }).end(shown.data);
        else response.writeHead(404).end();
        return;
      }
      const found = image ? profiles.image(image[1], image[2]) : undefined, file = image ? undefined : page(pathname);
      if (found) response.writeHead(200, { 'content-type': found.mimeType, 'cache-control': 'private, max-age=31536000, immutable' }).end(found.data);
      else if (file) response.writeHead(200, { 'content-type': file.type, 'cache-control': file.cache }).end(file.data);
      else if (pathname === '/') response.writeHead(503, { 'content-type': 'text/plain' }).end('The UI is not built yet. Run: npm run build\n');
      else response.writeHead(404).end();
    } catch { response.writeHead(404).end(); }
  });
  server.on('upgrade', (request, socket, head) => {
    const url = URL.parse(request.url ?? '/', 'http://localhost');
    if (closing || url?.pathname !== '/ws' || !allowed(request)) { socket.destroy(); return; }
    // Without the token, the socket is closed before it is read, with a code that tells a page from before a restart to stop.
    // Whatever it sends after is not waited for: `ws` would keep it while it waits for the other side to close too.
    sockets.handleUpgrade(request, socket, head, client => {
      if (url.searchParams.get('token') === token) { sockets.emit('connection', client, request); return; }
      client.on('error', () => client.terminate()).close(REFUSED);
      socket.once('data', () => socket.destroy());
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  setup.watch(); // Only a server that is listening keeps Pi up to date: one whose port was taken is let go of.
  const address = server.address() as AddressInfo;
  return {
    port: address.port, url: `ws://127.0.0.1:${address.port}/ws?token=${token}`, page: `http://127.0.0.1:${address.port}/#${token}`,
    /** Says what the app's updater is doing, to every page now and to each that asks later. */
    updating(state: Updating) { updating = state; push({ push: 'update', update: state }); },
    /** The app's settings as they are now. */
    settings: () => settings,
    /** How many agents stopping the server would cut short: every chat of its own that is in a run, every agent that is
     * running under a main chat it runs (not one that is paused, or only waits for its own agents), and an import running in
     * one, which its compactor runs outside any turn. A chat no Pi of the server's runs, such as one a terminal has, is
     * stopped here, and its agents are not the server's to stop. */
    async working() {
      const own = windows.list().windows.filter(window => window.status !== 'stopped' && window.status !== 'closed');
      const importing = async (profile: string) => (await imports.status({ profile })).state === 'running' ? 1 : 0;
      const under = await Promise.all(own.filter(window => window.role === 'main').map(async ({ profile }) => await agents.running(profile).catch(() => 0) + await importing(profile).catch(() => 0)));
      return own.filter(window => window.status === 'running').length + under.reduce((sum, count) => sum + count, 0);
    },
    /** No request is taken from here on; one already under way ends with its Pi. */
    async close() {
      closing = true;
      setup.close();
      await windows.shutdown();
      for (const socket of sockets.clients) socket.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
