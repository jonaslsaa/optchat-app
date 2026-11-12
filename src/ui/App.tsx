import { BotIcon, CheckIcon, PanelLeftIcon, SettingsIcon, XIcon } from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { canComplete, current } from '../window.ts';
import { AgentsPanel } from './Agents.tsx';
import { busy } from './agents.ts';
import { Composer } from './Composer.tsx';
import { label, useShortcuts } from './keys.ts';
import { MemoryView } from './Memory.tsx';
import { NO_TREE } from './memory.ts';
import { Outside } from './Outside.tsx';
import { ProfileName, Tabs } from './Profiles.tsx';
import { Settings, Welcome } from './Settings.tsx';
import { missing } from './Setup.tsx';
import { Sidebar } from './Sidebar.tsx';
import { app, mainOf, title, UNTITLED, useApp, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { chat, idle, logged, spoken } from './transcript.ts';
import { Button, cn } from './ui.tsx';

/** A window that has not run yet. */
const NOTHING = idle();

/** One profile: its windows on the left, the selected window's chat, and beside the main chat its agents, when they are opened. */
function Profile({ state, profile, onSettings }: { state: State; profile: string; onSettings: () => void }) {
  const [sidebar, setSidebar] = useState(() => innerWidth >= 768);
  // The agents are the main chat's: `panel.agent` is the one whose chat is open in the panel.
  const [panel, setPanel] = useState<{ agent?: string }>(), openAgent = useCallback((agent?: string) => setPanel({ agent }), []);
  // The main chat as the agent reads its memory, in the chat's place. A message sent from there is answered in the chat.
  const [remembering, setMemory] = useState(false), toChat = useCallback(() => setMemory(false), []);
  const windows = state.windows.filter(window => window.profile === profile), ids = windows.map(window => window.id).join(' ');
  const window = windows.find(w => w.id === state.selected[profile]) ?? windows.find(w => w.id === mainOf(profile));
  const live = (window && state.live[window.id]) ?? NOTHING, log = state.logs[profile], session = window && state.sessions[window.id];
  // The main chat is the profile's log. A connected window's conversation is only in its Pi until it is handed off.
  const own = window?.role === 'connected', memory = remembering && !own;
  const since = window?.since, run = useMemo(() => current({ since }, live.messages), [since, live.messages]);
  const before = useMemo(() => own ? spoken(current({ since }, session ?? [])) : logged(log?.entries ?? []), [own, since, session, log?.entries]);
  const items = useMemo(() => chat(before, { ...live, messages: run }), [before, run, live.streaming]);
  const name = window && title(window, state);
  useShortcuts(() => ({
    'mod+shift+o': () => void app.newWindow(profile),
    'mod+b': () => setSidebar(shown => !shown),
    ...!own && { 'alt+m': () => setMemory(shown => !shown) },
    ...Object.fromEntries(ids.split(' ').slice(0, 9).map((id, index) => [`alt+${index + 1}`, () => app.select(id)])),
  }), [profile, ids, own]);
  // What of the main chat says its agents changed: its Pi started or stopped, an agent was started or ended, a report came.
  const pulse = [window?.status, live.status.optchat, live.messages.length, log?.total].join(' ');
  // A Pi that has stopped counts nothing: its last status line still stands, and is about agents that went with it.
  const agentsWork = busy(window?.status === 'stopped' ? undefined : live.status.optchat, panel && state.agents[profile]?.agents);
  if (!window) return <p className="m-auto text-muted-foreground text-sm">Opening {profile}…</p>;
  const more = !own && log && log.entries.length > 0 && log.entries[0].i > 0;
  // Nothing has been said here, as far as is known: a window that may have a conversation waits for it rather than say so.
  const fresh = items.length === 0 && (own ? window.status === 'stopped' || session !== undefined : log !== undefined);
  return (
    <div className="flex min-h-0 flex-1">
      {sidebar && <div className="max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl"><Sidebar state={state} profile={profile} selected={window.id} /></div>}
      {sidebar && <button type="button" aria-label="Close the sidebar" onClick={() => setSidebar(false)} className="fixed inset-0 z-30 bg-black/20 md:hidden" />}
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-(--topbar-height) shrink-0 items-center gap-2 px-3 sm:px-5">
          <Button variant="ghost-muted" size="icon-sm" aria-label="Toggle the sidebar" aria-pressed={sidebar} onClick={() => setSidebar(!sidebar)}><PanelLeftIcon /></Button>
          {state.tabs.length === 1 && <><ProfileName state={state} profile={profile} /><span aria-hidden="true" className="-ms-1.5 text-muted-foreground/50 text-sm">/</span></>}
          <h1 className={cn('min-w-0 truncate font-medium text-sm', name === UNTITLED && 'text-muted-foreground')}>{name}</h1>
          {own && <span className="shrink-0 rounded-full border px-2 py-0.5 text-2xs text-muted-foreground">{window.completed ? 'Completed' : 'Connected window'}</span>}
          <span className="flex-1" />
          {!own && (
            <div role="radiogroup" aria-label="What the page shows" title={`Chat or memory view (${label('alt+m')})`} className="flex shrink-0 rounded-[var(--control-radius)] border bg-muted/50 p-0.5">
              {/* The browser's own radio buttons, for its arrow keys; only their labels are drawn. */}
              {([['Chat', false], ['Memory', true]] as const).map(([name, on]) => (
                <label key={name} className={cn('flex h-5.5 items-center rounded-[calc(var(--control-radius)-2px)] px-2 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', memory === on ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
                  <input type="radio" name={`shows-${profile}`} className="sr-only" checked={memory === on} onChange={() => setMemory(on)} />{name}
                </label>
              ))}
            </div>
          )}
          {canComplete(window) && <Button variant="outline" title="Complete: hand this conversation to the main chat" onClick={() => void app.complete(window.id)}><CheckIcon />Complete</Button>}
          {!own && (
            <Button variant="ghost-muted" size="icon-sm" aria-label="Agents" title={agentsWork ? 'Agents: some are working' : 'Agents'} aria-pressed={panel !== undefined} onClick={() => setPanel(panel ? undefined : {})}>
              <BotIcon />{agentsWork && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-500 dark:bg-sky-300/80" />}
            </Button>
          )}
          <Button variant="ghost-muted" size="icon-sm" aria-label="Settings" title="Settings" onClick={onSettings}><SettingsIcon /></Button>
        </header>
        <Fragment key={window.id}>
          {/* An empty window says what it is, with the composer under it in the middle of the page, as T3 Code's new thread does. */}
          {memory ? <MemoryView tree={state.memory[profile] ?? NO_TREE} profile={profile} window={window} pulse={`${window.status} ${log?.total} ${state.connection}`} /> : fresh ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-end gap-2 px-6 pb-7 text-center">
              <h2 className="max-w-full truncate font-normal text-2xl tracking-tight sm:text-3xl">{!own ? profile : window.completed ? 'Completed' : 'New connected window'}</h2>
              <p className="max-w-xl text-balance text-muted-foreground text-sm">
                {!own ? 'One chat that remembers everything.' : window.completed ? 'The main chat has this conversation. Your next message starts a new one.' : 'Its own conversation, with this profile\'s memory. Complete hands it to the main chat.'}
              </p>
            </div>
          ) : <Timeline items={items} live={live} running={window.status === 'running'} profile={profile} loading={log?.loading} older={more ? () => void app.older(profile) : undefined} onAgent={own ? undefined : openAgent} />}
          {window.outside ? <Outside window={window} outside={window.outside} /> : <Composer window={window} live={live} onSend={toChat} />}
          {fresh && !memory && <div className="flex-[1.6]" />}
        </Fragment>
      </main>
      {panel && !own && <AgentsPanel state={state} profile={profile} agent={panel.agent} pulse={pulse} outside={window.outside !== undefined} onAgent={openAgent} onClose={() => setPanel(undefined)} />}
    </div>
  );
}
export function App() {
  const state = useApp(), [settings, setSettings] = useState(false), needs = missing(state);
  // The settings are in place of the chat, so Esc there closes them: a run is stopped from where it can be seen.
  useShortcuts(() => ({ 'mod+,': () => setSettings(open => !open), ...settings && { escape: () => setSettings(false) } }), [settings]);
  return (
    <div className="flex h-dvh flex-col">
      {state.tabs.length > 1 && <Tabs state={state} />}
      {state.connection === 'lost' && <p role="status" className="shrink-0 bg-warning-surface px-4 py-1.5 text-center text-warning-foreground text-xs">The server is not answering. Trying again…</p>}
      {state.error && (
        <p role="alert" className="flex shrink-0 items-center justify-center gap-2 bg-error-surface px-4 py-1.5 text-error-foreground text-xs">
          <span className="min-w-0 truncate">{state.error}</span><button type="button" aria-label="Dismiss" onClick={() => app.dismiss()} className="rounded-sm p-0.5 hover:bg-foreground/10"><XIcon className="size-3" /></button>
        </p>
      )}
      {needs && !settings && state.profile && (
        <p role="status" className="flex shrink-0 items-center justify-center gap-2 bg-warning-surface px-4 py-1.5 text-warning-foreground text-xs">
          {needs}.<button type="button" onClick={() => setSettings(true)} className="rounded-sm font-medium underline underline-offset-2">Set up</button>
        </p>
      )}
      {settings ? <Settings state={state} onClose={() => setSettings(false)} />
        : state.profile ? <Profile key={state.profile} state={state} profile={state.profile} onSettings={() => setSettings(true)} />
        : state.connection === 'connecting' ? <p className="m-auto text-muted-foreground text-sm">Connecting…</p>
        : <Welcome state={state} />}
    </div>
  );
}
