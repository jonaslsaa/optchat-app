import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Script } from '../test/fake-pi.ts';
import { issue, pullRequest, writeRun } from '../test/support.ts';

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

const RECONNECTS = '**T3 Code replays by sequence number.** Each thread keeps a numbered event log; a client that reconnects sends the last number it saw and gets the rest, or a fresh snapshot when the log no longer reaches that far.\n\n- Sequence numbers are per thread\n- The snapshot is the fallback, not the default\n- Nothing is replayed twice';
const WINDOWS_NOTE = '# Windows\n\nPi is started through `cmd.exe` there, so a signal reaches the shell and not Pi.\n\n- `stop()` closes stdin first, which Pi takes as the end of the session\n- only after the grace period is the process tree killed, with `taskkill /T /F`\n';
/** A chat whose agent changed files and handed work out: what the agents panel and an opened edit are pictured with. Its agents
 * are `agents` below. */
export const TEAM: Said[][] = [
  [
    ['user', 'The shutdown test fails on Windows. Can you fix the timeout and write down why it is different there?'],
    ['talk', 'The test gives Pi two seconds to stop, which is not enough for `taskkill`. I\'ll raise it and note why.'],
    ['tool', `edit ${JSON.stringify({ path: 'test/pi.test.ts', edits: [{ oldText: '  await pi.stop(2_000);\n  assert.equal(pi.running, false);', newText: '  // Windows ends the whole process tree, which takes longer than a signal.\n  await pi.stop(process.platform === \'win32\' ? 10_000 : 2_000);\n  assert.equal(pi.running, false);' }] })}`],
    ['echo', 'edit: Successfully replaced 1 block(s) in test/pi.test.ts.'],
    ['tool', `write ${JSON.stringify({ path: 'docs/windows.md', content: WINDOWS_NOTE })}`],
    ['echo', 'write: Successfully wrote 263 bytes to docs/windows.md'],
    ['talk', 'Done: the test waits ten seconds on Windows, and `docs/windows.md` says why stopping is slower there.'],
  ],
  [
    ['user', 'Good. Get someone to check how T3 Code handles reconnects, and someone to run that test on Windows.'],
    ['tool', 'spawn {"tasks":[{"title":"How T3 Code reconnects","task":"Read-only investigation of the reconnect path…"},{"title":"Run the shutdown test on Windows","task":"Run test/pi.test.ts on the Windows runner…"}]}'],
    ['echo', 'spawn: Started: ce3d516d, a41f09c2. Reports will arrive automatically.'],
    ['talk', 'Started two agents. I\'ll tell you when they report.'],
  ],
  [
    ['work', `[ce3d516d · How T3 Code reconnects] ${RECONNECTS}\n\nFull chat: zoom("ce3d516d")`],
    ['talk', 'That matches what we built: numbered records per window, and the profile\'s log as the snapshot. The Windows run is still going.'],
  ],
];

/** A long edit, for a diff that is longer than the box it opens in: one function rewritten and its tests, most lines kept. */
const STOP_BEFORE = `  async stop(grace: number) {
    const pid = this.child.pid;
    this.child.stdin?.end();
    const kill = setTimeout(() => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      else try { process.kill(-pid, 'SIGKILL'); } catch {}
    }, grace);
    await this.exited;
    this.closed = true;
  }`;
const STOP_AFTER = `  /** Ends Pi: its input first, which Pi takes as the end of the session, and after \`grace\` the whole process tree. */
  async stop(grace: number) {
    if (this.closed) return;
    const pid = this.child.pid;
    if (pid === undefined) return;
    this.child.stdin?.end();
    const kill = setTimeout(() => this.kill(pid), grace);
    await this.exited;
    clearTimeout(kill);
    this.closed = true;
  }

  /** The process tree, at once: Windows has no process groups, so \`taskkill\` walks it. */
  private kill(pid: number) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    else try { process.kill(-pid, 'SIGKILL'); } catch {}
  }

  /** Stops Pi if it is running, and says whether it had to. */
  async ensureStopped(grace = 2_000) {
    const running = !this.closed;
    await this.stop(grace);
    return running;
  }

  /** How long Pi has run, for the status line. */
  get uptime() {
    return this.closed ? 0 : Date.now() - this.started;
  }`;
