import { appendFileSync } from 'node:fs';

/** A Pi extension for the live tests, which changes nothing: it writes what Pi is about to send to the model, as it is sent,
 * to the file `OPTCHAT_APP_SENT` names, with `window` for a Pi that is a connected window. */
export default function sent(pi: { on(event: 'before_provider_request', handler: (event: { payload: unknown }) => void): void }) {
  const window = process.argv[process.argv.indexOf('--optchat-connect') + 1] === 'join';
  pi.on('before_provider_request', ({ payload }) => appendFileSync(process.env.OPTCHAT_APP_SENT ?? '', `${JSON.stringify({ window, payload })}\n`));
}
