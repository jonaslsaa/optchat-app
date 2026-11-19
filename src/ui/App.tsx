import { ChartColumnIcon, CheckIcon, PanelLeftIcon, PanelRightIcon, SettingsIcon, XIcon } from 'lucide-react';
import { Fragment, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentRef, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { canComplete, current } from '../window.ts';
import { busy, polled } from './agents.ts';
import { AtWork, useAgents } from './Agents.tsx';
import type { Cite, Place } from './cite.ts';
import { Composer } from './Composer.tsx';
import { CutOff, Stale } from './CutOff.tsx';
import type { MenuAction } from '../menu.ts';
import { label, useMenu, useOverlay, useShortcuts } from './keys.ts';
import { InWindow } from './Markdown.tsx';
import { MemoryView } from './Memory.tsx';
import { NO_TREE } from './memory.ts';
import { Outside } from './Outside.tsx';
import { Rename } from './Rename.tsx';
import { BESIDE, Panel, type Shown } from './Panel.tsx';
import { NewProfileDialog, ProfileName, Tabs } from './Profiles.tsx';
import { Settings, Welcome } from './Settings.tsx';
import { missing } from './Setup.tsx';
import { Sidebar } from './Sidebar.tsx';
import { UpdateButton } from './Update.tsx';
import { app, mainOf, title, UNTITLED, useApp, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { chat, idle, logged, spoken } from './transcript.ts';
import { Button, Choice, cn, useMedia } from './ui.tsx';
import { UsagePage } from './Usage.tsx';
import { ImportLine, ImportPage, useImport } from './Import.tsx';
import { underway, type Source } from './imports.ts';

/** A window that has not run yet. */
const NOTHING = idle();
const SHOWS = [['Chat', false], ['Memory', true]] as const;

/** What the desktop app's menu bar asks of a profile's page, which its own shortcuts run too. */
type InProfile = Record<Exclude<MenuAction, Page | 'newProfile'>, () => void>;
/** The pages that stand in the chat's place, each one a thing the menu bar asks for. */
const PAGES = ['settings', 'usage', 'import'] as const satisfies readonly MenuAction[];
type Page = typeof PAGES[number];
const isPage = (action: MenuAction): action is Page => PAGES.some(page => page === action);
/** One profile: its windows on the left, the selected window's chat, and beside the main chat its agents or what it named on
 * GitHub, when they are opened. */
function Profile({ state, profile, onSettings, onUsage, onNewProfile, onImport, ref }: { state: State; profile: string; onSettings: () => void; onUsage: () => void; onNewProfile: () => void; onImport: () => void; ref: Ref<InProfile> }) {
  // The sidebar stands beside the chat in a wide window. In a narrow one it lies over the chat and is opened for one pick: a
  // window picked, a new one, Esc and a press beside it close it (`useOverlay`), and it is closed again whenever the window
  // is narrow anew. Its top row is then not what the desktop app's window is dragged by: Electron goes by the order in the
  // page, not by what is on top, and the sidebar's buttons would drag instead of being pressed.
  const wide = useMedia('(min-width: 48rem)'), [beside, setBeside] = useState(true), [over, setOver] = useState(false);
  const sidebar = wide ? beside : over, covered = sidebar && !wide, toggle = () => (wide ? setBeside : setOver)(shown => !shown);
  const drawer = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null), panelButton = useRef<HTMLButtonElement>(null);
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
  const items = useMemo(() => chat(before, { ...live, messages: run }), [before, run, live.streaming, live.sent]);
  const name = window && title(window, state), composer = useRef<ComponentRef<typeof Composer>>(null), [renaming, setRenaming] = useState(false);
  // What is cited, in the chat or in the memory view, goes into the message under it. A chat that a Pi outside the app has
  // takes no message.
  const cite = window?.outside ? undefined : (cite: Cite) => composer.current?.cite(cite);
  // ⇧⌘F searches the memory, from the chat too: the view is on the page before the keys go to its search box, with `text` in it
  // when the chat's find hands on what it looked for. Not from the panel, whose keys are its own: as a sheet it lies over the
  // view, and the box under it cannot take them. The memory is the main chat's: asked for from a connected window, it is shown there.
  const main = () => { if (own) app.select(mainOf(profile)); };
  const box = useRef<HTMLInputElement>(null), timeline = useRef<ComponentRef<typeof Timeline>>(null);
  const search = (text?: string) => { setOver(false); flushSync(() => { main(); setMemory(true); }); if (text) void app.search(profile, text); box.current?.focus(); box.current?.select(); };
  // ⌘F finds in what is shown: in the chat (`Find`), and in the memory view with its search. A chat with nothing said has nothing to find in.
  const find = () => { if (memory) return search(); setOver(false); timeline.current?.find(); };
  // What a message cites is shown where it is in the memory view.
  const recall = useCallback((at: Place) => { setOver(false); if (own) app.select(mainOf(profile)); setMemory(true); void app.find(profile, at.id, at.n); }, [profile, own]);
  const newWindow = () => { setOver(false); void app.newWindow(profile); }, remember = () => { main(); setMemory(shown => own || !shown); };
  useShortcuts(() => ({ 'mod+f': find, 'mod+shift+f': () => search() }), [profile, own, memory], 'chat', 'memory');
  useShortcuts(() => ({
    'mod+shift+o': newWindow,
    'mod+b': toggle,
    'alt+m': remember,
    ...Object.fromEntries(ids.split(' ').slice(0, 9).map((id, index) => [`alt+${index + 1}`, () => { setOver(false); app.select(id); }])),
  }), [profile, ids, own, wide]);
  // The menu bar runs the same, from wherever the focus is. The panel as a sheet lies over all of it, and is closed first.
  const sheet = !useMedia(BESIDE), under = (run: () => void) => () => { if (sheet) setPanel(undefined); run(); };
  useImperativeHandle(ref, () => ({ newWindow: under(newWindow), sidebar: under(toggle), memory: under(remember), find: under(find), search: under(search) }));
  // What of the main chat says its agents changed: its Pi started or stopped, an agent was started or ended, a report came.
  const pulse = [window?.status, live.status.optchat, live.messages.length, log?.total].join(' ');
  // What says a turn of it began or ended, for what reads the whole log: that is too much to do at every message.
  const turn = [window?.status, log?.total, state.connection].join(' ');
  // A Pi that has stopped counts nothing: its last status line still stands, and is about agents that went with it.
  const agents = state.agents[profile]?.agents, agentsWork = busy(window?.status === 'stopped' ? undefined : live.status.optchat, panel && agents);
  // An import takes the profile's chat: pi-optchat takes no message until it is over. A new session after it is a new log.
  useImport(profile, turn);
  const importing = underway(state.imports[profile]);
  useAgents(profile, { closed: !panel && !own, pulse, busy: agentsWork || polled(agents ?? [], window?.outside !== undefined), connected: state.connection === 'open' });
  if (!window) return <p className="m-auto text-muted-foreground text-sm">Opening {profile}…</p>;
  const more = !own && log && log.entries.length > 0 && log.entries[0].i > 0;
  // Nothing has been said here, as far as is known: a window that may have a conversation waits for it rather than say so.
  const fresh = items.length === 0 && (own ? window.status === 'stopped' || session !== undefined : log !== undefined);
  // A file the chat names is looked for in the folder this window runs in (the panel and the memory view are the main chat's).
  return (
    <InWindow value={window.id}><div className="flex min-h-0 flex-1">
      {sidebar && <div ref={drawer} className="max-md:enter max-md:enter-from-left max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl"><Sidebar state={state} profile={profile} selected={window.id} onPick={() => setOver(false)} /></div>}
      {sidebar && <button type="button" aria-label="Close the sidebar" onClick={() => setOver(false)} className="enter fixed inset-0 z-30 bg-black/20 md:hidden dark:bg-black/60" />}
      {/* The keys in this column are the chat's, or the memory view's while that stands in its place (keys.ts): its top row
          too, where the focus is right after the memory view is chosen. */}
      <main data-keys={memory ? 'memory' : 'chat'} className="flex min-w-0 flex-1 flex-col bg-background">
        <header className={cn('flex h-(--topbar-height) shrink-0 items-center gap-2 px-3 sm:px-5', !covered && 'window-bar', sidebar ? 'max-md:window-start' : 'window-start')}>
          <Button ref={opener} variant="ghost-muted" size="icon-sm" aria-label="Toggle the sidebar" aria-pressed={sidebar} onClick={toggle}><PanelLeftIcon /></Button>
          {/* The update button is at the sidebar's foot. With the sidebar closed it is here, while it has something to say; on a
              narrow page, where the row is full, only while that is for you to act on, and not while the app looks or downloads. */}
          {!sidebar && state.update && state.update.state !== 'idle' && <UpdateButton update={state.update} className={cn('-ms-1', (state.update.state === 'looking' || state.update.state === 'downloading') && 'max-md:hidden')} />}
          {state.tabs.length === 1 && <><ProfileName state={state} profile={profile} onNew={onNewProfile} onImport={onImport} /><span aria-hidden="true" className="-ms-1.5 text-muted-foreground/50 text-sm">/</span></>}
          {/* A connected window's name is renamed with a double-click, as its row in the sidebar is: so in the desktop app it is
              not what drags the window, whose title bar would take the double-click. A box is for the window it was opened on. */}
          {own && renaming ? <Rename key={window.id} window={window.id} name={name ?? ''} done={() => setRenaming(false)} className="h-7 w-64 font-medium" />
            : <h1 onDoubleClick={own ? () => setRenaming(true) : undefined} className={cn('min-w-0 truncate font-medium text-sm', name === UNTITLED && 'text-muted-foreground', own && '[-webkit-app-region:no-drag]')}>{name}</h1>}
          {own && <span className="shrink-0 rounded-full border px-2 py-0.5 text-2xs text-muted-foreground">{window.completed ? 'Completed' : 'Connected window'}</span>}
          <span className="flex-1" />
          {!own && (
            <Choice label="What the page shows" name={`shows-${profile}`} title={`Chat or memory view (${label('alt+m')})`} options={SHOWS} value={memory} onChange={setMemory} />
          )}
          {canComplete(window) && <Button variant="outline" title="Complete: hand this conversation to the main chat" onClick={() => void app.complete(window.id)}><CheckIcon />Complete</Button>}
          {!own && (
            <Button ref={panelButton} variant="ghost-muted" size="icon-sm" aria-label="Agents and GitHub" title={agentsWork ? 'Agents and GitHub: agents are working' : 'Agents and GitHub'} aria-pressed={panel !== undefined}
              className="aria-pressed:bg-accent aria-pressed:text-foreground" onClick={() => setPanel(panel ? undefined : {})}>
              <PanelRightIcon />{agentsWork && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-500 dark:bg-sky-300/80" />}
            </Button>
          )}
          <Button variant="ghost-muted" size="icon-sm" aria-label="Usage" title="Usage: what this profile cost" onClick={onUsage}><ChartColumnIcon /></Button>
          <Button variant="ghost-muted" size="icon-sm" aria-label="Settings" title="Settings" onClick={onSettings}><SettingsIcon /></Button>
        </header>
        <Fragment key={window.id}>
          {/* An empty window says what it is, with the composer under it in the middle of the page, as T3 Code's new thread does. */}
          {memory ? <MemoryView tree={state.memory[profile] ?? NO_TREE} profile={profile} window={window} pulse={turn} box={box} onCite={cite} onImport={onImport} /> : fresh ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-end gap-2 px-6 pb-7 text-center">
              <h2 className="max-w-full truncate font-normal text-2xl tracking-tight sm:text-3xl">{!own ? profile : window.completed ? 'Completed' : 'New connected window'}</h2>
              <p className="max-w-xl text-balance text-muted-foreground text-sm">
                {!own ? <>One chat that remembers everything. <button type="button" onClick={onImport} className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Import your history</button> from Claude Code, Codex, Pi or ChatGPT.</> : window.completed ? 'The main chat has this conversation. Your next message starts a new one.' : 'Its own conversation, with this profile\'s memory. Complete hands it to the main chat.'}
              </p>
            </div>
          ) : <Timeline ref={timeline} items={items} live={live} running={window.status === 'running'} starting={window.status === 'starting'} profile={profile} loading={log?.loading} older={more ? () => void app.older(profile) : undefined} onAgent={own ? undefined : openAgent} onCite={cite} logged={own ? undefined : log?.entries.at(-1)?.i} onPlace={recall} onMemory={search} agents={own ? undefined : agents} />}
          {!own && !panel && agentsWork && agents && (
            // The line goes when the panel opens: the focus goes first to the panel's button, where closing the panel brings it back.
            <AtWork agents={agents} onOpen={() => { panelButton.current?.focus(); setPanel({}); }} />
          )}
          {importing && !own ? <ImportLine status={importing} onShow={onImport} /> : window.outside ? <Outside window={window} outside={window.outside} models={state.models[window.id]} /> : <Composer ref={composer} state={state} window={window} live={live} chat={items} onSend={toChat} />}
          {fresh && !memory && <div className="flex-[1.6]" />}
        </Fragment>
      </main>
      {panel && !own && <Panel state={state} profile={profile} shown={panel} pulse={pulse} turn={turn} outside={window.outside !== undefined} onShow={setPanel} />}
    </div></InWindow>
  );
}
export function App() {
  // The page in the chat's place, if one is: the settings, or what the profile in front used.
  const state = useApp(), [page, setPage] = useState<Page>(), settings = page === 'settings', needs = missing(state);
  // The New Profile dialog, and the sources its second step picked for the Import page.
  const [naming, setNaming] = useState<{ made?: string }>(), name = () => setNaming({}), [from, setFrom] = useState<Source[]>([]);
  const toImport = (sources: Source[] = []) => { setFrom(sources); setPage('import'); };
  const toSettings = () => setPage(page => page === 'settings' ? undefined : 'settings'), chat = useRef<InProfile>(null);
  // The first profile, made on the first page or in the settings: the chat takes their place, and is asked what history it
  // brings once the setup has what a chat needs (before, nothing could be imported).
  const first = (made: string) => { if (needs) return; setPage(undefined); setNaming({ made }); };
  // Such a page is in place of the chat, so Esc there closes it: a run is stopped from the chat, where it can be seen. None
  // is opened under the New Profile dialog, which ends on the new chat.
  useShortcuts(() => naming ? {} : { 'mod+,': toSettings, ...page && { escape: () => setPage(undefined) } }, [page, naming]);
  // The desktop app's menu bar. What it asks of a profile's page is done there, with that page in front, once the profile's
  // chat is there to do it in: the menu may have opened the window to ask. Without a profile there is nothing to do it to:
  // the first page is put in front, with the focus where a profile is named.
  const connecting = state.connection === 'connecting', opening = state.profile !== undefined && !state.windows.some(window => window.profile === state.profile);
  useMenu(action => {
    if (connecting) return false;
    if (naming) return;
    // The menu's Settings… opens them and never closes them, as its key does.
    if (action === 'settings') return setPage('settings');
    // A profile after the first is named in a dialog. The first is named on the first page, as below.
    if (action === 'newProfile' && state.profile) return name();
    if (opening) return false;
    if (action === 'import' && state.profile) return toImport();
    if (isPage(action) && state.profile) return setPage(action);
    flushSync(() => setPage(undefined));
    if (!isPage(action) && action !== 'newProfile' && chat.current) chat.current[action](); else document.querySelector<HTMLElement>('[aria-label="Profile name"]')?.focus();
  }, [connecting, opening, state.profile, naming]);
  return (
    <div className="flex h-dvh flex-col">
      {state.tabs.length > 1 && <Tabs state={state} onNew={name} onImport={() => toImport()} />}
      {/* The new profile is opened in the chat's place: a page that stood there gives way to it. Started empty, the keys go to the new profile's chat, which was opened behind the dialog. */}
      {naming && <NewProfileDialog state={state} made={naming.made} onMade={() => setPage(undefined)} onImport={toImport}
        onClose={made => { setNaming(undefined); if (made) document.querySelector<HTMLElement>('[aria-label="Message"]')?.focus(); }} />}
      {/* What the app has to tell you (`notice`). The desktop app has them at the foot: its window's buttons are in the top row. */}
      {state.connection === 'lost' && <p role="status" className="notice enter shrink-0 bg-warning-surface px-4 py-1.5 text-center text-warning-foreground text-xs">The server is not answering. Trying again…</p>}
      {state.connection === 'refused' && <p role="status" className="notice enter shrink-0 bg-warning-surface px-4 py-1.5 text-center text-warning-foreground text-xs">This page's address has no token, or one from before the server started again. Open the address the server printed.</p>}
      {state.error && (
        <p role="alert" className="notice enter flex shrink-0 items-center justify-center gap-2 bg-error-surface px-4 py-1.5 text-error-foreground text-xs">
          <span className="min-w-0 truncate">{state.error}</span><button type="button" aria-label="Dismiss" onClick={() => app.dismiss()} className="rounded-sm p-0.5 hover:bg-foreground/10"><XIcon className="size-3" /></button>
        </p>
      )}
      <CutOff state={state} />
      <Stale state={state} />
      {needs && !settings && state.profile && (
        <p role="status" className="notice enter flex shrink-0 items-center justify-center gap-2 bg-warning-surface px-4 py-1.5 text-warning-foreground text-xs">
          {needs}.<button type="button" onClick={() => setPage('settings')} className="rounded-sm font-medium underline underline-offset-2">Set up</button>
        </p>
      )}
      {settings ? <Settings state={state} onClose={() => setPage(undefined)} onMade={first} />
        : page === 'import' && state.profile ? <ImportPage key={state.profile} state={state} profile={state.profile} from={from} onClose={() => setPage(undefined)} onChat={() => setPage(undefined)}
          onMemory={() => { flushSync(() => setPage(undefined)); chat.current?.memory(); }} />
        : page && state.profile ? <UsagePage key={state.profile} state={state} profile={state.profile} onClose={() => setPage(undefined)} />
        : state.profile ? <Profile ref={chat} key={state.profile} state={state} profile={state.profile} onSettings={() => setPage('settings')} onUsage={() => setPage('usage')} onNewProfile={name} onImport={() => toImport()} />
        : state.connection === 'connecting' ? <p className="m-auto text-muted-foreground text-sm">Connecting…</p>
        : <Welcome state={state} onMade={first} />}
    </div>
  );
}
