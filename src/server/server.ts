import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { dataHome } from 'pi-optchat/files';
import { Value } from 'typebox/value';
import { WebSocket, WebSocketServer } from 'ws';
import { Envelope, methods, type Method, type Params, type Push, type Result, type ServerMessage } from '../protocol.ts';
import { Agents } from './agents.ts';
import { GitHub } from './github.ts';
import { reason } from './pi.ts';
import { Profiles } from './profiles.ts';
import { appHome, isDirectory, readSettings, writeSettings } from './settings.ts';
import { Setup, type Launch } from './setup.ts';
import { Windows, type WindowsOptions } from './windows.ts';

export interface ServerOptions extends Partial<Pick<WindowsOptions, 'home' | 'grace'>> {
  port?: number;
  /** The app's own folder: its settings, and the Pi it installs. */
  app?: string;
  /** Where windows run while the settings name no folder. */
  cwd?: string;
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
  /** The built UI's directory (`npm run build`), served as the page at `/`. */
  ui?: string;
  /** Origins that may connect besides the server's own page: the scheme a desktop shell loads the UI from, as T3 Code's
   * `t3code://app`, or Vite's address in development. */
  origins?: readonly string[];
}
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const loopback = (url: string) => { try { return LOOPBACK.includes(new URL(url).hostname); } catch { return false; } };

/** Starts the app's server on this machine only: the protocol of `protocol.ts` on a WebSocket at `/ws`, a profile's images at
 * `/images/<profile>/<name>`, and the UI's page everywhere else. `close` stops every Pi it started and waits for them. */
export async function startServer({ port = 0, origins = [], ui = join(import.meta.dirname, '../../dist/ui'), home = dataHome(), app = appHome(), cwd = homedir(), pi, flags = [], npm, gh, opener, grace = 15_000 }: ServerOptions = {}) {
  ui = resolve(ui);
  home = resolve(home); // Pi runs in each window's directory, and has to find the same profiles from there.
  app = resolve(app); // And npm runs in the app's folder, where a path that is not whole would be another folder.
  const profiles = new Profiles(home), agents = new Agents(home), github = new GitHub(profiles, gh), sockets = new WebSocketServer({ noServer: true });
  let closing = false;
  const send = (socket: WebSocket, message: ServerMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  const push = (push: Push) => { for (const socket of sockets.clients) send(socket, push); };
  let settings = readSettings(app);
  const setup = new Setup({ app, pi, npm, opener, push: setup => push({ push: 'setup', setup }) });
  // A window runs in the folder the settings name, unless that folder is gone since it was kept.
  const windows = new Windows({ home, grace, push, cwd: () => settings.cwd && isDirectory(settings.cwd) ? settings.cwd : cwd, pi: async () => { const { command, args } = await setup.launch(); return { command, args: [...args, ...flags] }; }, catalog: () => setup.catalog() });
  const handlers: { [M in Method]: (params: Params<M>) => Result<M> | Promise<Result<M>> } = {
    agents: params => agents.list(params), agent: params => agents.one(params), github: params => github.list(params),
    config: params => profiles.config(params), configure: params => profiles.configure(params), instruct: params => profiles.instruct(params),
    // An agent is reached through the Pi that has its profile open, and a message to one is worth starting that Pi for.
    tellAgent: async params => { await windows.owned(params.profile); return agents.tell(params); },
    interruptAgent: params => agents.interrupt(params), stopAgent: params => agents.stop(params),
    profiles: () => profiles.list(), createProfile: params => profiles.create(params), history: params => profiles.history(params), view: params => profiles.view(params), zoom: params => profiles.zoom(params), original: params => profiles.original(params),
    windows: () => windows.list(), open: params => windows.open(params), prompt: params => windows.prompt(params), abort: params => windows.abort(params),
    complete: params => windows.complete(params), close: params => windows.close(params), records: params => windows.records(params),
    command: params => windows.command(params), answer: params => windows.answer(params), models: params => windows.models(params), setModel: params => windows.setModel(params),
    settings: () => settings,
    setSettings: params => { settings = writeSettings(app, settings, params); push({ push: 'settings', settings }); return settings; },
    setup: params => setup.state(params), install: async params => { await setup.install(params); return {}; },
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
   * hence the Host. A client that is not a browser sends no Origin. */
  const allowed = ({ headers: { host, origin } }: IncomingMessage) => {
    const { port } = server.address() as AddressInfo;
    return loopback(`http://${host}`) && (origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}` || origins.includes(origin));
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
    response.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    try {
      if (request.method !== 'GET' || !allowed(request)) { response.writeHead(404).end(); return; }
      const { pathname } = new URL(request.url ?? '/', 'http://localhost'), image = /^\/images\/([^/]+)\/([0-9a-f]{16})$/.exec(pathname);
      const found = image ? profiles.image(image[1], image[2]) : undefined, file = image ? undefined : page(pathname);
      if (found) response.writeHead(200, { 'content-type': found.mimeType, 'cache-control': 'private, max-age=31536000, immutable' }).end(found.data);
      else if (file) response.writeHead(200, { 'content-type': file.type, 'cache-control': file.cache }).end(file.data);
      else if (pathname === '/') response.writeHead(503, { 'content-type': 'text/plain' }).end('The UI is not built yet. Run: npm run build\n');
      else response.writeHead(404).end();
    } catch { response.writeHead(404).end(); }
  });
  server.on('upgrade', (request, socket, head) => {
    if (closing || request.url !== '/ws' || !allowed(request)) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address() as AddressInfo;
  return {
    port: address.port, url: `ws://127.0.0.1:${address.port}/ws`, page: `http://127.0.0.1:${address.port}/`,
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
