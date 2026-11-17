import { FileTextIcon, Settings2Icon, UserRoundIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Settings as Kept } from '../protocol.ts';
import { Config, Instructions } from './Config.tsx';
import { missing, Setup } from './Setup.tsx';
import { app, mainOf, type State } from './store.ts';
import { Button, cn, Switch } from './ui.tsx';

/** The settings page, in place of the chat, in tabs: how the app looks, where new windows run and what a chat needs (`Setup`);
 * the settings of the profile in front as pi-optchat keeps them (`Config`); and its instructions. Before there is a profile the app's
 * own parts are the first page (`Welcome`), with what a chat needs first. */

const THEMES = { system: 'System', light: 'Light', dark: 'Dark' } satisfies Record<Kept['theme'], string>;

export function Section({ title, hint, className, children }: { title: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn('border-b py-5 last:border-b-0', className)}>
      <h2 className="font-medium text-sm">{title}</h2>
      {hint && <p className="mt-0.5 text-muted-foreground text-sm">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
export function Page({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="enter mx-auto max-w-2xl px-5 pb-10">
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
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) keep(); }}
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
      {/* Only the desktop app can keep the Mac awake: in a browser there is nothing to turn on. */}
      <Section title="While agents work" className="hidden in-data-shell:block">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span>Keep the Mac awake<span className="block text-muted-foreground">It does not fall asleep by itself under a long job. The screen may still turn off, and closing the lid still puts it to sleep.</span></span>
          <Switch label="Keep the Mac awake while agents work" checked={settings.awake} onChange={awake => void app.saveSettings({ awake })} />
        </div>
      </Section>
      <Section title="New windows" hint="The folder a window's agent works in when the window is opened.">
        <Folder kept={settings.cwd} />
      </Section>
    </>
  );
}
const Needs = ({ state, onMade }: { state: State; onMade?: (profile: string) => void }) => <Section title="Setup" hint="What a chat needs. Pi and pi-optchat do all the work; the app only shows it."><Setup state={state} onMade={onMade} /></Section>;

/** The page's tabs, each with its icon as in T3 Code's settings: what is the app's, and what is the profile's in front. */
const TABS = { general: ['General', Settings2Icon], profile: ['Profile', UserRoundIcon], instructions: ['Instructions', FileTextIcon] } as const;
type Tab = keyof typeof TABS;
/** The tab last chosen: the page opens on it again while the app runs. */
let chosen: Tab = 'general';
const ORDER = Object.keys(TABS) as Tab[];

export function Settings({ state, onClose }: { state: State; onClose: () => void }) {
  const { profile } = state, config = profile === undefined ? undefined : state.config[profile], id = useId();
  // It opens on what a chat still needs, if it needs something. With no profile there is only what is the app's, and no tabs.
  const [picked, setPicked] = useState(missing(state) ? 'general' : chosen), tabbed = profile !== undefined, tab = tabbed ? picked : 'general';
  // Read each time the page is opened: a terminal may have changed them since. The models are those the profile's chat can
  // run on, which its Pi lists while it runs.
  useEffect(() => { if (profile !== undefined) { void app.readConfig(profile); void app.readModels(mainOf(profile)); } }, [profile]);
  const pick = (next: Tab) => { chosen = next; setPicked(next); };
  // The arrows go from tab to tab, round, and Home and End to the first and the last, as a tab list's do; the tab gone to is
  // shown at once.
  const arrow = (event: KeyboardEvent) => {
    const at = ORDER.indexOf(tab), to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: -1 }[event.key], next = to === undefined ? undefined : ORDER.at(to % ORDER.length);
    if (!next) return;
    event.preventDefault();
    pick(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  const pages: Record<Tab, ReactNode> = {
    general: <>{state.settings && <Choices settings={state.settings} />}<Needs state={state} /></>,
    profile: profile !== undefined && config && (
      <Section title={`Profile: ${profile}`} hint="pi-optchat's settings for this profile. A change is saved when you leave its field, and a chat that is running picks it up without a restart.">
        <Config key={profile} profile={profile} config={config} models={state.models[mainOf(profile)]?.models ?? []} />
      </Section>
    ),
    instructions: profile !== undefined && config && (
      <Section title="Instructions" hint={`What the agents of ${profile} are told every turn: the profile's AGENTS.md.`}>
        <Instructions key={profile} profile={profile} kept={config.instructions} />
      </Section>
    ),
  };
  return (
    <Page title="Settings" action={<Button variant="ghost-muted" size="icon-sm" aria-label="Close the settings" onClick={onClose}><XIcon /></Button>}>
      {tabbed && (
        <div role="tablist" aria-label="Settings" onKeyDown={arrow} className="flex gap-1 border-b pb-3">
          {ORDER.map(name => {
            const [title, Icon] = TABS[name];
            return (
              <button key={name} id={`${id}-${name}`} type="button" role="tab" aria-selected={name === tab} aria-controls={`${id}-${name}-panel`} tabIndex={name === tab ? 0 : -1} onClick={() => pick(name)}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-2.5 font-medium text-muted-foreground text-sm outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-accent aria-selected:text-foreground [&>svg]:size-4">
                <Icon />{title}
              </button>
            );
          })}
        </div>
      )}
      {/* Every tab's page stays, hidden when it is not shown: what was typed in one, and not saved yet, is there on the way back. */}
      {ORDER.map(name => (
        <div key={name} id={`${id}-${name}-panel`} role={tabbed ? 'tabpanel' : undefined} aria-labelledby={tabbed ? `${id}-${name}` : undefined} hidden={name !== tab}>{pages[name]}</div>
      ))}
    </Page>
  );
}
/** The first thing you see, before there is a profile. */
/** The first page, until there is a profile. `onMade`: the first one is there, and is asked next what history it brings. */
export function Welcome({ state, onMade }: { state: State; onMade: (profile: string) => void }) {
  return (
    <Page title="Welcome to OptChat">
      <Needs state={state} onMade={onMade} />
      {state.settings && <Choices settings={state.settings} />}
    </Page>
  );
}
