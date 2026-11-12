import { useSyncExternalStore } from 'react';
import { connect, type Client } from '../client.ts';
import type { Message, Method, Params, Push, Result, WindowState } from '../protocol.ts';
import { current } from '../window.ts';
import { apply, idle, isMessage, isObject, merged, replay, stopped, without, words, type Live, type PiMessage } from './transcript.ts';

/** Everything the page knows, kept outside React: the connection to the server, and what it said. Components read it with
 * `useApp` and change it through `app`'s methods. */
export interface State {
  connection: 'connecting' | 'open' | 'lost';
  /** The profiles on disk, the ones open as tabs, and the one in front. */
  profiles: string[];
  tabs: string[];
  profile?: string;
  /** Every window, a profile's main chat before its connected windows, those in the order they were opened. */
  windows: WindowState[];
  /** The window shown for each profile. */
  selected: Record<string, string>;
  /** Each open profile's log, as far back as it has been read. */
  logs: Record<string, { total: number; entries: Message[]; loading?: boolean }>;
  /** Each window's latest run and what its Pi shows. */
  live: Record<string, Live>;
  /** A connected window's conversation, which only its Pi has. */
  sessions: Record<string, PiMessage[]>;
  /** Why the last thing you asked for failed. */
  error?: string;
}
const PAGE = 200, SAVED = 'optchat-app';
export const mainOf = (profile: string) => `${profile}/main`;
const ordered = (windows: WindowState[]) => windows.toSorted((a, b) => a.profile.localeCompare(b.profile) || Number(b.role === 'main') - Number(a.role === 'main') || a.id.localeCompare(b.id, undefined, { numeric: true }));
/** What a window is called: the main chat, or a connected window by the first message of the conversation it is in. */
export function title(window: WindowState, state: State) {
  if (window.role === 'main') return 'Main chat';
  const first = current(window, [...state.sessions[window.id] ?? [], ...state.live[window.id]?.messages ?? []]).find(message => message.role === 'user');
  return first ? words(first.content).split('\n')[0] : 'New window';
}

export class App {
  state: State = { connection: 'connecting', profiles: [], tabs: [], windows: [], selected: {}, logs: {}, live: {}, sessions: {} };
  private client?: Client;
  private retrying?: ReturnType<typeof setTimeout>;
  private closed = false;
  private readonly listeners = new Set<() => void>();
  private readonly loading = new Set<string>();
  private readonly deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  private readonly retry: number;