export const CHANGES: Said[][] = [
  [
    ['user', 'Tidy up `stop()` in the Pi class: one way to kill, and nothing left running after it returns.'],
    ['tool', `edit ${JSON.stringify({ path: 'src/server/pi.ts', edits: [{ oldText: STOP_BEFORE, newText: STOP_AFTER }] })}`],
    ['echo', 'edit: Successfully replaced 1 block(s) in src/server/pi.ts.'],
    ['talk', 'Done: `stop()` clears its timer, returns early when Pi is gone, and kills through one `kill()`.'],
  ],
];

/** A reply with formulas, prices beside them, and a table: what math and a table's copy buttons are pictured with. */
export const FORMULAS: Said[][] = [[
  ['user', 'How much does the cache save us, roughly?'],
  ['talk', 'A cached read costs a tenth of new input, so with a cache share $c$ the input bill is\n\n$$\n\\text{cost} = (1 - c) + \\frac{c}{10}\n$$\n\nof what it was. At $c = 0.92$ that is about $0.17$ of it: last week\'s $57.89 would have been about $340 without it.\n\n| Role | Cost | Cache read |\n| --- | ---: | ---: |\n| Main chat | $36.41 | 92% |\n| Subagents | $19.45 | 88% |\n| Compactor | $2.02 | 71% |'],
]];
/** A message that runs a skill, as Pi sends `/skill:sol-loop …`: the skill's file, and what was typed under it. */
const LOOP = '# Sol loop\n\nReview the change with a GPT Sol subagent, fix what it finds, and review again until it finds nothing.\n\n## Steps\n\n1. Diff the branch against `main`.\n2. Spawn the reviewer with the diff and the repository\'s AGENTS.md.\n3. Fix every finding that is real; say why for the rest.\n4. Repeat until the reviewer passes it.';
export const SKILLED: Said[][] = [[
  ['user', `<skill name="sol-loop" location="/home/.agents/skills/sol-loop/SKILL.md">\nReferences are relative to /home/.agents/skills/sol-loop.\n\n${LOOP}\n</skill>\n\nthe last commit, before I open the PR`],
  ['talk', 'Round 1 found two things: `stop()` never clears its timer, and the test reads the log before it is flushed. Both are fixed in `a1b2c3d`. Round 2 passed with nothing to add.'],
]];
/** A reply that shows pictures: one on this machine by its absolute path (`chart`), one that is no longer there, and one on the
 * web, which stays a link. */
export const GONE = '/tmp/optchat-gone/last-week.png';
export const PICTURED = (chart: string): Said[][] => [[
  ['user', 'How did the cache do this week?'],
  ['talk', `Here is the week as \`npm run usage\` drew it:\n\n![Cache share by day](${chart})\n\nLast week's chart was in /tmp and is gone: ![last week](${GONE})\n\nThe rates are on the pricing page: ![pricing](https://example.com/pricing.png)`],
]];
/** A reply that names files: two that are in the window's folder (`FILES`), and one that is not. */
export const FILES = ['src/server/pi.ts', 'test/pi.test.ts'];
export const NAMED: Said[][] = [[
  ['user', 'Where does the server wait for Pi to stop?'],
  ['talk', 'In `src/server/pi.ts:74`, where `stop()` waits out the grace period ([`src/server/pi.ts` on GitHub](https://github.com/acme/optchat-app/blob/main/src/server/pi.ts#L74)); [the shutdown test in `test/pi.test.ts`](test/pi.test.ts) covers it. The old `src/server/wait.ts` is gone.'],
]];
/** A chat that names issues and pull requests, for the GitHub list: by link in what was said, in an agent's report and in what
 * `gh pr create` printed, and one only by its number, which the list cannot know. */
