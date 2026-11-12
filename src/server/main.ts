import { parseArgs } from 'node:util';
import { startServer } from './server.ts';

/** `node src/server/main.ts [--port 4780] [--host 127.0.0.1] [--cwd <dir>] [--pi <command>] [-- <more arguments for Pi>]` */
const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: 'string', default: '4780' }, host: { type: 'string' }, cwd: { type: 'string' }, pi: { type: 'string', default: 'pi' } } });
const server = await startServer({ port: Number(values.port), host: values.host, cwd: values.cwd, pi: { command: values.pi, args: positionals } });
console.log(`OptChat app server: ${server.url}`);

// One signal stops every Pi in order, so each saves its memory and frees its profile; a second one quits at once.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => {
  if (stopping) process.exit(1);
  stopping = true;
  void server.close().then(() => process.exit(0));
});
