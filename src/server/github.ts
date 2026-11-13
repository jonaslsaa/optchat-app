import { execFile, type ExecFileException } from 'node:child_process';
import type { Memory } from 'pi-optchat/files';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { GitHubItem, Params, Result } from '../protocol.ts';
import { pair, type Profiles } from './profiles.ts';
import type { Launch } from './setup.ts';

const SHOWN = 30;
/** How many items one question to GitHub is about, and how many a look asks about at most: the rest wait for the next look. */
const BATCH = 100, ASKED = 300;
/** An item that may change is asked about again once what is known of it is this old (ms), and `gh` gets this long to answer. */
const FRESH = 50_000, WAIT = 20_000;
/** A `gh` that could not ask is not tried again sooner than this (ms), unless the look says to (`fresh`): a chat at work is
 * looked at with every message. */
const RETRY = 3000;

/** An issue or pull request by its address on github.com, and nothing else. The log holds text the agent read from anywhere,
 * and what this takes from it goes to a program: so an owner, a repository and a number are only ever what this pattern
 * matched, which is letters, digits, `.`, `_` and `-` (no quote, no space, nothing a query or a command line could be broken
 * out of with), and a number of at most nine digits. */
const ITEM = /https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/((?!\.{1,2}\/)[A-Za-z0-9._-]{1,100})\/(pull|issues)\/([1-9][0-9]{0,8})(?![A-Za-z0-9_-])/g;
/** Where a shell starts a command, past `NAME=value` assignments and wrappers like `timeout 60`, and where a command's word
 * ends: T3 Code's patterns. `gh pr view` anywhere else, as in `rg 'gh pr view' README.md`, is text and not a command that runs. */
const START = '(?:^|[;&|({`\\n]|\\b(?:do|then|else)\\s)\\s*(?:(?:\\w+=\\S*|env|time|nohup|timeout\\s+\\S+)\\s+)*', END = '(?=$|[\\s;&|)])';
/** The `gh` commands that are about items they name or act on. */
const ACTS = new RegExp(`${START}gh\\s+(?:pr|issue)\\s+(?:create|view|merge|checks|comment|edit|close|reopen|review|ready)${END}`);
/** Those that print what the chat never dealt with. Run beside one of the others, nothing says which output is whose. */
const LISTS = new RegExp(`${START}gh\\s+(?:(?:pr|issue)\\s+(?:list|status)|search)${END}`);
/** A call of the bash tool, as the log has it after the tool's name. */
const Bash = Type.Object({ command: Type.String() });
/** Of what such a command printed, the addresses that are of its own item: the one after `"url":` or `url:`, and one that
 * stands alone on a line, as `gh pr create` prints it. A pull request's body and its comments are full of other people's:
 * `gh pr view` prints them under a line of `--`, and nothing under that line is read. */
const OWN = /"url":\s*"(https:\/\/github\.com\/[^"\s]+)"|^(?:url:)?[ \t]*(https:\/\/github\.com\/\S+)[ \t]*$/gm;

export interface Mention { owner: string; repo: string; number: number; kind: GitHubItem['kind']; at: number }
const key = ({ owner, repo, number }: Mention) => `${owner}/${repo}#${number}`.toLowerCase();

/** The text of message `i` in which an address counts as the chat naming the item: what you and the agent said, an agent's
 * report, and a `gh` command about an item together with the item's own address in what it printed. Not other tool output,
 * which is full of the links of every page the agent read. */
