import { parseArgs } from 'node:util';
import { startServer } from './server.ts';

/** `node src/server/main.ts [--port 4780] [--cwd <dir>]` */
const { values } = parseArgs({ options: { port: { type: 'string', default: '4780' }, cwd: { type: 'string' } } });
const server = await startServer({ port: Number(values.port), cwd: values.cwd });
console.log(`OptChat app server: ${server.url}`);

// One signal stops every Pi in order, so each saves its memory and frees its profile; a second one quits at once.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => {
  if (stopping) process.exit(1);
  stopping = true;
  void server.close().then(() => process.exit(0));
});
