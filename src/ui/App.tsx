import { ChartColumnIcon, CheckIcon, PanelLeftIcon, PanelRightIcon, SettingsIcon, XIcon } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { flushSync } from 'react-dom';
import { canComplete, current } from '../window.ts';
import { busy } from './agents.ts';
import { Composer } from './Composer.tsx';
import { label, useOverlay, useShortcuts } from './keys.ts';
import { MemoryView } from './Memory.tsx';
import { NO_TREE } from './memory.ts';
import { Outside } from './Outside.tsx';
import { Panel, type Shown } from './Panel.tsx';
import { ProfileName, Tabs } from './Profiles.tsx';
import { Settings, Welcome } from './Settings.tsx';
import { missing } from './Setup.tsx';
import { Sidebar } from './Sidebar.tsx';
import { app, mainOf, title, UNTITLED, useApp, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { chat, idle, logged, spoken } from './transcript.ts';
import { Button, Choice, cn, useMedia } from './ui.tsx';
import { UsagePage } from './Usage.tsx';

/** A window that has not run yet. */
const NOTHING = idle();
const SHOWS = [['Chat', false], ['Memory', true]] as const;

/** One profile: its windows on the left, the selected window's chat, and beside the main chat its agents or what it named on
 * GitHub, when they are opened. */
function Profile({ state, profile, onSettings, onUsage }: { state: State; profile: string; onSettings: () => void; onUsage: () => void }) {
  // The sidebar stands beside the chat in a wide window. In a narrow one it lies over the chat and is opened for one pick: a
  // window picked, a new one, Esc and a press beside it close it (`useOverlay`), and it is closed again whenever the window
  // is narrow anew. Its top row is then not what the desktop app's window is dragged by: Electron goes by the order in the
  // page, not by what is on top, and the sidebar's buttons would drag instead of being pressed.
  const wide = useMedia('(min-width: 48rem)'), [beside, setBeside] = useState(true), [over, setOver] = useState(false);
  const sidebar = wide ? beside : over, covered = sidebar && !wide, toggle = () => (wide ? setBeside : setOver)(shown => !shown);
  const drawer = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (wide) setOver(false); }, [wide]);
  useOverlay(covered, () => setOver(false), drawer, opener);
  // What the panel beside the main chat shows, while it is open: `panel.agent` is the agent whose chat is open in it.
  const [panel, setPanel] = useState<Shown>(), openAgent = useCallback((agent?: string) => setPanel({ agent }), []);
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
  const name = window && title(window, state), composer = useRef<ComponentRef<typeof Composer>>(null);
  // ⌘F searches the memory from the chat too: the view is on the page before the keys go to its search box. Not from the panel,
  // whose keys are its own: as a sheet it lies over the view, and the box under it cannot take them.
  const box = useRef<HTMLInputElement>(null), search = () => { setOver(false); flushSync(() => setMemory(true)); box.current?.focus(); box.current?.select(); };
  useShortcuts((): Record<string, () => void> => own ? {} : { 'mod+f': search }, [own], 'chat', 'memory');
  useShortcuts(() => ({
    'mod+shift+o': () => { setOver(false); void app.newWindow(profile); },
    'mod+b': toggle,
    ...!own && { 'alt+m': () => setMemory(shown => !shown) },
    ...Object.fromEntries(ids.split(' ').slice(0, 9).map((id, index) => [`alt+${index + 1}`, () => { setOver(false); app.select(id); }])),
  }), [profile, ids, own, wide]);
  // What of the main chat says its agents changed: its Pi started or stopped, an agent was started or ended, a report came.
  const pulse = [window?.status, live.status.optchat, live.messages.length, log?.total].join(' ');
  // What says a turn of it began or ended, for what reads the whole log: that is too much to do at every message.
  const turn = [window?.status, log?.total, state.connection].join(' ');
  // A Pi that has stopped counts nothing: its last status line still stands, and is about agents that went with it.
  const agentsWork = busy(window?.status === 'stopped' ? undefined : live.status.optchat, panel && state.agents[profile]?.agents);
  if (!window) return <p className="m-auto text-muted-foreground text-sm">Opening {profile}…</p>;
  const more = !own && log && log.entries.length > 0 && log.entries[0].i > 0;
  // Nothing has been said here, as far as is known: a window that may have a conversation waits for it rather than say so.
  const fresh = items.length === 0 && (own ? window.status === 'stopped' || session !== undefined : log !== undefined);
  return (
    <div className="flex min-h-0 flex-1">
      {sidebar && <div ref={drawer} className="max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl"><Sidebar state={state} profile={profile} selected={window.id} onPick={() => setOver(false)} /></div>}
      {sidebar && <button type="button" aria-label="Close the sidebar" onClick={() => setOver(false)} className="fixed inset-0 z-30 bg-black/20 md:hidden dark:bg-black/60" />}
      {/* The keys in this column are the chat's, or the memory view's while that stands in its place (keys.ts): its top row
          too, where the focus is right after the memory view is chosen. */}
      <main data-keys={memory ? 'memory' : 'chat'} className="flex min-w-0 flex-1 flex-col bg-background">
        <header className={cn('flex h-(--topbar-height) shrink-0 items-center gap-2 px-3 sm:px-5', !covered && 'window-bar', sidebar ? 'max-md:window-start' : 'window-start')}>
          <Button ref={opener} variant="ghost-muted" size="icon-sm" aria-label="Toggle the sidebar" aria-pressed={sidebar} onClick={toggle}><PanelLeftIcon /></Button>
          {state.tabs.length === 1 && <><ProfileName state={state} profile={profile} /><span aria-hidden="true" className="-ms-1.5 text-muted-foreground/50 text-sm">/</span></>}
          <h1 className={cn('min-w-0 truncate font-medium text-sm', name === UNTITLED && 'text-muted-foreground')}>{name}</h1>
          {own && <span className="shrink-0 rounded-full border px-2 py-0.5 text-2xs text-muted-foreground">{window.completed ? 'Completed' : 'Connected window'}</span>}
          <span className="flex-1" />
          {!own && (
            <Choice label="What the page shows" name={`shows-${profile}`} title={`Chat or memory view (${label('alt+m')})`} options={SHOWS} value={memory} onChange={setMemory} />
          )}
          {canComplete(window) && <Button variant="outline" title="Complete: hand this conversation to the main chat" onClick={() => void app.complete(window.id)}><CheckIcon />Complete</Button>}
          {!own && (
            <Button variant="ghost-muted" size="icon-sm" aria-label="Agents and GitHub" title={agentsWork ? 'Agents and GitHub: agents are working' : 'Agents and GitHub'} aria-pressed={panel !== undefined}
              className="aria-pressed:bg-accent aria-pressed:text-foreground" onClick={() => setPanel(panel ? undefined : {})}>
              <PanelRightIcon />{agentsWork && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-500 dark:bg-sky-300/80" />}
            </Button>
          )}
          <Button variant="ghost-muted" size="icon-sm" aria-label="Usage" title="Usage: what this profile cost" onClick={onUsage}><ChartColumnIcon /></Button>
          <Button variant="ghost-muted" size="icon-sm" aria-label="Settings" title="Settings" onClick={onSettings}><SettingsIcon /></Button>
        </header>
        <Fragment key={window.id}>
          {/* An empty window says what it is, with the composer under it in the middle of the page, as T3 Code's new thread does. */}
          {memory ? <MemoryView tree={state.memory[profile] ?? NO_TREE} profile={profile} window={window} pulse={turn} box={box} /> : fresh ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-end gap-2 px-6 pb-7 text-center">
              <h2 className="max-w-full truncate font-normal text-2xl tracking-tight sm:text-3xl">{!own ? profile : window.completed ? 'Completed' : 'New connected window'}</h2>
              <p className="max-w-xl text-balance text-muted-foreground text-sm">
                {!own ? 'One chat that remembers everything.' : window.completed ? 'The main chat has this conversation. Your next message starts a new one.' : 'Its own conversation, with this profile\'s memory. Complete hands it to the main chat.'}
              </p>
            </div>
          ) : <Timeline items={items} live={live} running={window.status === 'running'} profile={profile} loading={log?.loading} older={more ? () => void app.older(profile) : undefined} onAgent={own ? undefined : openAgent} onQuote={window.outside ? undefined : said => composer.current?.quote(said)} />}
          {window.outside ? <Outside window={window} outside={window.outside} models={state.models[window.id]} /> : <Composer ref={composer} state={state} window={window} live={live} chat={items} onSend={toChat} />}
          {fresh && !memory && <div className="flex-[1.6]" />}
        </Fragment>
      </main>
      {panel && !own && <Panel state={state} profile={profile} shown={panel} pulse={pulse} turn={turn} outside={window.outside !== undefined} onShow={setPanel} />}
    </div>
  );
}
export function App() {
  // The page in the chat's place, if one is: the settings, or what the profile in front used.
  const state = useApp(), [page, setPage] = useState<'settings' | 'usage'>(), settings = page === 'settings', needs = missing(state);
  // Such a page is in place of the chat, so Esc there closes it: a run is stopped from the chat, where it can be seen.
  useShortcuts(() => ({ 'mod+,': () => setPage(page => page === 'settings' ? undefined : 'settings'), ...page && { escape: () => setPage(undefined) } }), [page]);
  return (
    <div className="flex h-dvh flex-col">
      {state.tabs.length > 1 && <Tabs state={state} />}
      {/* What the app has to tell you (`notice`). The desktop app has them at the foot: its window's buttons are in the top row. */}
      {state.connection === 'lost' && <p role="status" className="notice shrink-0 bg-warning-surface px-4 py-1.5 text-center text-warning-foreground text-xs">The server is not answering. Trying again…</p>}
      {state.error && (
        <p role="alert" className="notice flex shrink-0 items-center justify-center gap-2 bg-error-surface px-4 py-1.5 text-error-foreground text-xs">
          <span className="min-w-0 truncate">{state.error}</span><button type="button" aria-label="Dismiss" onClick={() => app.dismiss()} className="rounded-sm p-0.5 hover:bg-foreground/10"><XIcon className="size-3" /></button>
        </p>
      )}
      {needs && !settings && state.profile && (
        <p role="status" className="notice flex shrink-0 items-center justify-center gap-2 bg-warning-surface px-4 py-1.5 text-warning-foreground text-xs">
          {needs}.<button type="button" onClick={() => setPage('settings')} className="rounded-sm font-medium underline underline-offset-2">Set up</button>
        </p>
      )}
      {settings ? <Settings state={state} onClose={() => setPage(undefined)} />
        : page && state.profile ? <UsagePage key={state.profile} state={state} profile={state.profile} onClose={() => setPage(undefined)} />
        : state.profile ? <Profile key={state.profile} state={state} profile={state.profile} onSettings={() => setPage('settings')} onUsage={() => setPage('usage')} />
        : state.connection === 'connecting' ? <p className="m-auto text-muted-foreground text-sm">Connecting…</p>
        : <Welcome state={state} />}
    </div>
  );
}