function counted(memory: Memory, i: number): string | undefined {
  const { kind } = memory.root[i];
  if (kind === 'user' || kind === 'talk' || kind === 'work') return memory.text(i);
  // A call is logged as its tool's name and its arguments, `bash {"command":"gh pr create …"}`, and what it printed as
  // `bash: …`.
  const call = kind === 'echo' ? pair(memory, i)?.[0] : undefined, said = call === undefined ? '' : memory.text(call);
  if (!said.startsWith('bash ')) return;
  let args: unknown;
  try { args = JSON.parse(said.slice('bash '.length)); } catch {}
  if (!Value.Check(Bash, args) || !ACTS.test(args.command) || LISTS.test(args.command)) return;
  const [printed] = memory.text(i).slice('bash: '.length).split(/^--$/m, 1);
  return [args.command, ...Array.from(printed.matchAll(OWN), ([, quoted, alone]) => quoted ?? alone)].join('\n');
}
/** The issues and pull requests a log names: each once, with the last message that names it. */
export function mentions(memory: Memory) {
  const found = new Map<string, Mention>();
  for (let i = 0; i < memory.root.length; i++) {
    for (const [, owner, repo, type, number] of counted(memory, i)?.matchAll(ITEM) ?? []) {
      const mention: Mention = { owner, repo, number: Number(number), kind: type === 'pull' ? 'pull' : 'issue', at: i };
      found.set(key(mention), mention);
    }
  }
  return [...found.values()];
}

/** One question about `items`, each under a name of its own (`i0`, `i1`, …). Only what `ITEM` matched is written into it. */
export function query(items: readonly Mention[]) {
  const asked = items.map(({ owner, repo, number }, k) => `i${k}: repository(owner: "${owner}", name: "${repo}") { issueOrPullRequest(number: ${number}) { ...item } }`);
  return `query { ${asked.join(' ')} } fragment item on IssueOrPullRequest { __typename ... on PullRequest { title state isDraft reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } ... on Issue { title state } }`;
}
/** What GitHub answers to that, as far as the app reads it: an item it has. One it does not have, or does not show to this
 * login, is `null` in the answer, or its repository is. */
const Answer = Type.Object({ data: Type.Record(Type.String(), Type.Unknown()) });
const Found = Type.Object({ issueOrPullRequest: Type.Object({
  __typename: Type.Enum(['PullRequest', 'Issue']), title: Type.String(), state: Type.Enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: Type.Optional(Type.Boolean()), reviewDecision: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  commits: Type.Optional(Type.Object({ nodes: Type.Array(Type.Object({ commit: Type.Object({ statusCheckRollup: Type.Union([Type.Object({ state: Type.String() }), Type.Null()]) }) })) })),
}) });
type Status = Pick<GitHubItem, 'kind' | 'title' | 'state' | 'checks' | 'review'>;
const STATE = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' } as const;
const CHECKS: Record<string, Status['checks']> = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'pending', EXPECTED: 'pending' };
const REVIEW: Record<string, Status['review']> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'review_required' };
/** What GitHub answered about one item, in the app's words. Checks and a review are said of an open one only. */
function status({ issueOrPullRequest: item }: Static<typeof Found>): Status {
  const open = item.state === 'OPEN';
  const checks = open ? CHECKS[item.commits?.nodes[0]?.commit.statusCheckRollup?.state ?? ''] : undefined, review = open ? REVIEW[item.reviewDecision ?? ''] : undefined;
  return { kind: item.__typename === 'PullRequest' ? 'pull' : 'issue', title: item.title, state: open && item.isDraft ? 'draft' : STATE[item.state], ...checks && { checks }, ...review && { review } };
}
/** An item that is merged or closed stays so, as far as the list cares. */
const done = (status?: Status) => status?.state === 'merged' || status?.state === 'closed';

type Gh = Pick<Result<'github'>, 'gh' | 'message'>;
/** Why `gh` gave no answer. It ends with 4 when it has no login, and says how to get one. */
function failure(error: ExecFileException | null, stderr: string): Gh {
  if (error?.code === 'ENOENT') return { gh: 'missing' };
  if (error?.code === 4 || /gh auth login/.test(stderr)) return { gh: 'signed_out' };
  const why = stderr.trim().split('\n')[0] || (error?.killed ? 'gh did not answer in time' : 'gh gave no answer');
  return { gh: 'failed', message: why.slice(0, 300) };
}

