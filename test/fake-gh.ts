import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The GitHub CLI, as far as the app uses it: `gh api graphql --hostname github.com -f query=<query>`, and nothing else. `FAKE_GH_HOME/gh.json`
 * says what GitHub has: `items` by `owner/repo#number` (lower case), each as GitHub's GraphQL answers for it, and
 * `signedOut` or `fails` for a `gh` that cannot ask. Every run is written to `calls.jsonl` with its arguments as they came,
 * for a test to read. It answers as the real one does: an item or a repository GitHub does not have is `null` among the
 * rest, with an error for it, and `gh` then ends with 1. `pullRequest` and `issue` in `support.ts` make an item. */
const home = process.env.FAKE_GH_HOME ?? '', args = process.argv.slice(2);
appendFileSync(join(home, 'calls.jsonl'), `${JSON.stringify(args)}\n`);
const state: { items: Record<string, object | null>; signedOut?: boolean; fails?: string } = JSON.parse(readFileSync(join(home, 'gh.json'), 'utf8'));
const [query] = args.slice(5);
if (args.length !== 6 || args.slice(0, 5).join(' ') !== 'api graphql --hostname github.com -f' || !query.startsWith('query=')) { console.error(`unknown command "${args.join(' ')}" for "gh"`); process.exit(1); }
if (state.signedOut) { console.error('To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.'); process.exit(4); }
if (state.fails) { console.error(state.fails); process.exit(1); }

const data: Record<string, { issueOrPullRequest: object | null } | null> = {}, errors: { type: string; path: string[]; message: string }[] = [];
for (const [, alias, owner, name, number] of query.matchAll(/(i\d+): repository\(owner: "([^"]*)", name: "([^"]*)"\) \{ issueOrPullRequest\(number: (\d+)\) \{ \.\.\.item \} \}/g)) {
  const repo = `${owner}/${name}`.toLowerCase(), found = state.items[`${repo}#${number}`] ?? null;
  if (!Object.keys(state.items).some(item => item.startsWith(`${repo}#`))) { data[alias] = null; errors.push({ type: 'NOT_FOUND', path: [alias], message: `Could not resolve to a Repository with the name '${owner}/${name}'.` }); continue; }
  if (!found) errors.push({ type: 'NOT_FOUND', path: [alias, 'issueOrPullRequest'], message: `Could not resolve to an issue or pull request with the number of ${number}.` });
  data[alias] = { issueOrPullRequest: found };
}
for (const { message } of errors) console.error(`gh: ${message}`);
console.log(JSON.stringify({ data, ...errors.length > 0 && { errors } }));
process.exit(errors.length ? 1 : 0);