export const SHIPPING: Said[][] = [
  [
    ['user', 'Where does 0.2.0 stand? The Windows failure is https://github.com/acme/optchat-app/issues/38.'],
    ['talk', 'Two things went in since 0.1.0: the numbered records (https://github.com/acme/optchat-app/pull/36), which closed https://github.com/acme/optchat-app/issues/29, and the first try at the Windows stop, https://github.com/acme/pi-tools/pull/112, which was closed unmerged.\n\nStill open: https://github.com/acme/optchat-app/pull/41 stops a Pi that does not answer, and https://github.com/acme/optchat-app/pull/43 reconnects by sequence number. #40 can wait, and so can https://github.com/acme/optchat-app/issues/31 and https://github.com/acme/optchat-app/issues/33.'],
  ],
  [
    ['user', 'Open a draft for the release notes, and ask infra whether the runner image changed.'],
    ['tool', `bash ${JSON.stringify({ command: 'gh pr create --draft --title "Release notes for 0.2.0" --body-file notes.md' })}`],
    ['echo', 'bash: https://github.com/acme/optchat-app/pull/44'],
    ['work', '[5d0e6f1b · Ask infra about the runner] The image changed on Monday, in https://github.com/acme/infra/pull/7: it now ships Node 26.\n\nFull chat: zoom("5d0e6f1b")'],
    ['talk', 'The draft is https://github.com/acme/optchat-app/pull/44. Infra changed the runner image on Monday, which is when the Windows test began to fail.'],
  ],
];
/** What GitHub has of the SHIPPING chat's items, as its GraphQL answers for each: for the fake `gh`. One of them is in a
 * repository this login is not shown. */
export const SHIPPED = {
  'acme/optchat-app#31': issue('Say which window a queued message is for', 'CLOSED'), 'acme/optchat-app#33': issue('Esc in the settings stops the run', 'CLOSED'),
  'acme/optchat-app#38': issue('The shutdown test fails on Windows', 'OPEN'), 'acme/optchat-app#29': issue('A window forgets its queue when the page reloads', 'CLOSED'),
  'acme/optchat-app#36': pullRequest('Number each window\'s records', 'MERGED'), 'acme/pi-tools#112': pullRequest('Use taskkill /T on Windows', 'CLOSED'),
  'acme/optchat-app#41': pullRequest('Stop a Pi that does not answer', 'OPEN', { checks: 'SUCCESS', reviewDecision: 'APPROVED' }),
  'acme/optchat-app#43': pullRequest('Reconnect with the last sequence number the page saw', 'OPEN', { checks: 'FAILURE', reviewDecision: 'CHANGES_REQUESTED' }),
  'acme/optchat-app#44': pullRequest('Release notes for 0.2.0', 'OPEN', { checks: 'PENDING', reviewDecision: 'REVIEW_REQUIRED', isDraft: true }),
};

/** One of an agent's replies: what it says, and the tools it calls with what each printed. A call with nothing printed is
 * still running. */
type Reply = { say?: string; calls?: [name: string, args: object, result?: string][] };
/** An agent's chat as Pi keeps it in a session file: its task, then its replies, each followed by its tools' results. */
function session(task: string, replies: Reply[], start: number): object[] {
  let clock = start, calls = 0;
  return [{ role: 'user', content: [{ type: 'text', text: `<chat>\n…\n</chat>\n\nYour task:\n${task}` }], timestamp: clock }, ...replies.flatMap(({ say, calls: called = [] }) => {
    const made = called.map(([name, args, result]) => ({ id: `call-${calls++}`, name, args, result }));
    return [
      { role: 'assistant', timestamp: clock += 3000, stopReason: made.length ? 'toolUse' : 'stop', content: [...say ? [{ type: 'text', text: say }] : [], ...made.map(({ id, name, args }) => ({ type: 'toolCall', id, name, arguments: args }))] },
      ...made.flatMap(({ id, name, result }) => result === undefined ? [] : [{ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: result }], timestamp: clock += 2000 }]),
    ];
  })];
}
/** The agents of the TEAM chat, as pi-optchat keeps them in the profile's `runs`: two at work (one with an agent of its own),
 * and others that ended each way. `end` is when the picture is taken. */
