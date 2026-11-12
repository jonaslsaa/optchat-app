import { useSyncExternalStore } from 'react';
import { connect, type Client } from '../client.ts';
import type { Message, Method, Params, Push, Result, WindowState } from '../protocol.ts';
import { apply, idle, replay, stopped, without, type Live, type PiMessage } from './transcript.ts';

/** Everything the page knows, kept outside React: the connection to the server, and what it said. Components read it with
 * `useApp` and change it through `app`'s methods. */
export interface State {
  connection: 'connecting' | 'open' | 'lost';
  /** The profiles on disk, the ones open as tabs, and the one in front. */
  profiles: string[];
  tabs: string[];
  profile?: string;
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
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isMessage = (value: unknown): value is PiMessage => isObject(value) && typeof value.role === 'string' && typeof value.timestamp === 'number';
export const mainOf = (profile: string) => `${profile}/main`;

class App {
  state: State = { connection: 'connecting', profiles: [], tabs: [], windows: [], selected: {}, logs: {}, live: {}, sessions: {} };
  private client?: Client;
  private readonly listeners = new Set<() => void>();
  private readonly loading = new Set<string>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    const { tabs, profile, selected } = this.state;
    localStorage.setItem(SAVED, JSON.stringify({ tabs, profile, selected }));
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

  /** Connects, and again a second after the connection is lost: windows live in the server, so nothing is lost with it. A
   * socket that never opened closes too, so its closing is the one place that tries again. */
  async start(url: string) {
    try {
      this.client = await connect(url, push => this.pushed(push), () => { this.client = undefined; this.set({ connection: 'lost' }); setTimeout(() => void this.start(url), 1000); });
      await this.sync();
    } catch (error) {
      if (this.client) this.set({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  private async sync() {
    const [profiles, windows] = await Promise.all([this.client!.request('profiles', {}), this.client!.request('windows', {})]);
    const names = profiles.profiles.map(p => p.name), saved: unknown = JSON.parse(localStorage.getItem(SAVED) ?? '{}');
    const before = isObject(saved) && Array.isArray(saved.tabs) ? saved.tabs.filter((tab): tab is string => names.includes(tab)) : [];
    const tabs = before.length ? before : names.slice(0, 1);
    const profile = isObject(saved) && typeof saved.profile === 'string' && tabs.includes(saved.profile) ? saved.profile : tabs[0];
    const selected = isObject(saved) && isObject(saved.selected) ? Object.fromEntries(Object.entries(saved.selected).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
    this.set({ connection: 'open', profiles: names, tabs, profile, selected, windows: windows.windows, error: undefined });
    await Promise.all([...tabs.map(tab => this.opened(tab)), ...windows.windows.map(window => this.catchUp(window.id))]);
  }
  /** A profile's tab needs its main window to exist, and the end of its log. */
  private async opened(profile: string) {
    await Promise.all([this.ask('open', { profile }), this.read(profile)]);
  }
  /** Reads the newest page of a profile's log, keeping the older pages already read. */
  private async read(profile: string) {
    const page = await this.ask('history', { profile, limit: PAGE });
    if (!page) return;
    const from = page.messages[0]?.i ?? page.total, older = this.state.logs[profile]?.entries.filter(entry => entry.i < from) ?? [];
    const joined = older.length && older.at(-1)!.i === from - 1 ? [...older, ...page.messages] : page.messages;
    this.set({ logs: { ...this.state.logs, [profile]: { total: page.total, entries: joined } } });
  }
  /** Reads the page before the oldest one read. */
  async older(profile: string) {
    const log = this.state.logs[profile], first = log?.entries[0]?.i;
    if (!log || log.loading || !first) return;
    this.set({ logs: { ...this.state.logs, [profile]: { ...log, loading: true } } });
    const page = await this.ask('history', { profile, before: first, limit: PAGE });
    const now = this.state.logs[profile];
    if (now) this.set({ logs: { ...this.state.logs, [profile]: { total: page?.total ?? now.total, entries: [...page?.messages ?? [], ...now.entries] } } });
  }
  /** A window's latest run and what its Pi shows, from the server; and a connected window's conversation, from its Pi. */
  private async catchUp(id: string) {
    if (this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const kept = await this.ask('records', { window: id });
      if (kept) this.live(id, () => this.running(id) ? replay(kept, kept.seq) : stopped(replay(kept, kept.seq)));
    } finally { this.loading.delete(id); }
    await this.session(id);
  }
  private async session(id: string) {
    const window = this.state.windows.find(w => w.id === id);
    if (!window || window.owner !== false) return;
    const answer = await this.client?.request('command', { window: id, command: { type: 'get_messages' } }).catch(() => undefined);
    const messages = isObject(answer?.data) && Array.isArray(answer.data.messages) ? answer.data.messages.filter(isMessage) : undefined;
    if (messages) this.set({ sessions: { ...this.state.sessions, [id]: messages } });
  }
  /** Changes one window's run. */
  private live(id: string, change: (live: Live) => Live) {
    this.set({ live: { ...this.state.live, [id]: change(this.state.live[id] ?? idle()) } });
  }
  /** Whether the window has a Pi. */
  private running(id: string) {
    const status = this.state.windows.find(w => w.id === id)?.status;
    return status !== undefined && status !== 'stopped' && status !== 'closed';
  }
  private pushed(push: Push) {
    if (push.push === 'window') {
      const { window } = push, others = this.state.windows.filter(w => w.id !== window.id);
      const selected = window.status === 'closed' && this.state.selected[window.profile] === window.id ? { ...this.state.selected, [window.profile]: mainOf(window.profile) } : this.state.selected;
      this.set({ windows: window.status === 'closed' ? others : [...others, window].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), selected });
      // A Pi that died in a run never says the run is over; what it had logged by then is in the log.
      if (window.status === 'stopped' && this.state.live[window.id]?.running) { this.live(window.id, stopped); void this.read(window.profile); }
      return;
    }
    const { window, seq, record } = push, live = this.state.live[window] ?? idle();
    if (this.loading.has(window) || seq <= live.seq) return;
    if (seq !== live.seq + 1) { void this.catchUp(window); return; }
    this.live(window, live => apply(live, record, seq));
    // What the run said is in the log now, or for a connected window in its Pi's conversation.
    if (record.type === 'agent_settled') {
      const state = this.state.windows.find(w => w.id === window);
      if (state?.owner === false) void this.session(window); else if (state) void this.read(state.profile);
    }
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
    const profile = this.state.windows.find(w => w.id === window)?.profile;
    if (profile) this.set({ profile, selected: { ...this.state.selected, [profile]: window } });
  }
  /** A new connected window beside the profile's main chat. */
  async newWindow(profile: string) {
    const opened = await this.ask('open', { profile, role: 'connected' });
    if (opened) this.set({ selected: { ...this.state.selected, [profile]: opened.window.id } });
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
  async close(window: string) { await this.ask('close', { window }); }
  async answer(window: string, response: Omit<Params<'answer'>, 'window'>) {
    await this.ask('answer', { window, ...response });
    this.expire(window, response.id);
  }
  /** Takes a dialog off the page: it was answered, or its time ran out and Pi went on without an answer. */
  expire(window: string, id: string) { this.live(window, live => without(live, id)); }
  dismiss() { this.set({ error: undefined }); }
}
export const app = new App();
export const useApp = () => useSyncExternalStore(app.subscribe, () => app.state);
