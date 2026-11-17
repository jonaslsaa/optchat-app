import { useSyncExternalStore } from 'react';
import { connect, type Client } from '../client.ts';
import { PIECE, type Command, type Config, type ImportPreview, type ImportStatus, type Line, type Message, type Method, type ModelChoice, type Params, type Push, type Result, type Settings, type Setup, type Updating, type Usage, type WindowState } from '../protocol.ts';
import { current } from '../window.ts';
import type { Image } from './images.ts';
import { asTyped, yours } from './cite.ts';
import type { Scans, Source } from './imports.ts';
import { calling, key, NO_TREE, path, read, toggled, type Tree } from './memory.ts';
import { apply, idle, isMessage, isObject, merged, quiet, replay, stopped, without, words, type Live, type PiMessage } from './transcript.ts';

/** Everything the page knows, kept outside React: the connection to the server, and what it said. Components read it with
 * `useApp` and change it through `app`'s methods. */
export interface State {
  connection: 'connecting' | 'open' | 'lost' | 'refused';
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
  /** Each profile's agents as last read from its files, and the chats of those that were opened, by profile and agent
   * (`work/1a2b3c4d`): the messages read so far, of the `total` the server counted them from. */
  agents: Record<string, Result<'agents'>>;
  /** Each profile's issues and pull requests, as last read. */
  github: Record<string, Result<'github'>>;
  /** The models each window's agent can run on, as last read, with what Pi starts on by itself where the window had no Pi. */
  models: Record<string, Result<'models'>>;
  /** The commands each window's Pi knows, once the list a `/` opens has asked for them. */
  commands: Record<string, Command[]>;
  chats: Record<string, { total: number; messages: PiMessage[]; report?: string; ended?: number; queued?: string[] }>;
  /** Each profile's memory view, once it was looked at, with the lines that were opened in it. */
  memory: Record<string, Tree>;
  /** Each profile's settings and instructions as pi-optchat keeps them, once the settings page has shown them. */
  config: Record<string, Config>;
  /** What each profile used, as last read: in the range that was last asked for. */
  usage: Record<string, Usage>;
  /** What a scan of this machine found of each source's history, once it was asked for (`undefined` while it reads), and the
   * ChatGPT export on its way to the server. */
  scans: Scans;
  uploading?: { name: string; sent: number; size: number };
  /** How each open profile's import stands, as last read, and the import it last finished while the page looked. */
  imports: Record<string, ImportStatus>;
  imported: Record<string, { added: number }>;
  /** The images that go with what is typed in each window, kept while you look at another one; not when the page is opened again. */
  attached: Record<string, Image[]>;
  /** Why the last thing you asked for failed. */
  error?: string;
  /** The app's settings, and what a chat needs with whether it is there, once the server has said. */
  settings?: Settings;
  setup?: Setup;
  /** What the desktop app's updater is doing, where the app updates itself: the update button shows it. */
  update?: Updating;
  /** The provider you are signing in to in a terminal, while the page waits for Pi to say it is done. */
  signingIn?: Provider;
  /** The profiles whose agents a close or crash of their Pi cut off, as the server last found them, and for each profile the
   * latest start among those you dismissed: only an agent started after it brings the profile's line back. */
  cutOff: Result<'cutOff'>['profiles'];
  dismissed: Record<string, number>;
}
type Provider = Params<'signIn'>['provider'];
const PAGE = 200, SAVED = 'optchat-app', DRAFTS = 'optchat-app-drafts', DISMISSED = 'optchat-app-cut-off', SIGN_IN_ASKS = 100;
export const mainOf = (profile: string) => `${profile}/main`;
const ordered = (windows: WindowState[]) => windows.toSorted((a, b) => a.profile.localeCompare(b.profile) || Number(b.role === 'main') - Number(a.role === 'main') || a.id.localeCompare(b.id, undefined, { numeric: true }));
export const UNTITLED = 'Untitled window';
/** The profiles the bar over the page offers to resume: cut off, and not dismissed since. */
export const cutOffShown = ({ cutOff, dismissed }: Pick<State, 'cutOff' | 'dismissed'>) =>
  cutOff.filter(({ profile, agents }) => agents.some(({ started }) => started > (Object.hasOwn(dismissed, profile) ? dismissed[profile] : -Infinity)));
