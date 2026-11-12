import { CheckIcon, PanelLeftIcon, XIcon } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { canComplete, current } from '../window.ts';
import { Composer } from './Composer.tsx';
import { useShortcuts } from './keys.ts';
import { ProfileName, Tabs } from './Profiles.tsx';
import { Sidebar } from './Sidebar.tsx';
import { app, mainOf, title, useApp, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { chat, idle, logged, spoken } from './transcript.ts';
import { Button } from './ui.tsx';

/** A window that has not run yet. */
const NOTHING = idle();

/** One profile: its windows on the left, and the selected window's chat. */
function Profile({ state, profile }: { state: State; profile: string }) {
  const [sidebar, setSidebar] = useState(() => innerWidth >= 768);
  const windows = state.windows.filter(window => window.profile === profile), ids = windows.map(window => window.id).join(' ');
  const window = windows.find(w => w.id === state.selected[profile]) ?? windows.find(w => w.id === mainOf(profile));
  const live = (window && state.live[window.id]) ?? NOTHING, log = state.logs[profile], session = window && state.sessions[window.id];
  // The main chat is the profile's log. A connected window's conversation is only in its Pi until it is handed off.
  const own = window?.role === 'connected';
  const since = window?.since, run = useMemo(() => current({ since }, live.messages), [since, live.messages]);
  const before = useMemo(() => own ? spoken(current({ since }, session ?? [])) : logged(log?.entries ?? []), [own, since, session, log?.entries]);
  const items = useMemo(() => chat(before, { ...live, messages: run }), [before, run, live.streaming]);
  useShortcuts(() => ({
    'mod+shift+o': () => void app.newWindow(profile),
    'mod+b': () => setSidebar(shown => !shown),
    ...Object.fromEntries(ids.split(' ').slice(0, 9).map((id, index) => [`alt+${index + 1}`, () => app.select(id)])),
  }), [profile, ids]);
  if (!window) return <p className="m-auto text-muted-foreground text-sm">Opening {profile}…</p>;
  const more = !own && log && log.entries.length > 0 && log.entries[0].i > 0;
  return (
    <div className="flex min-h-0 flex-1">
      {sidebar && <div className="max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl"><Sidebar state={state} profile={profile} selected={window.id} /></div>}
      {sidebar && <button type="button" aria-label="Close the sidebar" onClick={() => setSidebar(false)} className="fixed inset-0 z-30 bg-black/20 md:hidden" />}
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-(--topbar-height) shrink-0 items-center gap-2 px-3 sm:px-5">
          <Button variant="ghost-muted" size="icon-sm" aria-label="Toggle the sidebar" aria-pressed={sidebar} onClick={() => setSidebar(!sidebar)}><PanelLeftIcon /></Button>
          {state.tabs.length === 1 && <ProfileName state={state} profile={profile} />}
          <h1 className="min-w-0 truncate font-medium text-sm">{title(window, state)}</h1>
          {window.role === 'connected' && <span className="shrink-0 rounded-full border px-2 py-0.5 text-2xs text-muted-foreground">{window.completed ? 'Completed' : 'Connected window'}</span>}
          <span className="flex-1" />
          {canComplete(window) && <Button variant="outline" onClick={() => void app.complete(window.id)}><CheckIcon />Complete</Button>}
        </header>
        <Fragment key={window.id}>
          <Timeline items={items} live={live} running={window.status === 'running'} profile={profile} loading={log?.loading} older={more ? () => void app.older(profile) : undefined}
            empty={window.role === 'main' ? 'Send a message to start the conversation.' : window.completed ? 'Completed. The main chat has this conversation; your next message starts a new one.' : 'A connected window: its own conversation, with this profile\'s memory. Complete hands it to the main chat.'} />
          <Composer window={window} live={live} />
        </Fragment>
      </main>
    </div>
  );
}
export function App() {
  const state = useApp();
  return (
    <div className="flex h-dvh flex-col">
      {state.tabs.length > 1 && <Tabs state={state} />}
      {state.connection === 'lost' && <p role="status" className="shrink-0 bg-warning-surface px-4 py-1.5 text-center text-warning-foreground text-xs">The server is not answering. Trying again…</p>}
      {state.error && (
        <p role="alert" className="flex shrink-0 items-center justify-center gap-2 bg-error-surface px-4 py-1.5 text-error-foreground text-xs">
          <span className="min-w-0 truncate">{state.error}</span><button type="button" aria-label="Dismiss" onClick={() => app.dismiss()} className="rounded-sm p-0.5 hover:bg-foreground/10"><XIcon className="size-3" /></button>
        </p>
      )}
      {state.profile ? <Profile key={state.profile} state={state} profile={state.profile} />
        : state.connection === 'connecting' ? <p className="m-auto text-muted-foreground text-sm">Connecting…</p>
        : <div className="m-auto max-w-sm text-center text-sm"><p className="font-medium">No profiles yet</p><p className="mt-1 text-muted-foreground">A profile is one chat that never ends. Create the first one in a terminal with <code className="rounded bg-foreground/10 px-1 py-0.5 text-[0.85em]">pi --optchat-profile work</code>, then reload.</p></div>}
    </div>
  );
}
