import { createServer } from 'vite';
import { startServer } from '../src/server/server.ts';

/** `npm run dev`: the server, and Vite serving the UI with hot reload. Open the address Vite prints. */
const server = await startServer({ port: Number(process.env.OPTCHAT_APP_PORT ?? 4780) });
const vite = await createServer();
await vite.listen();
vite.printUrls();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void Promise.all([vite.close(), server.close()]).then(() => process.exit(0)));