/** The issues and pull requests a profile's main chat named, with their status from GitHub. The items are found in the log
 * at every look, which takes a few milliseconds for a chat of years. Their status is asked of the GitHub CLI, run as a
 * program with its arguments in a list, never through a shell, with whatever login it has: the app reads no token and keeps
 * none. Nothing is kept on disk, and nothing is asked while nobody looks.
 *
 * A look answers at once with what is known, and asks in the background about what is due: an item that was never asked
 * about, and one that is not merged or closed and was last asked about longer than `FRESH` ago. That is the open ones, and
 * those GitHub said nothing of, which it may yet: a login that is let in later, an answer that fell short. One that is
 * merged or closed is not asked about again. Only while `gh` cannot ask does a look wait for its own try, which is short:
 * so the look after `gh auth login` is the one that has the status. */
export class GitHub {
  /** What GitHub said of each item, and when it was asked. */
  private readonly known = new Map<string, { asked: number; status?: Status }>();
  /** How the last question went, and the one being asked: one at a time, so that two pages do not ask the same twice. */
  private said: Gh = { gh: 'ok' };
  private asking?: Promise<void>;
  private failed = -Infinity;
  private readonly profiles: Profiles;
  private readonly gh: Launch;
  constructor(profiles: Profiles, gh: Launch = { command: 'gh', args: [] }) { this.profiles = profiles; this.gh = gh; }

  async list({ profile, limit = SHOWN, fresh = false }: Params<'github'>): Promise<Result<'github'>> {
    const found = mentions(await this.profiles.memory(profile)), now = Date.now();
    const status = (mention: Mention) => this.known.get(key(mention))?.status;
    const due = () => found.filter(mention => {
      const known = this.known.get(key(mention));
      return !known || !done(known.status) && now - known.asked >= FRESH;
    });
    if (this.said.gh === 'ok') void this.refresh(due());
    else if (fresh || now - this.failed >= RETRY) await this.refresh(due());

    const open = (mention: Mention) => Number(status(mention) !== undefined && !done(status(mention)));
    const items = found.toSorted((a, b) => open(b) - open(a) || b.at - a.at).slice(0, limit).map((mention): GitHubItem => {
      const { owner, repo, number, at } = mention, kind = status(mention)?.kind ?? mention.kind;
      return { repo: `${owner}/${repo}`, number, url: `https://github.com/${owner}/${repo}/${kind === 'pull' ? 'pull' : 'issues'}/${number}`, at, ...status(mention), kind };
    });
    // With nothing left to ask, how the last asking went is no news.
    const pending = due().length;
    return { items, more: Math.max(0, found.length - limit), pending, ...pending ? this.said : { gh: 'ok' } };
  }
  /** Asks about what is due, the latest named first, unless a question is on its way: what that leaves is due at the next look. */
  private refresh(due: Mention[]) {
    if (this.asking || !due.length) return this.asking;
    due.sort((a, b) => b.at - a.at);
    const asking = async () => {
      for (let from = 0; from < Math.min(due.length, ASKED); from += BATCH) {
        this.said = await this.ask(due.slice(from, from + BATCH));
        if (this.said.gh !== 'ok') break;
      }
    };
    // `gh` could not be run at all (a command no system takes): that is a failure to say, too.
    return this.asking = asking().catch(() => { this.said = { gh: 'failed', message: 'gh could not be run' }; }).finally(() => {
      this.asking = undefined;
      if (this.said.gh !== 'ok') this.failed = Date.now();
    });
  }
  /** One question to GitHub, of github.com whatever host this `gh` is set to ask by default: the addresses are all there. */
  private ask(items: readonly Mention[]) {
    const options = { timeout: WAIT, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } };
    return new Promise<Gh>(resolve => {
      execFile(this.gh.command, [...this.gh.args, 'api', 'graphql', '--hostname', 'github.com', '-f', `query=${query(items)}`], options, (error, stdout, stderr) => {
        let answer: unknown;
        try { answer = JSON.parse(stdout); } catch {}
        // An answer that leaves some items out (a repository that is gone, or not this login's to see) is an answer all the
        // same, though `gh` then ends as failed: those items have no status.
        if (!Value.Check(Answer, answer)) return resolve(failure(error, stderr));
        const asked = Date.now();
        items.forEach((mention, k) => {
          const said = answer.data[`i${k}`];
          this.known.set(key(mention), { asked, status: Value.Check(Found, said) ? status(said) : undefined });
        });
        resolve({ gh: 'ok' });
      });
    });
  }
}