export function agents(directory: string, end: number) {
  const ago = (seconds: number) => end - seconds * 1000;
  const run = (id: string, title: string | undefined, task: string, state: Parameters<typeof writeRun>[1]['state'], started: number, more: Partial<Parameters<typeof writeRun>[1]> = {}, replies: Reply[] = []) =>
    writeRun(directory, { id, ...title && { title }, task, state, started: ago(started), model: 'anthropic/claude-sonnet-5', ...more }, session(task, replies, ago(started)));
  run('a41f09c2', 'Run the shutdown test on Windows', 'Run test/pi.test.ts on the Windows runner and say whether the ten-second grace is enough. Do not change the test.', 'running', 96, {}, [
    { say: 'I\'ll read the test, then find the run that failed.', calls: [['read', { path: 'test/pi.test.ts' }, 'test(\'stop() ends a Pi that does not answer\', async () => {\n  const pi = start();\n  await pi.stop(process.platform === \'win32\' ? 10_000 : 2_000);\n  …']] },
    { calls: [['spawn', { tasks: [{ title: 'Find the failing CI run', task: 'Find the last failing windows-latest run of the test workflow…' }] }, 'Started: 7be2d1a0. Reports will arrive automatically.']] },
    { say: 'The failing run timed out after two seconds. Running it with the new grace now.', calls: [['bash', { command: 'gh workflow run test.yml --ref fix/windows-stop && gh run watch' }]] },
  ]);
  run('7be2d1a0', 'Find the failing CI run', 'Find the last failing windows-latest run of the test workflow and say which assertion failed.', 'completed', 80, { parentId: 'a41f09c2', depth: 2, ended: ago(58), report: 'Run 8841 failed in `stop() ends a Pi that does not answer`: Pi was still running after 2,000 ms.' }, [
    { calls: [['bash', { command: 'gh run list --workflow test.yml --status failure --limit 5' }, 'completed\tfailure\tFix the shutdown test\ttest\tmain\tpush\t8841\t1m12s\t2h']] },
    { say: 'Run 8841 failed in `stop() ends a Pi that does not answer`: Pi was still running after 2,000 ms.' },
  ]);
  run('5d0e6f1b', 'Draft the release notes', 'Draft release notes for 0.2.0 from the merged pull requests since v0.1.0.', 'running', 9);
  run('ce3d516d', 'How T3 Code reconnects', 'Read-only investigation of the reconnect path in ~/Downloads/t3code: what does a client send when its socket comes back, and what does the server answer? Change nothing.', 'completed', 420, { ended: ago(318), report: RECONNECTS }, [
    { say: 'I\'ll find where the client reconnects.', calls: [['grep', { pattern: 'reconnect', path: 'apps/web/src' }, 'apps/web/src/rpc/wsTransport.ts:112:  private reconnect() {\napps/web/src/rpc/wsTransport.ts:131:    this.send({ type: \'resume\', after: this.lastSequence });'], ['read', { path: 'apps/web/src/rpc/wsTransport.ts', offset: 100, limit: 60 }, '  private reconnect() {\n    this.socket = new WebSocket(this.url);\n    …']] },
    { say: 'The client sends the last sequence number it saw. Now the server side.', calls: [['read', { path: 'apps/server/src/orchestration/replay.ts' }, 'export function replay(thread: Thread, after: number) {\n  if (after < thread.log.first) return snapshot(thread);\n  return thread.log.since(after);\n}']] },
    { say: RECONNECTS },
  ]);
  run('3f6c88e1', 'Benchmark the log reader', 'Time reading a 20,000-message log, page by page.', 'failed', 1560, { sessionFile: undefined, ended: ago(1556), report: 'Task error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' });
  run('0d93b7aa', 'Audit the WebSocket origin check', 'Read src/server/server.ts and say whether a page on another origin can connect.', 'stopped', 3600, { ended: ago(3570), report: 'Stopped by the main agent.' });
  run('b2c4e6f8', undefined, 'Count the lines of TypeScript in src/ and say which file is the longest.\nReport one line.', 'completed', 7200, { ended: ago(7188), report: '4,812 lines; `src/ui/transcript.ts` is the longest at 361.' });
}

