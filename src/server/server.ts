import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Value } from 'typebox/value';
import { WebSocket, WebSocketServer } from 'ws';
import { Envelope, methods, type Method, type Params, type Result, type ServerMessage } from '../protocol.ts';
import { defaultHome } from './disk.ts';
import { reason } from './pi.ts';
import { Profiles } from './profiles.ts';
import { Windows, type WindowsOptions } from './windows.ts';

export interface ServerOptions extends Partial<Omit<WindowsOptions, 'push'>> {
  port?: number;
  /** The built UI's directory (`npm run build`), served as the page at `/`. */
  ui?: string;
  /** Origins that may connect besides pages this machine serves: the scheme a desktop shell loads the UI from, as T3 Code's
   * `t3code://app`. */
  origins?: readonly string[];
}
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const loopback = (url: string) => { try { return LOOPBACK.includes(new URL(url).hostname); } catch { return false; } };

/** Starts the app's server on this machine only: the protocol of `protocol.ts` on a WebSocket at `/ws`, a profile's images at
 * `/images/<profile>/<name>`, and the UI's page everywhere else. `close` stops every Pi it started and waits for them. */
export async function startServer({ port = 0, origins = [], ui = join(import.meta.dirname, '../../dist/ui'), home = defaultHome(), cwd = homedir(), pi = { command: 'pi', args: [] }, grace = 15_000 }: ServerOptions = {}) {
  ui = resolve(ui);
  home = resolve(home); // Pi runs in each window's directory, and has to find the same profiles from there.
  const profiles = new Profiles(home), sockets = new WebSocketServer({ noServer: true });
  let closing = false;
  const send = (socket: WebSocket, message: ServerMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  const windows = new Windows({ home, cwd, pi, grace, push: push => { for (const socket of sockets.clients) send(socket, push); } });
  const handlers: { [M in Method]: (params: Params<M>) => Result<M> | Promise<Result<M>> } = {
    profiles: () => profiles.list(), history: params => profiles.history(params), view: params => profiles.view(params), zoom: params => profiles.zoom(params),
    windows: () => windows.list(), open: params => windows.open(params), prompt: params => windows.prompt(params), abort: params => windows.abort(params),
    complete: params => windows.complete(params), close: params => windows.close(params), records: params => windows.records(params),
    command: params => windows.command(params), answer: params => windows.answer(params),
  };
  const isMethod = (method: string): method is Method => Object.hasOwn(handlers, method);
  const call = <M extends Method>(method: M, params: unknown) => {
    if (!Value.Check<(typeof methods)[M]['params']>(methods[method].params, params)) throw new Error(`Invalid ${method} request: ${Value.Errors(methods[method].params, params)[0]?.message ?? 'wrong parameters'}.`);
    return handlers[method](params);
  };
  /** The windows run an agent with a shell, so only this machine's own pages may reach the server. A page anywhere can open a
   * WebSocket to any address, hence the Origin; and a name it points at 127.0.0.1 makes its requests same-origin, hence the
   * Host. A client that is not a browser sends no Origin. */
  const allowed = ({ headers: { host, origin } }: IncomingMessage) => loopback(`http://${host}`) && (origin === undefined || loopback(origin) || origins.includes(origin));
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
      await windows.shutdown();
      for (const socket of sockets.clients) socket.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
