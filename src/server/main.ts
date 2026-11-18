import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { startServer } from './server.ts';
import { launch } from './files.ts';
import { terminal } from './setup.ts';

/** `node src/server/main.ts [--port 4780] [--cwd <dir>]` */
const { values } = parseArgs({ options: { port: { type: 'string', default: '4780' }, cwd: { type: 'string' } } });
const server = await startServer({ port: Number(values.port), cwd: values.cwd ?? homedir(), opener: terminal(), launcher: launch, histories: homedir() });
console.log(`OptChat app: ${server.page}`);

// One signal stops every Pi in order, so each saves its memory and frees its profile; a second one quits at once.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => {
  if (stopping) process.exit(1);
  stopping = true;
  void server.close().then(() => process.exit(0));
});
