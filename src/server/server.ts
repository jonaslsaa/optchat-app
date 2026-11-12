import { createServer, type IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { Value } from 'typebox/value';
import { WebSocket, WebSocketServer } from 'ws';
import { methods, Request, type Method, type Params, type Result, type ServerMessage } from '../protocol.ts';
import { defaultHome } from './disk.ts';
import { Profiles } from './profiles.ts';
import { Windows, type WindowsOptions } from './windows.ts';

export interface ServerOptions extends Partial<Omit<WindowsOptions, 'push'>> { port?: number; host?: string }
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
/** A page in a browser may open a WebSocket to any address, so only pages served from this machine may talk to the server: its
 * windows run an agent with a shell. A client that is not a browser sends no Origin. */
function local({ headers: { origin } }: IncomingMessage) {
  if (origin === undefined) return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { return false; }
}

/** Starts the app's server: the protocol of `protocol.ts` on a WebSocket at `/ws`, and a profile's images at
 * `/images/<profile>/<name>`. `close` stops every Pi it started and waits for them. */
export async function startServer({ port = 0, host = '127.0.0.1', home = defaultHome(), cwd = homedir(), pi = { command: 'pi', args: [] }, grace = 15_000, keep = 16_000_000 }: ServerOptions = {}) {
  const profiles = new Profiles(home), sockets = new WebSocketServer({ noServer: true });
  const send = (socket: WebSocket, message: ServerMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  const windows = new Windows({ home, cwd, pi, grace, keep, push: push => { for (const socket of sockets.clients) send(socket, push); } });
  const handlers: { [M in Method]: (params: Params<M>) => Result<M> | Promise<Result<M>> } = {
    profiles: () => profiles.list(), history: params => profiles.history(params), view: params => profiles.view(params), zoom: params => profiles.zoom(params),
    windows: () => windows.list(), open: params => windows.open(params), prompt: params => windows.prompt(params), abort: params => windows.abort(params),
    complete: params => windows.complete(params), close: params => windows.close(params), records: params => windows.records(params),
    command: params => windows.command(params), answer: params => windows.answer(params),
  };
  const valid = <M extends Method>(method: M, params: unknown): params is Params<M> => Value.Check(methods[method].params, params);
  const call = async <M extends Method>(method: M, params: unknown): Promise<Result<M>> => {
    if (!valid(method, params)) throw new Error(`Invalid ${method} request: ${Value.Errors(methods[method].params, params)[0]?.message ?? 'wrong parameters'}.`);
    return handlers[method](params);
  };
  sockets.on('connection', socket => {
    socket.on('error', () => socket.terminate()); // A broken frame or a dropped connection ends that client, not the server.
    socket.on('message', async data => {
      let request: unknown;
      try { request = JSON.parse(String(data)); } catch { return; }
      if (!Value.Check(Request, request)) return;
      const { id, method, params } = request;
      try { send(socket, { id, result: await call(method, params) }); }
      catch (error) { send(socket, { id, error: text(error) }); }
    });
  });
  const server = createServer(async (request, response) => {
    const image = /^\/images\/([^/]+)\/([0-9a-f]{16})$/.exec(request.url ?? '');
    try {
      const found = image && request.method === 'GET' ? await profiles.image(image[1], image[2]) : undefined;
      if (!found) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': found.mimeType, 'cache-control': 'private, max-age=31536000, immutable' }).end(found.data);
    } catch { response.writeHead(404).end(); }
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws' || !local(request)) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address() as AddressInfo;
  return {
    port: address.port, url: `ws://${host}:${address.port}/ws`,
    async close() {
      await windows.shutdown();
      for (const socket of sockets.clients) socket.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
