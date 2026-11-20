import { homedir } from 'node:os';
import { createServer } from 'vite';
import { startServer } from '../src/server/server.ts';
import { launch } from '../src/server/files.ts';
import { newestPi, terminal } from '../src/server/setup.ts';

/** `npm run dev`: the server, and Vite serving the UI with hot reload. Open the address printed here: Vite's, with the server's
 * token after its #. The page then comes from Vite's address and not the server's own, so the server is told to accept it. */
const vite = await createServer();
await vite.listen();
const origins = [...vite.resolvedUrls?.local ?? [], ...vite.resolvedUrls?.network ?? []].map(url => new URL(url).origin);
const server = await startServer({ port: Number(process.env.OPTCHAT_APP_PORT ?? 4780), origins, cwd: homedir(), opener: terminal(), latest: newestPi, launcher: launch, histories: homedir() });
for (const url of vite.resolvedUrls?.local ?? []) console.log(`OptChat app (Vite): ${url}${new URL(server.page).hash}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void Promise.all([vite.close(), server.close()]).then(() => process.exit(0)));
