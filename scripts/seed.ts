import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A profile's log for the screenshots: a believable chat with everything the UI draws, written as pi-optchat writes one. */
type Said = [kind: 'user' | 'talk' | 'tool' | 'echo' | 'work' | 'note', text: string];
const TURNS: Said[][] = [
  [
    ['user', 'Can you look at why the server takes so long to stop when I press Ctrl+C?'],
    ['talk', 'I\'ll read the shutdown path first.'],
    ['tool', 'read {"path":"src/server/pi.ts"}'],
    ['echo', 'read: export class Pi {\n  async stop(grace: number) {\n    this.child.stdin?.end();\n    …'],
    ['tool', 'bash {"command":"grep -rn \\"SIGKILL\\" src/server"}'],
    ['echo', 'bash: src/server/pi.ts:74:      else try { process.kill(-pid, \'SIGKILL\'); } catch {}'],
    ['talk', 'Found it. `stop()` waited for the full grace period even when Pi had already exited, because the timer was never cleared.\n\n```ts\nconst kill = setTimeout(() => { /* … */ }, grace);\nawait this.exited;\nclearTimeout(kill); // this line was missing\n```\n\nWith the timer cleared, a clean stop takes **under a second**.'],
  ],
  [
    ['user', 'Nice. What does the protocol look like now?'],
    ['talk', 'One WebSocket carrying JSON. The client sends a request and gets one response; the server also pushes what happens in windows.\n\n| Method | What it does |\n| --- | --- |\n| `history` | A page of the log, read from disk |\n| `prompt` | Sends your message, starting Pi if needed |\n| `abort` | Stops the run and returns what was queued |\n\nEverything is typed from one schema in `src/protocol.ts`.'],
  ],
  [
    ['user', 'Spawn someone to check how T3 Code handles reconnects, I want to compare.'],
    ['tool', 'spawn {"tasks":[{"title":"How T3 Code reconnects","task":"Read-only investigation of the reconnect path…"}]}'],
    ['echo', 'spawn: Started: ce3d516d. Reports will arrive automatically.'],
    ['talk', 'Started an investigator. I\'ll go on with the tests meanwhile.'],
  ],
  [
    ['work', '[ce3d516d] **T3 Code replays by sequence number.** Each thread keeps a numbered event log; a client that reconnects sends the last number it saw and gets the rest, or a fresh snapshot when the log no longer reaches that far.\n\n- Sequence numbers are per thread\n- The snapshot is the fallback, not the default\n- Nothing is replayed twice'],
    ['talk', 'That matches what we built: numbered records per window, and the profile\'s log as the snapshot. Two differences worth knowing:\n\n1. We keep only the latest run in memory, since the log has the rest.\n2. Streaming updates are dropped once their message is finished.'],
  ],
  [
    ['user', 'run the whole test suite and tell me if anything is slow'],
    ['tool', 'bash {"command":"npm test"}'],
    ['echo', 'bash: ℹ tests 18\nℹ pass 18\nℹ fail 0\nℹ duration_ms 2212.4'],
    ['talk', 'All 18 pass in 2.2 s. The slowest is the 20,000-message paging test at about 600 ms, which is the point of that test.'],
  ],
  [
    ['user', 'ok stop, that is enough'],
    ['tool', 'bash {"command":"npm run test:live"}'],
    ['echo', 'Agent aborted: No further details'],
  ],
];
const NOTE: Said = ['note', 'Jonas prefers short answers, typed protocols, and tests that are focused.'];

/** Writes `turns` turns of the chat to the profile in `directory`, a message a minute, the newest a minute before `end`. */
export function seed(directory: string, turns: number, end = Date.UTC(2026, 10, 12, 9, 0, 0)) {
  const said = [NOTE, ...Array.from({ length: turns }, (_, turn) => TURNS[turn % TURNS.length]).flat()];
  const entries = said.map(([kind, text], i) => JSON.stringify({ i, kind, date: new Date(end - (said.length - i) * 60_000).toISOString(), text }));
  mkdirSync(join(directory, 'main'), { recursive: true });
  writeFileSync(join(directory, 'main', '2026-11-12.jsonl'), `${entries.join('\n')}\n`);
}
