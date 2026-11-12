import type { Method, Params, Push, Response, Result, ServerMessage } from './protocol.ts';

export interface Client {
  /** Sends a request and resolves with its result, or rejects with the server's error. */
  request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>>;
  close(): void;
}
/** Connects to the app's server. It uses the standard WebSocket, so it runs in a browser and in Node alike; `onPush` gets what
 * the server sends unasked. A closed connection rejects the requests still waiting; reconnecting is the caller's, with `windows`
 * and `records` to catch up. */
export function connect(url: string, onPush: (push: Push) => void = () => {}): Promise<Client> {
  const socket = new WebSocket(url), waiting = new Map<number, (response: Response | undefined) => void>();
  let requests = 0;
  socket.addEventListener('message', event => {
    const message: ServerMessage = JSON.parse(String(event.data));
    if ('push' in message) { onPush(message); return; }
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  socket.addEventListener('close', () => {
    for (const answer of waiting.values()) answer(undefined);
    waiting.clear();
  });
  const client: Client = {
    request: <M extends Method>(method: M, params: Params<M>) => new Promise<Result<M>>((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) { reject(new Error('The connection to the server closed.')); return; }
      const id = ++requests;
      waiting.set(id, response => {
        if (!response) reject(new Error('The connection to the server closed.'));
        else if ('error' in response) reject(new Error(response.error));
        // The server answers a request with its own method's result: the one place the wire is taken at its word.
        else resolve(response.result as Result<M>);
      });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  };
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(client), { once: true });
    socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}.`)), { once: true });
  });
}
