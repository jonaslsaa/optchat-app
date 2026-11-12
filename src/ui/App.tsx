import { CheckIcon, PanelLeftIcon, XIcon } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { canComplete, current } from '../window.ts';
import { Composer } from './Composer.tsx';
import { useShortcuts } from './keys.ts';
import { ProfileName, Tabs } from './Profiles.tsx';
import { Sidebar } from './Sidebar.tsx';
import { app, mainOf, title, UNTITLED, useApp, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { chat, idle, logged, spoken } from './transcript.ts';
import { Button, cn } from './ui.tsx';

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
  const name = window && title(window, state);
  useShortcuts(() => ({
    'mod+shift+o': () => void app.newWindow(profile),
    'mod+b': () => setSidebar(shown => !shown),
    ...Object.fromEntries(ids.split(' ').slice(0, 9).map((id, index) => [`alt+${index + 1}`, () => app.select(id)])),
  }), [profile, ids]);
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
          {canComplete(window) && <Button variant="outline" title="Complete: hand this conversation to the main chat" onClick={() => void app.complete(window.id)}><CheckIcon />Complete</Button>}
        </header>
        <Fragment key={window.id}>
          {/* An empty window says what it is, with the composer under it in the middle of the page, as T3 Code's new thread does. */}
          {fresh ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-end gap-2 px-6 pb-7 text-center">
              <h2 className="max-w-full truncate font-normal text-2xl tracking-tight sm:text-3xl">{!own ? profile : window.completed ? 'Completed' : 'New connected window'}</h2>
              <p className="max-w-xl text-balance text-muted-foreground text-sm">
                {!own ? 'One chat that remembers everything.' : window.completed ? 'The main chat has this conversation. Your next message starts a new one.' : 'Its own conversation, with this profile\'s memory. Complete hands it to the main chat.'}
              </p>
            </div>
          ) : <Timeline items={items} live={live} running={window.status === 'running'} profile={profile} loading={log?.loading} older={more ? () => void app.older(profile) : undefined} />}
          <Composer window={window} live={live} fresh={fresh} />
          {fresh && <div className="flex-[1.6]" />}
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
