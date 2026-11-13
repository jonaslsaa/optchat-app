import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunInfo } from 'pi-optchat/files';

/** A throwaway OPTCHAT_HOME under /tmp (a short path: profile sockets have a length limit), removed when the test process exits.
 * No test may touch the real ~/.optchat, nor the app's own folder: a server started without one gets a folder in here. */
export function temporaryHome() {
  const home = realpathSync(mkdtempSync('/tmp/optchat-app-test-'));
  process.env.OPTCHAT_APP_HOME = join(home, 'app'); // Whatever it was: never your own.
  process.on('exit', () => rmSync(home, { recursive: true, force: true }));
  return home;
}
/** An item as GitHub's GraphQL answers for it, for the fake `gh` (`fake-gh.ts`): a pull request, with how its checks stand
 * and what its review came to, and an issue. */
export const pullRequest = (title: string, state: 'OPEN' | 'CLOSED' | 'MERGED', { isDraft = false, reviewDecision = null, checks }: { isDraft?: boolean; reviewDecision?: string | null; checks?: string } = {}) =>
  ({ __typename: 'PullRequest', title, state, isDraft, reviewDecision, commits: { nodes: [{ commit: { statusCheckRollup: checks ? { state: checks } : null } }] } });
export const issue = (title: string, state: 'OPEN' | 'CLOSED') => ({ __typename: 'Issue', title, state });
/** A profile as pi-optchat creates one. Cheap models, so a live turn costs next to nothing. */
export function createProfile(home: string, name: string) {
  const directory = join(home, 'profiles', name);
  mkdirSync(directory, { recursive: true });
  const model = { provider: 'anthropic', model: 'claude-haiku-5-5', thinking: 'off' };
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ compactor: model, subagent: model }));
  writeFileSync(join(directory, 'AGENTS.md'), `# ${name}\n\nA test profile. Answer in one short sentence.\n`);
  return directory;
}
/** Fills a profile's memory with `count` messages and every summary node above them, as files. */
export function writeMemory(directory: string, count: number, text = (i: number) => `message ${i}`) {
  for (const sub of ['main', 'tree']) mkdirSync(join(directory, sub), { recursive: true });
  const entries: string[] = [], nodes: string[] = [];
  for (let i = 0; i < count; i++) entries.push(JSON.stringify({ i, kind: i % 2 ? 'talk' : 'user', date: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), text: text(i) }));
  for (let l = 0; count >> l > 0; l++) for (let i = 0; i < count >> l; i++) {
    const summary = l ? `summary of ${i * 2 ** l}+${2 ** l}` : `${i % 2 ? 'talk' : 'user'}: ${text(i)}`;
    nodes.push(JSON.stringify({ l, i, text: summary, size: Buffer.byteLength(summary) }));
  }
  writeFileSync(join(directory, 'main', '2026-01-01.jsonl'), entries.join('\n') + '\n');
  writeFileSync(join(directory, 'tree', '2026-01-01.jsonl'), nodes.join('\n') + '\n');
}
/** A subagent as pi-optchat keeps one: its record, and its chat in a Pi session file, a line a message. */
export function writeRun(directory: string, run: Pick<RunInfo, 'id' | 'state' | 'started'> & Partial<RunInfo>, messages: object[] = []) {
  const runs = join(directory, 'runs'), sessionFile = join(runs, `${run.id}.jsonl`);
  mkdirSync(runs, { recursive: true });
  writeFileSync(sessionFile, [{ type: 'session', version: 3, id: run.id }, ...messages.map(message => ({ type: 'message', message }))].map(line => JSON.stringify(line)).join('\n') + '\n');
  writeFileSync(join(runs, `${run.id}.optchat.json`), JSON.stringify({ task: 'Look into it.', cwd: '/tmp', model: 'anthropic/claude-haiku-5-5', thinking: 'off', parentSession: 'main', depth: 1, guidance: [], sessionFile, ...run } satisfies RunInfo));
}
