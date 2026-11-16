import { CheckIcon, CircleAlertIcon, CircleDashedIcon, CopyIcon, LogInIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Params, Setup as SetupState } from '../protocol.ts';
import { app, type State } from './store.ts';
import { Button, cn, Spinner } from './ui.tsx';

/** What a chat needs before it can run, each with whether it is there and the one thing to do about it: Pi, pi-optchat in that
 * Pi, a model provider that is logged in, and a first profile. The server finds out and installs (`src/server/setup.ts`); this
 * only shows it. */

type Need = Pick<SetupState['optchat'], 'state' | 'message' | 'command' | 'installable'>;
type What = Params<'install'>['what'];
type Provider = Params<'signIn'>['provider'];
/** The accounts Pi signs in to in the browser, by what people call them. */
const ACCOUNTS = { anthropic: 'Claude', 'openai-codex': 'ChatGPT', 'github-copilot': 'GitHub Copilot' } satisfies Record<Provider, string>;
const NEEDS = [['pi', 'Pi'], ['optchat', 'pi-optchat'], ['login', 'A logged-in model']] as const;
/** What stands between you and a chat, if anything does: the first thing that is missing or too old, said in a notice
 * wherever you are. */
export function missing({ setup }: State) {
  for (const [need, name] of NEEDS) {
    const state = setup?.[need].state;
    if (state === 'missing' || state === 'old') return `${name} is ${state === 'old' ? 'too old for this app' : 'missing'}`;
  }
}

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <span className="mt-1.5 flex items-start gap-1 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2">
      <code className="min-w-0 flex-1 py-1 font-mono text-xs break-all whitespace-pre-wrap">{text}</code>
      <Button variant="ghost-muted" size="icon-xs" aria-label={copied ? 'Copied' : 'Copy'} onClick={copy}>{copied ? <CheckIcon /> : <CopyIcon />}</Button>
    </span>
  );
}
function Step({ name, need, found, action, children }: { name: string; need?: Need; found?: string; action?: ReactNode; children?: ReactNode }) {
  const state = need?.state;
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 shrink-0">
        {!need ? <Spinner className="text-muted-foreground" />
          : state === 'ok' ? <CheckIcon aria-label="Ready" className="size-4 text-emerald-600 dark:text-emerald-400" />
          : state === 'unknown' ? <CircleDashedIcon aria-label="Not known yet" className="size-4 text-muted-foreground" />
          : <CircleAlertIcon aria-label={state === 'old' ? 'Out of date' : 'Missing'} className={cn('size-4', state === 'old' ? 'text-warning-foreground' : 'text-error-foreground')} />}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{name}</span>{found && <span className="min-w-0 truncate text-muted-foreground text-xs">{found}</span>}</p>
        {need?.message && <p className="mt-0.5 text-muted-foreground">{need.message}</p>}
        {need?.command && <Copy text={need.command} />}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

/** Logging in with an account: a button for each, which opens a terminal where Pi does the sign-in in your browser. The page
 * only waits for Pi to say it is done. */
function SignIn({ signingIn }: { signingIn?: Provider }) {
  if (signingIn) return (
    <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
      <Spinner className="size-3 shrink-0" />Finish signing in to {ACCOUNTS[signingIn]} in the terminal window that opened.
      <Button variant="ghost-muted" size="xs" onClick={() => app.cancelSignIn()}>Cancel</Button>
    </p>
  );
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2">
      {(Object.keys(ACCOUNTS) as Provider[]).map(provider => <Button key={provider} variant="outline" onClick={() => void app.signIn(provider)}><LogInIcon />{ACCOUNTS[provider]}</Button>)}
    </p>
  );
}

/** The first profile: a name, and pi-optchat makes it. The server says so when the name will not do. */
function NewProfile() {
  const [name, setName] = useState(''), [making, setMaking] = useState(false), field = useRef<HTMLInputElement>(null);
  // The button is off while it is asked, and loses the focus with that: a name that was refused is put right in its field.
  const make = (event: FormEvent) => { event.preventDefault(); setMaking(true); void app.createProfile(name.trim()).finally(() => { setMaking(false); field.current?.focus(); }); };
  return (
    <form onSubmit={make} className="mt-2 flex flex-wrap items-center gap-2">
      <input ref={field} aria-label="Profile name" value={name} onChange={event => setName(event.target.value)} placeholder="work" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={64}
        className="h-7 w-48 rounded-md border bg-background px-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring" />
      <Button type="submit" variant="outline" disabled={making || !name.trim()}>{making ? <Spinner /> : <PlusIcon />}Create profile</Button>
    </form>
  );
}

export function Setup({ state }: { state: State }) {
  const { setup } = state, job = setup?.job, busy = job?.state === 'running';
  const [checking, setChecking] = useState(false);
  const check = () => { setChecking(true); void Promise.all([app.checkSetup(true), app.findProfiles()]).finally(() => setChecking(false)); };
  // Only what is the app's to change has a button; the rest says which command does it.
  const install = (what: What, need?: Need) => need?.installable && <Button variant="outline" disabled={busy} onClick={() => void app.install(what)}>{need.state === 'old' ? 'Update' : 'Install'}</Button>;
  const progress = (what: What) => job?.what === what && job.state !== 'done' && (
    <div role="status" className="mt-1.5 text-xs">
      <p className={cn('flex items-center gap-1.5', job.state === 'failed' ? 'text-error-foreground' : 'text-muted-foreground')}>{busy && <Spinner className="size-3 shrink-0" />}<span className="min-w-0 truncate">{job.line}</span></p>
      {job.output && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">What it printed</summary><pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-muted/50 p-2 font-mono text-2xs whitespace-pre-wrap">{job.output}</pre></details>}
    </div>
  );
  const pi = setup?.pi, optchat = setup?.optchat, login = setup?.login;
  return (
    <section aria-label="Setup">
      <ul className="divide-y">
        <Step name="Pi" need={pi} found={pi?.version && `${pi.version} · ${pi.path}`} action={install('pi', pi)}>
          {pi?.shell && <><p className="mt-0.5 text-muted-foreground">The app installed this Pi into its own folder. To use it in a terminal too, add this line to your shell's profile:</p><Copy text={pi.shell} /></>}
          {progress('pi')}
        </Step>
        <Step name="pi-optchat" need={optchat} found={optchat?.version && `${optchat.version} · ${optchat.path}`} action={install('optchat', optchat)}>
          {progress('optchat')}
        </Step>
        <Step name="A model" need={login} found={login?.providers.length ? `logged in: ${login.providers.join(', ')}` : undefined}>
          {login?.terminal && login.state === 'missing' && <SignIn signingIn={state.signingIn} />}
        </Step>
        <Step name="A profile" need={state.profiles.length ? { state: 'ok' } : { state: 'missing', message: 'A profile is one chat that never ends. Name your first: lowercase letters, digits, hyphens and underscores.' }}
          found={state.profiles.length ? state.profiles.join(', ') : undefined}>
          {!state.profiles.length && <NewProfile />}
        </Step>
      </ul>
      <Button variant="ghost-muted" className="mt-1" disabled={checking || busy} onClick={check}>{checking ? <Spinner /> : <RefreshCwIcon />}Check again</Button>
    </section>
  );
}
