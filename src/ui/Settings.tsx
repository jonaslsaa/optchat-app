import { XIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Settings as Kept } from '../protocol.ts';
import { Config, Instructions } from './Config.tsx';
import { Setup } from './Setup.tsx';
import { app, mainOf, type State } from './store.ts';
import { Button, cn } from './ui.tsx';

/** The settings page, in place of the chat: how the app looks, where new windows run, the settings and instructions of the
 * profile in front as pi-optchat keeps them (`Config`), and what a chat needs (`Setup`). Before there is a profile the app's
 * own parts are the first page (`Welcome`), with what a chat needs first. */

const THEMES = { system: 'System', light: 'Light', dark: 'Dark' } satisfies Record<Kept['theme'], string>;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-b py-5 last:border-b-0">
      <h2 className="font-medium text-sm">{title}</h2>
      {hint && <p className="mt-0.5 text-muted-foreground text-sm">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Page({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-5 pb-10">
        {/* The heading is in the middle column, 1.25rem in from its edge: it reaches the desktop window's buttons only in a narrow window. */}
        <header className="window-bar window-start flex h-(--topbar-height) items-center gap-2 [--window-start:calc(1.25rem+max(0px,(100vw-42rem)/2))] in-data-shell:sticky in-data-shell:top-0 in-data-shell:z-10 in-data-shell:bg-background"><h1 className="flex-1 font-medium text-sm">{title}</h1>{action}</header>
        {children}
      </div>
    </main>
  );
}
/** Where new windows run: kept when you leave the field or press Enter. A folder the server refuses stays in the field, to be put right. */
function Folder({ kept = '' }: { kept?: string }) {
  const [cwd, setCwd] = useState(kept);
  useEffect(() => setCwd(kept), [kept]);
  const keep = () => { if (cwd.trim() !== kept) void app.saveSettings({ cwd: cwd.trim() || null }); };
  return (
    <input aria-label="Folder for new windows" value={cwd} placeholder="Your home folder" spellCheck={false} onChange={event => setCwd(event.target.value)} onBlur={keep}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); }}
      className="h-8 w-full rounded-[var(--control-radius)] border border-input bg-popover px-2.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32" />
  );
}
/** The app's own settings. Each is kept by itself, so one page's change does not undo another's. */
function Choices({ settings }: { settings: Kept }) {
  return (
    <>
      <Section title="Appearance">
        <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-[var(--control-radius)] border bg-muted/50 p-0.5">
          {/* The browser's own radio buttons, for its arrow keys; only their labels are drawn. */}
          {(Object.keys(THEMES) as Kept['theme'][]).map(theme => (
            <label key={theme} className={cn('flex h-6 items-center rounded-[calc(var(--control-radius)-2px)] px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', settings.theme === theme ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
              <input type="radio" name="theme" className="sr-only" checked={settings.theme === theme} onChange={() => void app.saveSettings({ theme })} />{THEMES[theme]}
            </label>
          ))}
        </div>
      </Section>
      <Section title="New windows" hint="The folder a window's agent works in when the window is opened.">
        <Folder kept={settings.cwd} />
      </Section>
    </>
  );
}
const Needs = ({ state }: { state: State }) => <Section title="Setup" hint="What a chat needs. Pi and pi-optchat do all the work; the app only shows it."><Setup state={state} /></Section>;

export function Settings({ state, onClose }: { state: State; onClose: () => void }) {
  const { profile } = state, config = profile === undefined ? undefined : state.config[profile];
  // Read each time the page is opened: a terminal may have changed them since. The models are those the profile's chat can
  // run on, which its Pi lists while it runs.
  useEffect(() => { if (profile !== undefined) { void app.readConfig(profile); void app.readModels(mainOf(profile)); } }, [profile]);
  return (
    <Page title="Settings" action={<Button variant="ghost-muted" size="icon-sm" aria-label="Close the settings" onClick={onClose}><XIcon /></Button>}>
      {state.settings && <Choices settings={state.settings} />}
      {profile !== undefined && config && (
        <>
          <Section title={`Profile: ${profile}`} hint="pi-optchat's settings for this profile. A change is saved when you leave its field, and a chat that is running picks it up without a restart.">
            <Config key={profile} profile={profile} config={config} models={state.models[mainOf(profile)]?.models ?? []} />
          </Section>
          <Section title="Instructions" hint={`What the agents of ${profile} are told every turn: the profile's AGENTS.md.`}>
            <Instructions key={profile} profile={profile} kept={config.instructions} />
          </Section>
        </>
      )}
      <Needs state={state} />
    </Page>
  );
}
/** The first thing you see, before there is a profile. */
export function Welcome({ state }: { state: State }) {
  return (
    <Page title="Welcome to OptChat">
      <Needs state={state} />
      {state.settings && <Choices settings={state.settings} />}
    </Page>
  );
}