/** What a window is called: the main chat, or a connected window by the first message of the conversation it is in, once it has one. */
export function title(window: WindowState, state: State) {
  if (window.role === 'main') return 'Main chat';
  const first = current(window, [...state.sessions[window.id] ?? [], ...state.live[window.id]?.messages ?? []]).find(message => message.role === 'user');
  // A message that only cites something is called by what it cites, and one that runs a skill as it was typed.
  const said = yours(first ? words(first.content) : '');
  return first ? ((said.skill ? asTyped(said) : said.text) || said.cites[0]?.text || '').split('\n')[0] : UNTITLED;
}

/** What went wrong, in the words it was said in. */
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

export class App {
  state: State = { connection: 'connecting', profiles: [], tabs: [], windows: [], selected: {}, logs: {}, live: {}, sessions: {}, agents: {}, github: {}, models: {}, commands: {}, chats: {}, memory: {}, config: {}, usage: {}, attached: {}, cutOff: [], dismissed: {}, scans: {}, imports: {}, imported: {} };
  private client?: Client;
  private retrying?: ReturnType<typeof setTimeout>;
  private closed = false;
  private readonly listeners = new Set<() => void>();
  private readonly loading = new Set<string>();
  private readonly deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  private readonly retry: number;
  private readonly poll: number;
  /** Which sign-in is being waited for: a later one, or a cancel, ends the wait of the one before. */
  private waiting = 0;

