import { homedir } from 'node:os';
import { createServer } from 'vite';
import { startServer } from '../src/server/server.ts';
import { terminal } from '../src/server/setup.ts';

/** `npm run dev`: the server, and Vite serving the UI with hot reload. Open the address Vite prints. The page then comes from
 * Vite's address and not the server's own, so the server is told to accept it. */
const vite = await createServer();
await vite.listen();
const origins = [...vite.resolvedUrls?.local ?? [], ...vite.resolvedUrls?.network ?? []].map(url => new URL(url).origin);
const server = await startServer({ port: Number(process.env.OPTCHAT_APP_PORT ?? 4780), origins, cwd: homedir(), opener: terminal() });
vite.printUrls();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void Promise.all([vite.close(), server.close()]).then(() => process.exit(0)));
