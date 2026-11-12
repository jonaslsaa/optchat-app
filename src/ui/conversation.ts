import type { PiMessage } from './transcript.ts';

/** pi-optchat's request for a handoff, which is how a conversation ends in a connected window's Pi (its `rpc-window.ts`). */
const ends = (message: PiMessage) => message.role === 'custom' && 'customType' in message && message.customType === 'optchat-handoff-request';

/** The conversation a connected window is in. Its Pi keeps every one it had: Complete ends a conversation with a handoff, and
 * your next message begins another in the same Pi. A finished one is the main chat's by then and is not shown above the new one.
 * `session` is what the Pi had when last asked, and `run` what its latest run said since: a message of yours in it that is
 * newer than the handoff has begun a conversation the session does not have yet. */
export function current(session: readonly PiMessage[], run: readonly PiMessage[]): readonly PiMessage[] {
  let start = 0, ended: PiMessage | undefined;
  for (const [at, message] of session.entries()) {
    if (ends(message)) ended = message;
    else if (ended && message.role === 'user') { start = at; ended = undefined; }
  }
  const handoff = ended?.timestamp;
  return handoff !== undefined && run.some(message => message.role === 'user' && message.timestamp > handoff) ? [] : session.slice(start);
}