  /** `storage` keeps which profiles are open and what is typed and not sent, across reloads; `retry` is how long to wait before connecting again, and `poll`
   * between asking whether a sign-in is done. */
  constructor({ storage = () => localStorage, retry = 1000, poll = 3000 }: { storage?: () => Pick<Storage, 'getItem' | 'setItem'>; retry?: number; poll?: number } = {}) {
    this.storage = storage;
    this.retry = retry;
    this.poll = poll;
  }
  /** Connects, and again a while after the connection is lost: windows live in the server, so nothing is lost with it. A socket
   * that never opened closes too, so its closing is the one place that tries again, with one timer. A server that refused the
   * token started again since this page was opened (it has a new one), so trying again would never end. */
  async start(url: string) {
    const lost = (refused: boolean) => {
      this.client = undefined;
      this.set({ connection: refused ? 'refused' : 'lost' });
      if (!this.closed && !refused) this.retrying ??= setTimeout(() => { this.retrying = undefined; void this.start(url); }, this.retry);
    };
    try {
      this.client = await connect(url, push => this.receive(push), lost);
      await this.sync();
    } catch (error) {
      if (this.client) this.set({ error: reason(error) });
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
    const before = this.state, next = { ...before, ...patch };
    // A lost connection is said once, for as long as it lasts: whatever fails meanwhile fails for that reason.
    this.state = next.connection === 'lost' || next.connection === 'refused' ? { ...next, error: undefined } : next;
    const { tabs, profile, selected } = this.state;
    if (tabs !== before.tabs || profile !== before.profile || selected !== before.selected) this.storage().setItem(SAVED, JSON.stringify({ tabs, profile, selected }));
    for (const listener of this.listeners) listener();
  }
  private request<M extends Method>(method: M, params: Params<M>) {
    if (!this.client) throw new Error('Not connected to the server.');
    return this.client.request(method, params);
  }
  /** A request to the server; one that fails is shown, not thrown. */
  private async ask<M extends Method>(method: M, params: Params<M>): Promise<Result<M> | undefined> {
    try { return await this.request(method, params); } catch (error) {
      const message = reason(error);
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
    const here = (id: string) => windows.windows.some(window => window.id === id);
    const kept = <T>(by: Record<string, T>) => Object.fromEntries(Object.entries(by).filter(([id]) => here(id)));
    // So is what was typed in one, and its images, or a new window with its number would have them. A main chat is the same
    // one whenever it is opened, so what was typed in it stays.
    const typed = <T>(by: Record<string, T>) => Object.fromEntries(Object.entries(by).filter(([id]) => here(id) || names.some(name => mainOf(name) === id)));
    this.keepAll(typed(this.drafts()));
    this.set({ connection: 'open', profiles: names, tabs, profile, selected, windows: ordered(windows.windows), live: kept(this.state.live), sessions: kept(this.state.sessions), attached: typed(this.state.attached), error: undefined });
    // Neither is waited for: looking for Pi takes a moment, and the chat does not need it to show.
    void this.ask('settings', {}).then(settings => settings && this.set({ settings }));
    void this.ask('update', {}).then(said => said && this.set({ update: said.update }));
    void this.checkSetup();
    void this.findCutOff();
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
    // What a closed window said and asked goes with it, and what was being typed in it.
    this.keep(window.id, ''); this.attach(window.id, []);
    const { [window.id]: _run, ...live } = this.state.live, { [window.id]: _conversation, ...sessions } = this.state.sessions;
    for (const [key, deadline] of this.deadlines) if (key.startsWith(`${window.id} `)) { clearTimeout(deadline); this.deadlines.delete(key); }
    this.set({ windows: others, selected, live, sessions });
  }
  /** Reads a page of a profile's log into what is read of it already: the newest page, or the one before entry `before`. */
  private async read(profile: string, before?: number) {
    const page = await this.ask('history', { profile, limit: PAGE, ...before !== undefined && { before } });
    if (page) this.set({ logs: { ...this.state.logs, [profile]: { ...this.state.logs[profile], total: page.total, entries: merged(this.state.logs[profile]?.entries ?? [], page.messages) } } });
  }
  /** A click on the update button: the app looks for an update, or offers the one it has, and says so itself. */
  update() { return this.ask('updateNow', {}); }
  /** Changes the settings it names; every page gets them all as the server kept them. */
  saveSettings(change: Params<'setSettings'>) { return this.ask('setSettings', change); }
  /** A profile's settings and instructions as its files have them now. */
  async readConfig(profile: string) {
    const config = await this.ask('config', { profile });
    if (config) this.set({ config: { ...this.state.config, [profile]: config } });
  }
  /** Changes one of a profile's settings, or one of its models. Why not, when pi-optchat refuses: that is said beside the
   * field it is about, which keeps what you typed, and not above the page. */
  async configure(profile: string, key: string, value: Params<'configure'>['value']) {
    try {
      const config = await this.request('configure', { profile, key, value });
      this.set({ config: { ...this.state.config, [profile]: config } });
    } catch (error) { return reason(error); }
  }
  /** The editors a file can open in here, and the one it opens in now. */
  editors() { return this.ask('editors', {}); }
  /** Opens a profile's instructions in your editor: in `editor`, which is then the one files open in, when one is picked. */
  async openInstructions(profile: string, editor?: string) {
    if (editor && !await this.saveSettings({ editor })) return;
    await this.ask('openInstructions', { profile });
  }
  /** Keeps a profile's instructions, or says why not. */
  async instruct(profile: string, text: string) {
    try {
      await this.request('instruct', { profile, text });
      const config = this.state.config[profile];
      if (config) this.set({ config: { ...this.state.config, [profile]: { ...config, instructions: text } } });
    } catch (error) { return reason(error); }
  }
  /** What a chat needs and whether it is there: as the server last found it, or looked for again now. */
  async checkSetup(fresh = false) {
    const setup = await this.ask('setup', { fresh });
    if (setup) this.set({ setup });
  }
  /** Makes a profile, which is then there to open. Why not, when pi-optchat will not make it (a name that will not do, or one
   * there is already): that is said where the name was typed, not over the page. */
  async createProfile(name: string) {
    try { await this.request('createProfile', { name }); } catch (error) { return reason(error); }
    this.set({ profiles: [...this.state.profiles, name].sort() });
  }
  /** The profiles as they are now. Once there is one, it is opened. */
  async findProfiles() {
    const names = (await this.ask('profiles', {}))?.profiles.map(profile => profile.name);
    if (!names) return;
    this.set({ profiles: names });
    if (names.length && !this.state.profile) await this.openProfile(names[0]);
  }
  /** Which profiles' agents were cut off, and which of those you dismissed, which the browser keeps. */
  private async findCutOff() {
    const found = await this.ask('cutOff', {}), saved: unknown = JSON.parse(this.storage().getItem(DISMISSED) ?? '{}');
    const dismissed = isObject(saved) ? Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {};
    if (found) this.set({ cutOff: found.profiles, dismissed });
  }
  /** Opens the profile and resumes its cut-off agents, through its Pi, which is started for it. */
  async resumeAgents(profile: string) {
    await Promise.all([this.openProfile(profile), this.ask('resumeAgents', { profile })]);
    await this.findCutOff();
  }
  /** Takes a profile's line off the bar until an agent of it that started later is cut off. Its agents are still in its list. */
  dismissCutOff(profile: string) {
    const latest = Math.max(...this.state.cutOff.find(cut => cut.profile === profile)?.agents.map(agent => agent.started) ?? []);
    const dismissed = { ...this.state.dismissed, [profile]: latest };
    try { this.storage().setItem(DISMISSED, JSON.stringify(dismissed)); } catch {}
    this.set({ dismissed });
  }
  /** Has the server open a terminal where Pi signs you in, then asks whether Pi can use the provider until it can: a hundred
   * times at most (five minutes, and what the answers take), and no more once you cancel, the answer fails, or the page is gone. The page learns that the
   * sign-in is done, and nothing else about it. */
  async signIn(provider: Provider) {
    const mine = ++this.waiting, over = () => this.closed || mine !== this.waiting;
    this.set({ signingIn: provider });
    let done = !await this.ask('signIn', { provider });
    for (let asked = 0; !done && !over() && asked < SIGN_IN_ASKS; asked++) {
      await new Promise(resolve => setTimeout(resolve, this.poll));
      if (over()) return;
      const answer = await this.ask('signedIn', { provider });
      if (over()) return;
      if (answer?.status === 'ready') await this.checkSetup(true);
      done = answer?.status !== 'not_ready';
    }
    if (!over()) this.set({ signingIn: undefined });
  }
  cancelSignIn() { this.waiting++; this.set({ signingIn: undefined }); }
  /** Installs Pi or pi-optchat; how it goes is pushed as the setup. */
  install(what: Params<'install'>['what']) { return this.ask('install', { what }); }
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
  /** What the server pushes: the settings or the setup when they change, a window that changed, or one of Pi's records. Records are numbered; when one is missing, the
   * window's run is asked for again. */
  receive(push: Push) {
    if (push.push === 'settings') { this.set({ settings: push.settings }); return; }
    if (push.push === 'setup') { this.set({ setup: push.setup }); return; }
    if (push.push === 'update') { this.set({ update: push.update }); return; }
    if (push.push === 'window') {
      const { window } = push, was = this.window(window.id), outside = was?.outside, live = this.state.live[window.id];
      this.put(window);
      // A Pi outside the app had the chat and let it go: what it wrote meanwhile is in the log.
      if (outside && !window.outside) void this.read(window.profile);
      // A Pi that died in a run never says the run is over; what it had logged by then is in the log.
      // Nor does it take the message you sent it a moment before it died. A window that was stopped already is only said
      // again (its model was looked at before its Pi starts): the message is still on its way.
      if (window.status === 'stopped' && (live?.running || live?.sent && was?.status !== 'stopped')) { this.live(window.id, stopped); void this.read(window.profile); }
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
  /** A profile's agents as its files have them now: those at work, and the newest `limit` of the others. */
  async readAgents(profile: string, limit?: number) {
    const agents = await this.ask('agents', { profile, limit });
    // It is asked for every two seconds while an agent works: the page is drawn again only when something changed.
    if (agents && JSON.stringify(agents) !== JSON.stringify(this.state.agents[profile])) this.set({ agents: { ...this.state.agents, [profile]: agents } });
  }
  /** The issues and pull requests a profile's main chat named, and what GitHub says of them by now. */
  async readGitHub(profile: string, limit?: number, fresh?: boolean) {
    const github = await this.ask('github', { profile, limit, fresh });
    if (github && JSON.stringify(github) !== JSON.stringify(this.state.github[profile])) this.set({ github: { ...this.state.github, [profile]: github } });
  }
  /** What a profile used in `range`, from its ledger as it is now. */
  async readUsage(profile: string, range?: string) {
    const usage = await this.ask('usage', { profile, range });
    if (usage && JSON.stringify(usage) !== JSON.stringify(this.state.usage[profile])) this.set({ usage: { ...this.state.usage, [profile]: usage } });
  }
  /** What a source's scan finds: the server keeps it, and `fresh` has it look again. */
  async scan(source: Source, fresh = false) {
    this.set({ scans: { ...this.state.scans, [source]: undefined } });
    try {
      const scan = await this.request('importScan', { source, fresh });
      this.set({ scans: { ...this.state.scans, [source]: scan } });
    } catch (error) { this.set({ scans: { ...this.state.scans, [source]: { error: reason(error) } } }); }
  }
  /** Sends a ChatGPT export to the server a piece at a time, and has it read. Why not, when it was refused. */
  async upload(file: File) {
    // Base64 is four characters for three bytes: a piece is as much of the file as the server takes in one.
    const piece = PIECE / 4 * 3;
    this.set({ uploading: { name: file.name, sent: 0, size: file.size } });
    try {
      for (let offset = 0; offset === 0 || offset < file.size; offset += piece) {
        const bytes = new Uint8Array(await file.slice(offset, offset + piece).arrayBuffer());
        let data = '';
        for (let at = 0; at < bytes.length; at += 0x8000) data += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
        await this.request('importUpload', { name: file.name, offset, data: btoa(data) });
        this.set({ uploading: { name: file.name, sent: Math.min(file.size, offset + piece), size: file.size } });
      }
    } catch (error) { return reason(error); }
    finally { this.set({ uploading: undefined }); }
    await this.scan('chatgpt', true);
  }
  /** What importing the picked conversations would bring, or why it cannot be said. */
  async preview(profile: string, picked: Params<'importPreview'>['picked']): Promise<{ preview?: ImportPreview; error?: string }> {
    try { return { preview: await this.request('importPreview', { profile, picked }) }; } catch (error) { return { error: reason(error) }; }
  }
  /** Keeps how a profile's import stands. One the page saw under way finished when pi-optchat's last finished import is newer
   * than it, and not when it was discarded, here or anywhere: then the profile has another memory, which the chat and the
   * memory view read again. */
  private importing(profile: string, status: ImportStatus) {
    const before = this.state.imports[profile];
    const finished = before && before.state !== 'idle' && status.state === 'idle' && status.last && Date.parse(status.last.completed) > Date.parse(before.created) ? status.last : undefined;
    this.set({ imports: { ...this.state.imports, [profile]: status }, ...finished && { imported: { ...this.state.imported, [profile]: { added: finished.added } } } });
    if (finished) { void this.read(profile); if (this.state.memory[profile]) void this.readMemory(profile); }
  }
  async readImport(profile: string) {
    const status = await this.client?.request('importStatus', { profile }).catch(() => undefined);
    if (status && JSON.stringify(status) !== JSON.stringify(this.state.imports[profile])) this.importing(profile, status);
  }
  /** Starts, pauses, resumes or discards a profile's import, or says why not, in pi-optchat's words. */
  async startImport(profile: string, picked: Params<'importStart'>['picked'], mode: Params<'importStart'>['mode']) {
    try {
      const { [profile]: _, ...imported } = this.state.imported;
      this.set({ imported });
      this.importing(profile, await this.request('importStart', { profile, picked, mode }));
    } catch (error) { return reason(error); }
  }
  async controlImport(profile: string, action: Params<'importControl'>['action']) {
    try { this.importing(profile, await this.request('importControl', { profile, action })); } catch (error) { return reason(error); }
  }
  /** Forgets that an import finished, once its page has said so. */
  seenImport(profile: string) { const { [profile]: _, ...imported } = this.state.imported; this.set({ imported }); }
  /** Reads the commands a window's Pi knows, which starts that Pi: they are its extensions', its prompt templates and its skills. */
  async readCommands(window: string) {
    const answer = await this.client?.request('commands', { window }).catch(() => ({ commands: [] }));
    if (answer) this.set({ commands: { ...this.state.commands, [window]: answer.commands } });
  }
  /** The models a window's agent can run on. Asked quietly, and none where Pi cannot be asked: the page already says what
   * is missing then. */
  async readModels(window: string) {
    const models = await this.client?.request('models', { window }).catch(() => ({ models: [] }));
    if (models) this.set({ models: { ...this.state.models, [window]: models } });
  }
  /** Picks the model of a window's agent, or says why not: that is said in the list it was picked from. The window then
   * says what it runs on. */
  async setModel(window: string, model: ModelChoice) {
    try { await this.request('setModel', { window, model }); } catch (error) { return reason(error); }
  }
  /** An agent's chat: what was written of it since it was last read. */
  async readAgent(profile: string, id: string) {
    const key = `${profile}/${id}`, after = this.state.chats[key]?.total ?? 0, read = await this.ask('agent', { profile, id, after });
    const had = this.state.chats[key], total = had?.total ?? 0;
    // Asked twice at once, two answers start at the same message: of each, only what goes on from what is here is added, and
    // one with nothing new changes nothing.
    if (!read || read.total < total || (had && read.total === total && read.report === had.report && JSON.stringify(read.queued) === JSON.stringify(had.queued))) return;
    this.set({ chats: { ...this.state.chats, [key]: { total: read.total, messages: [...had?.messages ?? [], ...read.messages.slice(total - after).filter(isMessage)], report: read.report, ended: read.ended, queued: read.queued } } });
  }
  /** Tells an agent, interrupts it or stops it, and answers why not when it was refused: those are pi-optchat's words, to be
   * read whole where the agent is, so they are handed back and not shown as other failures are. What it did is then in the
   * profile's files, which the panel reads. */
  async act<M extends 'tellAgent' | 'interruptAgent' | 'stopAgent'>(method: M, params: Params<M>): Promise<string | undefined> {
    try {
      if (!this.client) throw new Error('Not connected to the server.');
      await this.client.request(method, params);
      // An agent resumed from its chat is no longer cut off.
      if (method === 'tellAgent') void this.findCutOff();
    } catch (error) { return reason(error); }
  }
  private tree(profile: string, change: (tree: Tree) => Tree) { this.set({ memory: { ...this.state.memory, [profile]: change(this.state.memory[profile] ?? NO_TREE) } }); }
  /** A profile's memory view as its files have it now. The lines that are open stay open, unless it is another memory by
   * now (the profile was moved to one, or its log is shorter): then nothing read of the old one holds. */
  async readMemory(profile: string) {
    const view = await this.ask('view', { profile }), before = this.state.memory[profile]?.view;
    // It is read again whenever the chat moves: the page is drawn again only when the view did.
    if (!view || JSON.stringify(view) === JSON.stringify(before)) return;
    const same = !before || view.memory === before.memory && view.total >= before.total;
    this.tree(profile, tree => ({ ...same ? tree : NO_TREE, view }));
    // A tool call read before it had printed may have by now.
    await Promise.all(calling(this.state.memory[profile] ?? NO_TREE).map(id => this.original(profile, id)));
  }
  /** Which memory the page has the view of: an answer about another one, which came too late, is not kept. */
  private memoryOf(profile: string) { return this.state.memory[profile]?.view?.memory; }
  private async original(profile: string, id: number) {
    const of = this.memoryOf(profile), original = await this.ask('original', { profile, id });
    if (original && of === this.memoryOf(profile)) this.tree(profile, tree => ({ ...tree, originals: { ...tree.originals, [id]: original.messages } }));
  }
  /** What is under a line, read once: it is the same for as long as the memory is. */
  private async under(profile: string, line: Pick<Line, 'id' | 'n'>) {
    if (read(this.state.memory[profile] ?? NO_TREE, line)) return;
    if (line.n === 1) return this.original(profile, line.id);
    const of = this.memoryOf(profile), halves = await this.ask('zoom', { profile, id: line.id, n: line.n });
    if (halves && of === this.memoryOf(profile)) this.tree(profile, tree => ({ ...tree, under: { ...tree.under, [key(line)]: halves.lines } }));
  }
  /** Opens a line of the memory view into the two lines under it, or a line of one message into that message; or closes it. */
  async toggleLine(profile: string, line: Line) {
    this.tree(profile, tree => toggled(tree, line));
    await this.under(profile, line);
  }
  /** Searches the profile's memory for `text`, as its agent would: the messages that say it stand in the tree's place, newest
   * first. No text ends the search, and the tree is as it was. An answer that comes after other text was typed is not kept. */
  async search(profile: string, text: string) {
    this.tree(profile, ({ search, found, ...tree }) => text ? { ...tree, search: { ...search, text } } : tree);
    const page = text ? await this.ask('search', { profile, text }) : undefined;
    if (page) this.tree(profile, tree => tree.search?.text === text ? { ...tree, search: { text, answer: { of: text, ...page } } } : tree);
  }
  /** Asks for the messages older than those the search has, and adds them. Not while the answer for other text is on its way,
   * and asked for twice they are added once. */
  async moreFound(profile: string) {
    const { text, answer } = this.state.memory[profile]?.search ?? {}, before = answer?.hits.at(-1)?.id;
    if (text === undefined || answer?.of !== text || before === undefined) return;
    const page = await this.ask('search', { profile, text, before });
    if (page) this.tree(profile, tree => tree.search?.answer !== answer ? tree : { ...tree, search: { text, answer: { of: text, hits: [...answer.hits, ...page.hits], more: page.more } } });
  }
  /** Shows message `id` in the tree, or the line of `n` messages from it on: every line from the view down to it is opened,
   * and it is the one that was `found`. With no message, what the search found is shown again. */
  async find(profile: string, id?: number, n = 1) {
    if (id === undefined) return this.tree(profile, ({ found, ...tree }) => tree);
    const reach = () => path(this.state.memory[profile]?.view?.lines ?? [], id, n);
    // The search reads the log as it is now, which can be longer than the view the page has.
    if (!reach().length) await this.readMemory(profile);
    const down = reach(), last = down.at(-1);
    if (!last) return;
    this.tree(profile, tree => ({ ...tree, open: [...new Set([...tree.open, ...down.map(key)])] }));
    const text = this.state.memory[profile]?.search?.text;
    await Promise.all(down.map(line => this.under(profile, line)));
    // Unless the search was ended or is for other text by now: then the tree is open down to the message, and that is all.
    this.tree(profile, tree => tree.search?.text === text ? { ...tree, found: key(last) } : tree);
  }
  /** What is typed in a window and not sent yet. It is kept where the open profiles are, so it is there when the page is
   * opened again, and until it is sent or its window is gone. */
  draft(window: string) { return this.drafts()[window] ?? ''; }
  keep(window: string, text: string) { this.keepAll({ ...this.drafts(), [window]: text }); }
  private drafts() {
    const saved: unknown = JSON.parse(this.storage().getItem(DRAFTS) ?? '{}');
    return isObject(saved) ? Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
  }
  private keepAll(drafts: Record<string, string>) {
    // A browser with no room left keeps nothing more: the text is in the box, and is lost only to a reload.
    try { this.storage().setItem(DRAFTS, JSON.stringify(Object.fromEntries(Object.entries(drafts).filter(([, text]) => text)))); } catch {}
  }
  attach(window: string, images: Image[]) { this.set({ attached: { ...this.state.attached, [window]: images } }); }
  /** Sends your message, with its images. In a run it steers the agent, or with `later` waits until the agent has stopped. */
  async send(window: string, text: string, later = false, images: Image[] = []) {
    this.quiet(window);
    // It is in the chat at once, as Pi will have it (`Live.sent`). Not a command, which is no message (a skill is one), and not in a run, where
    // it waits under the chat until the agent reads it (`queued`).
    const command = text.startsWith('/') && !yours(text).skill, shown = !command && this.window(window)?.status !== 'running';
    if (shown) this.live(window, live => ({ ...live, sent: { role: 'user', timestamp: Date.now(), content: [{ type: 'text', text }, ...images.map(({ data, mimeType }) => ({ type: 'image', data, mimeType }))] } }));
    const answer = await this.ask('prompt', { window, text, images, whenBusy: later ? 'followUp' : 'steer' });
    // Taken back unless it began a run, whose first record is Pi's copy of it: it was refused, it failed, or a run that began
    // meanwhile has it waiting.
    if (shown && answer?.disposition !== 'started') this.live(window, live => ({ ...live, sent: undefined }));
    // A message an extension answered itself (`handled`) was not sent, unless it is a command: pi-optchat refused it, and its
    // notice says why. So it is not lost, it counts as not sent.
    return answer !== undefined && (answer.disposition !== 'handled' || text.startsWith('/'));
  }
  /** Takes a notice off the page, or all of a window's: they stand until they are dismissed or the next message is sent. */
  quiet(window: string, text?: string) { this.live(window, live => quiet(live, text)); }
  /** Stops the run (`abort`), or takes back what it has not read and lets it go on (`dequeue`): either gives back the messages
   * that were still waiting, so they are not lost. */
  async takeBack(window: string, method: 'abort' | 'dequeue') {
    const queued = await this.ask(method, { window });
    return queued ? [...queued.steering, ...queued.followUp] : [];
  }
  async complete(window: string) { await this.ask('complete', { window }); }
  private files = new Map<string, Promise<boolean>>();
  /** Whether a path the chat named is a file in the window's folder: asked once a path and window, so a component can wait on
   * it with `use`. A file made since is a link once the page is opened again. */
  isFile(window: string, path: string) {
    const key = `${window}\n${path}`;
    let file = this.files.get(key);
    // A request that failed (the server was away) is asked again the next time, not remembered as no file.
    if (!file) this.files.set(key, file = Promise.resolve().then(() => this.request('isFile', { window, path })).then(({ file }) => file, () => { this.files.delete(key); return false; }));
    return file;
  }
  async openFile(window: string, path: string, line?: number) { await this.ask('openFile', { window, path, line }); }
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