/** Writes `turns` turns of the chat (`from`, over again) to the profile in `directory`, a message a minute (or every `apart`
 * ms), the newest that long before `end`. */
export function seed(directory: string, turns: number, end = Date.UTC(2026, 10, 12, 9, 0, 0), from = TURNS, apart = 60_000) {
  const said = [NOTE, ...Array.from({ length: turns }, (_, turn) => from[turn % from.length]).flat()];
  const entries = said.map(([kind, text], i) => JSON.stringify({ i, kind, date: new Date(end - (said.length - i) * apart).toISOString(), text }));
  mkdirSync(join(directory, 'main'), { recursive: true });
  writeFileSync(join(directory, 'main', '2026-11-12.jsonl'), `${entries.join('\n')}\n`);
}
/** The summaries and the view of a seeded profile, as pi-optchat would have left them: a line for every message, a summary
 * for every two lines under it (here the first words of what was asked and answered, where pi-optchat has a model write
 * one), and a view that keeps the last `kept` messages one by one and folds the rest, the oldest the most. */
export function remember(directory: string, kept = 9) {
  const entries: { kind: string; text: string }[] = readFileSync(join(directory, 'main', '2026-11-12.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const sentence = (text: string) => text.split(/(?<=[.?!:])\s|\n/)[0].replace(/[`*#]/g, '').trim();
  const nodes = entries.map(({ kind, text }, i) => ({ l: 0, i, text: `${kind}: ${text}`.slice(0, 480) }));
  for (let l = 1; entries.length >> l > 0; l++) for (let i = 0; i < entries.length >> l; i++) {
    const among = entries.slice(i * 2 ** l, (i + 1) * 2 ** l), of = (kind: string) => among.filter(entry => entry.kind === kind), calls = of('tool');
    const lines = [
      ...of('user').slice(0, 3).map(entry => `user: ${sentence(entry.text)}`),
      ...of('talk').slice(-2).map(entry => `talk: ${sentence(entry.text)}`),
      ...calls.length ? [`tool: ${calls.length} ${calls.length === 1 ? 'call' : 'calls'}, the first to ${calls[0].text.split(' ')[0]}`] : [],
    ];
    nodes.push({ l, i, text: lines.join('\n') || `${among[0].kind}: ${sentence(among[0].text)}` });
  }
  const parts: [l: number, i: number][] = [];
  for (let l = 20, covered = 0; l >= 0; l--) while (covered + 2 ** l <= entries.length - (l ? kept : 0)) { parts.push([l, covered / 2 ** l]); covered += 2 ** l; }
  mkdirSync(join(directory, 'tree'), { recursive: true });
  writeFileSync(join(directory, 'tree', '2026-11-12.jsonl'), `${nodes.map(node => JSON.stringify({ ...node, size: Buffer.byteLength(node.text) })).join('\n')}\n`);
  writeFileSync(join(directory, 'view.json'), JSON.stringify({ parts, merging: false }));
}

const ANSWER = `## What I found

The working tree is clean apart from **two files**, and the README describes the layout the UI follows:

- \`src/server\` runs each window as one \`pi --mode rpc\` process
- \`src/ui\` is the page you are looking at
- the profile's memory is read from disk, so history shows without Pi running

\`\`\`ts
const { window } = await client.request('open', { profile: 'work' });
await client.request('prompt', { window: window.id, text: 'hello' });
\`\`\`

| Piece | State |
| --- | --- |
| Server | merged |
| UI | this slice |

Next I would wire the agents panel.`;
/** What the fake Pi answers in the screenshots: asked for a "demo" it thinks, runs two tools and answers in Markdown. Its
 * messages are dated from `clock` on, so the pictures do not change with the time of day. */
export const demo = (clock: number): Script => ({
  clock,
  handoff: 'Goal: a tour of this repository.\n\nDone: Read `src/` and `README.md` and described the server, the protocol and the UI. Nothing was changed.\n\nOpen: The agents panel is not wired yet.',
  replies: {
    demo: {
      turns: [{
        content: [
          { type: 'thinking', thinking: 'The user wants an overview. I should look at the repository before answering.' },
          { type: 'text', text: 'I\'ll look at the repository first.' },
          { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'git status --short' } },
          { type: 'toolCall', id: 'call-2', name: 'read', arguments: { path: 'README.md' } },
        ],
        results: [' M src/server/windows.ts\n?? src/ui/\n', '# OptChat app\n\nA desktop app for pi-optchat: one chat per profile that never ends.\n'],
      }],
      answer: ANSWER,
    },
    'check the tests': { turns: [{ content: [{ type: 'toolCall', id: 'call-3', name: 'bash', arguments: { command: 'npm test' } }], results: ['ℹ tests 27\nℹ pass 27\nℹ fail 0\n'] }], answer: 'All 27 tests pass.' },
    'pull request': { turns: [], answer: 'Opened the pull request: the UI, its tests and the screenshot script.' },
  },
});

/** What a million tokens cost, by model: in, out, read from the cache, written to it. */
const PRICES: Record<string, [input: number, output: number, read: number, write: number]> = {
  'claude-opus-5-5': [5, 25, 0.5, 6.25], 'claude-sonnet-5-5': [3, 15, 0.3, 3.75], 'claude-haiku-5-5': [1, 5, 0.1, 1.25],
};
/** A profile's usage ledger as pi-optchat writes one, for the `days` before `now`: the main chat's answers through each day's
 * working hours, its agents' and its summaries', and an import on the first day. The same lines every time. */
export function spend(directory: string, now: number, days = 10) {
  let state = 7;
  const chance = () => (state = state * 16807 % 2147483647) / 2147483647, between = (low: number, high: number) => Math.round(low + chance() * (high - low));
  const line = (at: number, role: string, model: string, input: number, output: number, cacheRead: number, cacheWrite: number) => {
    const [i, o, r, w] = PRICES[model], cost = { input: input * i / 1e6, output: output * o / 1e6, cacheRead: cacheRead * r / 1e6, cacheWrite: cacheWrite * w / 1e6 };
    return JSON.stringify({ id: `entry:${at}:${role}`, date: new Date(at).toISOString(), role, session: 'seeded', provider: 'anthropic', model,
      usage: { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { ...cost, total: cost.input + cost.output + cost.cacheRead + cost.cacheWrite } } });
  };
  const first = now - days * 86400_000, lines = [line(first, 'import', 'claude-sonnet-5-5', 912_000, 71_400, 0, 0)];
  for (let at = first + 1200_000; at <= now; at += 1200_000) {
    const hour = new Date(at).getUTCHours();
    if (hour < 7 || hour > 17 || chance() < 0.35) continue;
    lines.push(line(at, 'main', 'claude-opus-5-5', between(8, 40), between(400, 5200), between(90_000, 260_000), between(1500, 22_000)));
    if (chance() < 0.45) lines.push(line(at + 60_000, 'subagent', chance() < 0.7 ? 'claude-opus-5-5' : 'claude-haiku-5-5', between(10, 60), between(900, 9000), between(40_000, 420_000), between(4000, 60_000)));
    if (chance() < 0.5) lines.push(line(at + 90_000, 'compactor', 'claude-sonnet-5-5', between(1200, 6400), between(300, 900), between(9000, 24_000), between(0, 2600)));
  }
  writeFileSync(join(directory, 'usage.jsonl'), lines.join('\n') + '\n');
}

/** A subscription's limits as pi-optchat saves them (`limits.json`): counted `ago` before `now`, with the five hours ending
 * some three hours after that and the week some four days after. A window used up is reached. */
export function limited(directory: string, now: number, { five, week, ago = 3 * 60_000, overage = false, refused }: { five: number; week: number; ago?: number; overage?: boolean; refused?: number }) {
  const at = now - ago, date = (time: number) => new Date(time).toISOString();
  writeFileSync(join(directory, 'limits.json'), JSON.stringify({ at: date(at), overage, ...refused !== undefined && { refused: date(now - refused) }, limits: [
    { window: '5h', used: five, resets: date(at + 178 * 60_000), reached: five >= 1 },
    { window: '7d', used: week, resets: date(at + 86 * 3600_000), reached: week >= 1 },
  ] }));
}