  /** `storage` keeps which profiles are open across reloads; `retry` is how long to wait before connecting again. */
  constructor({ storage = () => localStorage, retry = 1000 }: { storage?: () => Pick<Storage, 'getItem' | 'setItem'>; retry?: number } = {}) {
    this.storage = storage;
    this.retry = retry;
  }
  /** Connects, and again a while after the connection is lost: windows live in the server, so nothing is lost with it. A socket
   * that never opened closes too, so its closing is the one place that tries again, with one timer. */
  async start(url: string) {
    const lost = () => {
      this.client = undefined;
      this.set({ connection: 'lost' });
      if (!this.closed) this.retrying ??= setTimeout(() => { this.retrying = undefined; void this.start(url); }, this.retry);
    };
    try {
      this.client = await connect(url, push => this.receive(push), lost);
      await this.sync();
    } catch (error) {
      if (this.client) this.set({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** Leaves the server, for good. */
  close() {
    this.closed = true;
    clearTimeout(this.retrying);
    for (const deadline of this.deadlines.values()) clearTimeout(deadline);
    this.client?.close();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<State>) {
    const before = this.state;
    this.state = { ...before, ...patch };
    const { tabs, profile, selected } = this.state;
    if (tabs !== before.tabs || profile !== before.profile || selected !== before.selected) this.storage().setItem(SAVED, JSON.stringify({ tabs, profile, selected }));
    for (const listener of this.listeners) listener();
  }
  /** A request to the server; one that fails is shown, not thrown. */
  private async ask<M extends Method>(method: M, params: Params<M>): Promise<Result<M> | undefined> {
    try {
      if (!this.client) throw new Error('Not connected to the server.');
      return await this.client.request(method, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A window that failed to start says so itself, above its composer.
      if (!this.state.windows.some(window => window.error === message)) this.set({ error: message });
    }
  }
  private async sync() {
    const [profiles, windows] = await Promise.all([this.client!.request('profiles', {}), this.client!.request('windows', {})]);
    const names = profiles.profiles.map(p => p.name), saved: unknown = JSON.parse(this.storage().getItem(SAVED) ?? '{}');
    const before = isObject(saved) && Array.isArray(saved.tabs) ? saved.tabs.filter((tab): tab is string => names.includes(tab)) : [];
    const tabs = before.length ? before : names.slice(0, 1);
    const profile = isObject(saved) && typeof saved.profile === 'string' && tabs.includes(saved.profile) ? saved.profile : tabs[0];
    const selected = isObject(saved) && isObject(saved.selected) ? Object.fromEntries(Object.entries(saved.selected).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
    // A server that started again numbers its windows' records from one: what was kept of a window it does not have is let go.
    const kept = <T>(by: Record<string, T>) => Object.fromEntries(Object.entries(by).filter(([id]) => windows.windows.some(window => window.id === id)));
    this.set({ connection: 'open', profiles: names, tabs, profile, selected, windows: ordered(windows.windows), live: kept(this.state.live), sessions: kept(this.state.sessions), error: undefined });
    await Promise.all([...tabs.map(tab => this.opened(tab)), ...windows.windows.map(async window => { await this.replayed(window.id); await this.session(window.id); })]);
  }
  /** A profile's tab needs its main window to exist, and the end of its log. */
  private async opened(profile: string) {
    // The server tells of a window only when it changes: one that another page opened first is known from this answer.
    await Promise.all([this.ask('open', { profile }).then(opened => { if (opened) this.put(opened.window); }), this.read(profile)]);
  }
  /** A window as the server has it now; a closed one is gone, and the profile shows its main chat instead. */
  private put(window: WindowState) {
    const others = this.state.windows.filter(w => w.id !== window.id), gone = window.status === 'closed';
    const selected = gone && this.state.selected[window.profile] === window.id ? { ...this.state.selected, [window.profile]: mainOf(window.profile) } : this.state.selected;
    if (!gone) { this.set({ windows: ordered([...others, window]), selected }); return; }
    // What a closed window said and asked goes with it.
    const { [window.id]: _run, ...live } = this.state.live, { [window.id]: _conversation, ...sessions } = this.state.sessions;
    for (const [key, deadline] of this.deadlines) if (key.startsWith(`${window.id} `)) { clearTimeout(deadline); this.deadlines.delete(key); }
    this.set({ windows: others, selected, live, sessions });
  }
  /** Reads a page of a profile's log into what is read of it already: the newest page, or the one before entry `before`. */
  private async read(profile: string, before?: number) {
    const page = await this.ask('history', { profile, limit: PAGE, ...before !== undefined && { before } });
    if (page) this.set({ logs: { ...this.state.logs, [profile]: { ...this.state.logs[profile], total: page.total, entries: merged(this.state.logs[profile]?.entries ?? [], page.messages) } } });
  }
  /** Reads the page before the oldest one read. */
  async older(profile: string) {
    const log = this.state.logs[profile], first = log?.entries[0]?.i;
    if (!log || log.loading || !first) return;
    this.set({ logs: { ...this.state.logs, [profile]: { ...log, loading: true } } });
    await this.read(profile, first);
    const { loading: _, ...read } = this.state.logs[profile];
    this.set({ logs: { ...this.state.logs, [profile]: read } });
  }
  /** Changes one window's run. */
  private live(id: string, change: (live: Live) => Live) {
    const live = change(this.state.live[id] ?? idle());
    this.set({ live: { ...this.state.live, [id]: live } });
    // Pi stops waiting after a dialog's `timeout` and says nothing when it does: the dialog goes then, in whichever window.
    for (const { id: dialog, timeout } of live.dialogs) {
      const key = `${id} ${dialog}`;
      if (typeof timeout === 'number' && timeout > 0 && !this.deadlines.has(key)) this.deadlines.set(key, setTimeout(() => this.expire(id, String(dialog)), timeout));
    }
  }
  private window(id: string) { return this.state.windows.find(window => window.id === id); }
  /** A window's latest run and what its Pi shows, from the server. */
  private async replayed(id: string) {
    if (this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const kept = await this.ask('records', { window: id });
      // A Pi that died in its run never said the run was over.
      if (kept && this.window(id)) this.live(id, () => this.window(id)?.status === 'stopped' ? stopped(replay(kept, kept.seq)) : replay(kept, kept.seq));
    } finally { this.loading.delete(id); }
  }
  /** What a window's runs said is in the profile's log, or for a connected window in its Pi's conversation. */
  private async said(id: string) {
    const window = this.window(id);
    if (window?.role === 'connected') await this.session(id); else if (window) await this.read(window.profile);
  }
  private async session(id: string) {
    const window = this.window(id);
    if (window?.role !== 'connected' || window.status === 'stopped') return;
    const answer = await this.client?.request('command', { window: id, command: { type: 'get_messages' } }).catch(() => undefined);
    const messages = isObject(answer?.data) && Array.isArray(answer.data.messages) ? answer.data.messages.filter(isMessage) : undefined;
    if (messages && this.window(id)) this.set({ sessions: { ...this.state.sessions, [id]: messages } });
  }
  /** What the server pushes: a window that changed, or one of Pi's records. Records are numbered; when one is missing, the
   * window's run is asked for again. */
  receive(push: Push) {
    if (push.push === 'window') {
      const { window } = push;
      this.put(window);
      // A Pi that died in a run never says the run is over; what it had logged by then is in the log.
      if (window.status === 'stopped' && this.state.live[window.id]?.running) { this.live(window.id, stopped); void this.read(window.profile); }
      return;
    }
    const { window, seq, record } = push, last = this.state.live[window]?.seq ?? 0;
    if (this.loading.has(window) || seq <= last) return;
    // Records were missed, a run's end perhaps among them: the run is read again, and what it said.
    if (seq !== last + 1) { void this.replayed(window).then(() => this.said(window)); return; }
    this.live(window, live => apply(live, record, seq));
    if (record.type === 'agent_settled') void this.said(window);
  }

  async openProfile(profile: string) {
    this.set({ tabs: this.state.tabs.includes(profile) ? this.state.tabs : [...this.state.tabs, profile], profile });
    await this.opened(profile);
  }
  closeTab(profile: string) {
    const tabs = this.state.tabs.filter(tab => tab !== profile);
    this.set({ tabs, profile: this.state.profile === profile ? tabs[0] : this.state.profile });
  }
  select(window: string) {
    const profile = this.window(window)?.profile;
    if (profile) this.set({ profile, selected: { ...this.state.selected, [profile]: window } });
  }
  /** A new connected window beside the profile's main chat. */
  async newWindow(profile: string) {
    const opened = await this.ask('open', { profile, role: 'connected' });
    if (!opened) return;
    this.put(opened.window);
    this.set({ selected: { ...this.state.selected, [profile]: opened.window.id } });
  }
  /** Sends your message. In a run it steers the agent, or with `later` waits until the agent has stopped. */
  async send(window: string, text: string, later = false) {
    return await this.ask('prompt', { window, text, whenBusy: later ? 'followUp' : 'steer' }) !== undefined;
  }
  /** Stops the run, and gives back the messages that were still waiting, so they are not lost. */
  async stop(window: string) {
    const queued = await this.ask('abort', { window });
    return queued ? [...queued.steering, ...queued.followUp] : [];
  }
  async complete(window: string) { await this.ask('complete', { window }); }
  async closeWindow(window: string) { await this.ask('close', { window }); }
  /** Answers a dialog, which then goes; one whose answer did not arrive stays to be answered again. */
  async answer(window: string, response: Omit<Params<'answer'>, 'window'>) {
    if (await this.ask('answer', { window, ...response })) this.expire(window, response.id);
  }
  /** Takes a dialog off the page: it was answered, or its time ran out and Pi went on without an answer. */
  private expire(window: string, id: string) {
    const key = `${window} ${id}`;
    clearTimeout(this.deadlines.get(key));
    this.deadlines.delete(key);
    this.live(window, live => without(live, id));
  }
  dismiss() { this.set({ error: undefined }); }
}
export const app = new App();
export const useApp = () => useSyncExternalStore(app.subscribe, () => app.state);
