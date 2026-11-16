import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon, CircleXIcon, GitMergeIcon, GitPullRequestArrowIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, UserCheckIcon, UserRoundIcon, UserRoundXIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GitHubItem, Result } from '../protocol.ts';
import { app, type State } from './store.ts';
import { Button, cn, More, Section } from './ui.tsx';

/** How many are listed, how often GitHub is asked while the list is in sight (ms), and how soon the answer to a question
 * that was just asked is looked for. */
const SHOWN = 8, EVERY = 60_000, SOON = 1000;
type Sign = [Icon: LucideIcon, label: string, tone: string];
// The glyphs and their colours are T3 Code's (its `pullRequestIcons.tsx` and `pullRequestPresentation.tsx`).
const GOOD = 'text-emerald-600 dark:text-emerald-300/90', BAD = 'text-red-600 dark:text-red-300/90', DONE = 'text-violet-600 dark:text-violet-300/90', QUIET = 'text-muted-foreground/60';
const STATE: Record<GitHubItem['kind'], Record<NonNullable<GitHubItem['state']>, Sign>> = {
  pull: { open: [GitPullRequestArrowIcon, 'Open', GOOD], draft: [GitPullRequestDraftIcon, 'Draft', 'text-zinc-500 dark:text-zinc-400/80'], merged: [GitMergeIcon, 'Merged', DONE], closed: [GitPullRequestClosedIcon, 'Closed', BAD] },
  issue: { open: [CircleDotIcon, 'Open', GOOD], draft: [CircleDotIcon, 'Open', GOOD], merged: [CircleCheckIcon, 'Closed', DONE], closed: [CircleCheckIcon, 'Closed', DONE] },
};
const UNKNOWN: Record<GitHubItem['kind'], Sign> = { pull: [GitPullRequestArrowIcon, 'Pull request', QUIET], issue: [CircleDotIcon, 'Issue', QUIET] };
const CHECKS: Record<NonNullable<GitHubItem['checks']>, Sign> = {
  passing: [CircleCheckIcon, 'Checks pass', GOOD], failing: [CircleXIcon, 'Checks fail', 'text-destructive-foreground'], pending: [CircleDashedIcon, 'Checks are running', 'text-amber-500'],
};
const REVIEW: Record<NonNullable<GitHubItem['review']>, Sign> = {
  approved: [UserCheckIcon, 'Approved', GOOD], changes_requested: [UserRoundXIcon, 'Changes requested', 'text-amber-600/90 dark:text-amber-400/80'], review_required: [UserRoundIcon, 'Awaiting review', QUIET],
};
const Glyph = ({ sign: [Icon, label, tone] }: { sign: Sign }) => <span title={label} className="inline-flex shrink-0"><Icon role="img" aria-label={label} className={cn('size-3.5', tone)} /></span>;

/** An issue or pull request in the list: how it stands, its title, and under that which it is. It is a link to it on GitHub,
 * which opens in a new tab that knows nothing of this one. */
function Row({ item }: { item: GitHubItem }) {
  const sign = item.state ? STATE[item.kind][item.state] : UNKNOWN[item.kind], name = `${item.repo}#${item.number}`;
  return (
    <li>
      <a href={item.url} target="_blank" rel="noreferrer noopener" className="flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/70">
        <span className="flex min-w-0 items-center gap-2">
          <Glyph sign={sign} />
          <span className="min-w-0 flex-1 truncate font-medium text-sm">{item.title ?? name}</span>
          {item.checks && <Glyph sign={CHECKS[item.checks]} />}
          {item.review && <Glyph sign={REVIEW[item.review]} />}
        </span>
        <span className="truncate ps-5.5 text-muted-foreground text-xs">{item.title === undefined ? sign[1] : <>{name} · {sign[1]}</>}</span>
      </a>
    </li>
  );
}
/** Why the list has no status, and what to do about it. */
function help({ gh, message }: Pick<Result<'github'>, 'gh' | 'message'>) {
  if (gh === 'missing') return <>Their status comes from the GitHub CLI, which is not installed: <a href="https://cli.github.com" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">cli.github.com</a></>;
  if (gh === 'signed_out') return <>Their status comes from the GitHub CLI, which is not signed in. In a terminal: <code className="whitespace-nowrap font-mono">gh auth login</code></>;
  return <>GitHub could not be asked for their status: {message ?? 'gh failed'}</>;
}

/** The issues and pull requests the profile's main chat named by their link, and how they stand on GitHub (nothing, where it
 * named none). Only those: one the
 * chat spoke of as "#12" is not here, because nothing says which repository that is in, and a guess would show another's
 * status. It is read when it comes into sight and when a turn of the main chat begins or ends (`pulse`), and once a minute
 * while it is in sight, which is when the server asks GitHub again about the open ones. It only shows: a row is a link to
 * GitHub. */
export function GitHub({ state, profile, pulse }: { state: State; profile: string; pulse: string }) {
  const [limit, setLimit] = useState(SHOWN);
  const list = state.github[profile], items = list?.items ?? [];
  const read = (fresh?: boolean) => void app.readGitHub(profile, limit, fresh);
  // Again once the server is back, too: what was asked while it was away got no answer.
  useEffect(() => { if (state.connection === 'open') read(); }, [profile, limit, pulse, state.connection]);
  // The server answers with what it knows and asks GitHub behind that: what GitHub said is there a moment later.
  const asking = list?.gh === 'ok' && list.pending > 0;
  useEffect(() => { const timer = setInterval(() => read(), asking ? SOON : EVERY); return () => clearInterval(timer); }, [asking, profile, limit]);
  return !list || items.length === 0 ? null : (
    <Section title="GitHub · PRs and issues the chat named by link">
      {list.gh !== 'ok' && (
        <p role="status" className="mx-2.5 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-muted-foreground text-xs">
          <span className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">{help(list)}</span><Button variant="outline" size="xs" onClick={() => read(true)}>Check again</Button>
        </p>
      )}
      <ul className="flex flex-col gap-0.5">{items.map(item => <Row key={`${item.repo}#${item.number}`.toLowerCase()} item={item} />)}</ul>
      {list.more > 0 && <More more={list.more} step={SHOWN} onMore={() => setLimit(limit + SHOWN)} />}
    </Section>
  );
}
