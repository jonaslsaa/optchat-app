import type { Entry } from 'pi-optchat/core';
import type { RunState } from 'pi-optchat/files';
import { Type, type Static, type TSchema } from 'typebox';

/** The protocol between the app's server and its UI: one WebSocket carrying JSON. The client sends requests and gets one response
 * each; the server also pushes what happens in windows. Every type the UI needs is inferred from the schemas in this file, which
 * imports nothing from Node. */

const id = Type.Integer({ minimum: 0 });

/** A message of a profile's log, as pi-optchat keeps it (its `Entry`): `user` (your words), `talk` (the agent's replies), `tool`
 * and `echo` (tool calls and results), `note`, `work` (subagent reports). One with an `origin` is imported history. */
export const Message = Type.Unsafe<Entry>({});
export type Message = Entry;

/** A line of the summary tree, in pi-optchat's own notation: the `n` messages from `id` on. No `text` means its summary is not
 * built yet. */
export const Line = Type.Object({ id, n: Type.Integer({ minimum: 1 }), text: Type.Optional(Type.String()) });
export type Line = Static<typeof Line>;

/** A record Pi wrote in RPC mode, passed through as it is: a session event (`agent_start`, `message_update`, `tool_execution_end`,
 * ...) or an `extension_ui_request`. Pi's docs (rpc.md, json.md, rpc-extension-ui.md) define them; the server reads only what tells it a window's state. */
export const PiRecord = Type.Intersect([Type.Object({ type: Type.String() }), Type.Record(Type.String(), Type.Unknown())]);
export type PiRecord = Static<typeof PiRecord>;

/** A window is a conversation in the app, and one Pi process when it runs. `role` is its place in the app and never changes: the
 * profile's `main` chat, or a `connected` window beside it, whose conversation ends in a handoff to the main chat.
 * The main window's Pi owns the profile. While a Pi outside the app holds it (one in a terminal), the main window says who in
 * `outside` (`unknown` when that Pi does not say) and takes no prompt; a connected window's Pi only ever joins, that one too. `completed` is pi-optchat's word that a
 * connected window's conversation is handed off; its next prompt begins a new conversation in it, and `since` is then when the
 * last one was handed off, as pi-optchat says it: what its Pi said before then belongs to conversations the main chat has.
 * `stopped`: no process (not started yet, closed, or it exited: `error` says why if it failed). `idle` and `running`: whether the
 * agent is in a run. `closed`: a connected window that is gone, pushed once as it leaves the list. `seq` is the number of the last
 * record the window pushed. `cwd` is where its Pi runs, set when the window is first opened. */
export const WindowState = Type.Object({
  id: Type.String(), profile: Type.String(), role: Type.Enum(['main', 'connected']), cwd: Type.String(),
  status: Type.Enum(['stopped', 'starting', 'idle', 'running', 'closed']), seq: id,
  completed: Type.Optional(Type.Boolean()), since: Type.Optional(Type.Number()), error: Type.Optional(Type.String()),
  outside: Type.Optional(Type.Union([Type.Object({ pid: Type.Integer(), host: Type.String(), cwd: Type.String() }), Type.Literal('unknown')])),
});
export type WindowState = Static<typeof WindowState>;

/** The app's own settings, kept in its own folder (never in pi-optchat's). `cwd`: where new windows run; your home directory
 * when it is not set. `theme`: the page's colours, the system's by default. */
const Theme = Type.Enum(['system', 'light', 'dark']);
export const Settings = Type.Object({ cwd: Type.Optional(Type.String()), theme: Theme });
export type Settings = Static<typeof Settings>;

/** One thing the app needs before it can run a chat. `ok`: there and new enough. `missing`: not there. `old`: there, and too
 * old. `unknown`: could not be told (Pi itself is missing, or did not answer). `message` says what is wrong and what to do in
 * the other states, and `command` is the exact line that does it in a terminal; `path` is where it was found. `installable`:
 * the app can put it right itself (`install`), which it does only for what is its own to change: a Pi in its own folder, and
 * a pi-optchat that Pi installed from npm. Never a Pi of yours, nor a pi-optchat that is a folder on your disk. */
const Need = Type.Object({
  state: Type.Enum(['ok', 'missing', 'old', 'unknown']), version: Type.Optional(Type.String()), path: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()), command: Type.Optional(Type.String()), installable: Type.Optional(Type.Boolean()),
});
/** What the app can install. */
const Installed = Type.Enum(['pi', 'optchat']);
/** The providers the app starts a sign-in for, by Pi's name for them: the ones Pi signs in to with an account, in the browser.
 * A sign-in is only ever started for one of these. */
const Account = Type.Enum(['anthropic', 'openai-codex', 'github-copilot']);
/** What the app needs, and whether it is there: Pi (`shell`: for the Pi the app installed
 * into its own folder, the line that puts it on your PATH), pi-optchat in that Pi, and a model provider that is logged in
 * (`providers`: those that are; `terminal`: the app can open a terminal here for Pi's sign-in, `signIn`). `job` is an install the app is running, or the last one it ran: `line` is the latest line it
 * printed, and `output` the end of everything it printed once it has failed. */
export const Setup = Type.Object({
  pi: Type.Intersect([Need, Type.Object({ shell: Type.Optional(Type.String()) })]),
  optchat: Need,
  login: Type.Intersect([Need, Type.Object({ providers: Type.Array(Type.String()), terminal: Type.Optional(Type.Boolean()) })]),
  job: Type.Optional(Type.Object({ what: Installed, state: Type.Enum(['running', 'done', 'failed']), line: Type.String(), output: Type.Optional(Type.String()) })),
});
export type Setup = Static<typeof Setup>;

/** A subagent of a profile's main agent, from the record pi-optchat keeps of it (its `RunInfo`). `state` is pi-optchat's:
 * `running`, `waiting` (for its own agents' reports), `paused`, `stopping`, or ended as `completed`, `failed`, `stopped` or
 * `interrupted`; one saved as working in a profile that no Pi has open is `interrupted`, since its Pi is gone. `started` and
 * `ended` are times in milliseconds, `parent` the agent that started it, when one did. `doing`: the tool calls it is waiting on
 * now. `headline`: the first line of what it reported. */
export const Agent = Type.Object({
  id: Type.String(), title: Type.Optional(Type.String()), task: Type.String(), model: Type.String(), state: Type.Unsafe<RunState>(Type.String()),
  started: Type.Number(), ended: Type.Optional(Type.Number()), parent: Type.Optional(Type.String()),
  doing: Type.Array(Type.Object({ name: Type.String(), args: Type.Record(Type.String(), Type.Unknown()) })), headline: Type.Optional(Type.String()),
});
export type Agent = Static<typeof Agent>;

const Image = Type.Object({ type: Type.Literal('image'), data: Type.String(), mimeType: Type.String() });
const target = Type.Object({ window: Type.String() });
const none = Type.Object({});
const method = <P extends TSchema, R extends TSchema>(params: P, result: R) => ({ params, result });

/** Every request: what it takes and what it answers. */
export const methods = {
  /** The profiles on disk. */
  profiles: method(none, Type.Object({ profiles: Type.Array(Type.Object({ name: Type.String() })) })),
  /** Makes a new, empty profile, as pi-optchat makes one (its `createProfile`): refused when the name is not one pi-optchat
   * takes, or is taken. The one thing the app writes among pi-optchat's files; a profile that exists is Pi's alone to write. */
  createProfile: method(Type.Object({ name: Type.String() }), none),
  /** A page of a profile's log, read from disk: the `limit` messages before message `before` (the newest ones by default),
   * oldest first. `total` is how many messages the log has. */
  history: method(Type.Object({ profile: Type.String(), before: Type.Optional(id), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
    Type.Object({ total: id, messages: Type.Array(Message) })),
  /** The view: the lines the agent sees this turn, oldest first, tiling the whole log. */
  view: method(Type.Object({ profile: Type.String() }), Type.Object({ total: id, lines: Type.Array(Line) })),
  /** Opens line `id`+`n` into the two lines of `n`/2 under it (`n` at least 2; a single message is a `history` page of one). */
  zoom: method(Type.Object({ profile: Type.String(), id, n: Type.Integer({ minimum: 2 }) }), Type.Object({ lines: Type.Array(Line) })),

  /** A profile's subagents, read from disk: those at work, and the newest `limit` of those that have ended (30 unless said);
   * `more` is how many ended ones that leaves out. No Pi is asked, so the list is there whether or not one runs. */
  agents: method(Type.Object({ profile: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 0 })) }), Type.Object({ agents: Type.Array(Agent), more: id })),
  /** One agent's chat, from its Pi session file: its messages as Pi wrote them (Pi's docs: session.md), from number `after` on,
   * of `total`. The first is its task, without the view of the profile's memory it was sent with, and images are left out.
   * `report` is what it reported, whole, and `ended` when it ended. An agent there is no record of has no messages. */
  agent: method(Type.Object({ profile: Type.String(), id: Type.String(), after: Type.Optional(id) }),
    Type.Object({ total: id, messages: Type.Array(Type.Unknown()), report: Type.Optional(Type.String()), ended: Type.Optional(Type.Number()) })),

  /** Every window the server knows. */
  windows: method(none, Type.Object({ windows: Type.Array(WindowState) })),
  /** A profile's main window (the same one each time), or a new connected window, which runs in `cwd` or else the folder in
   * the settings. No Pi starts until its first prompt; a connected window's first prompt starts the main window's Pi too if the
   * profile has no owner yet. Opening the main window also looks again at who holds the profile (`outside`). */
  open: method(Type.Object({ profile: Type.String(), role: Type.Optional(Type.Enum(['main', 'connected'])), cwd: Type.Optional(Type.String()) }), Type.Object({ window: WindowState })),
  /** Sends your message, starting the window's Pi first if it has none. In a run it is queued: `steer` (the default) reaches the
   * agent after its current tool calls, `followUp` once it has stopped. `disposition` is Pi's: `started`, `queued`, or `handled`
   * (a command took it and no run started). */
  prompt: method(Type.Object({ window: Type.String(), text: Type.String(), images: Type.Optional(Type.Array(Image)), whenBusy: Type.Optional(Type.Enum(['steer', 'followUp'])) }),
    Type.Object({ disposition: Type.Enum(['started', 'queued', 'handled']) })),
  /** Stops the run, as Esc does in the terminal: answers once the agent is idle, with the messages that were still queued
   * (Pi's `clear_queue`), which would otherwise start the next run. */
  abort: method(target, Type.Object({ steering: Type.Array(Type.String()), followUp: Type.Array(Type.String()) })),
  /** Ends a connected window's conversation and hands it to the main chat (pi-optchat's `/complete`). Answers once the handoff
   * is written, which takes a turn of the window's agent; until then the window takes no prompt. */
  complete: method(target, none),
  /** Stops the window's Pi, letting it shut down cleanly. A main window stays in the list and starts again on its next prompt;
   * a connected window leaves it. */
  close: method(target, none),
  /** For a client that connects late. `seq` is the number of the last record the window pushed. `records`: what it pushed
   * after number `after` and still keeps, which is everything since its latest run began. `complete` is false when there were
   * more before these: a main window's are in `history` by now, a connected window's only in its Pi (`command` with Pi's
   * `get_messages`). `ui`: what Pi's extensions show now, as the `extension_ui_request` records that said so: the latest
   * status, widget and title, and the dialogs still waiting for an `answer`. */
  records: method(Type.Object({ window: Type.String(), after: Type.Optional(id) }),
    Type.Object({ seq: id, records: Type.Array(Type.Object({ seq: id, record: PiRecord })), complete: Type.Boolean(), ui: Type.Array(PiRecord) })),
  /** Any other Pi RPC command (`get_state`, `set_model`, `get_messages`, ...), answered with Pi's `data`. Not a message to the
   * agent: that is `prompt`. */
  command: method(Type.Object({ window: Type.String(), command: PiRecord }), Type.Object({ data: Type.Optional(Type.Unknown()) })),
  /** Answers a dialog Pi asked for in an `extension_ui_request` (select, confirm, input, editor): Pi's `extension_ui_response`
   * fields, `id` and one of `value`, `confirmed` or `cancelled`. */
  answer: method(Type.Object({ window: Type.String(), id: Type.String(), value: Type.Optional(Type.String()), confirmed: Type.Optional(Type.Boolean()), cancelled: Type.Optional(Type.Boolean()) }), none),

  /** The app's settings. */
  settings: method(none, Settings),
  /** Changes the settings it names and leaves the others, and answers them all as they are kept. A `cwd` has to be a directory
   * that exists (`~` is your home folder); `null` puts back the default. */
  setSettings: method(Type.Object({ theme: Type.Optional(Theme), cwd: Type.Optional(Type.Union([Type.String(), Type.Null()])) }), Settings),
  /** What the app needs and whether it is there, as last checked; `fresh` checks again now. */
  setup: method(Type.Object({ fresh: Type.Optional(Type.Boolean()) }), Setup),
  /** Installs what is missing, or updates what is too old, where the setup says `installable`: Pi into the app's own folder,
   * pi-optchat with Pi's `pi install`. It never changes a Pi the app did not install. Answers once it has started; its
   * progress and its end come as `setup` pushes. */
  install: method(Type.Object({ what: Installed }), none),
  /** Opens a terminal in which Pi signs you in to a provider with your account, in your browser (`pi auth login`). The sign-in
   * is between you, Pi and the provider: the app starts it, and sees nothing of it. */
  signIn: method(Type.Object({ provider: Account }), none),
  /** Whether Pi can use a provider now, in Pi's own word (`pi auth check`): asked while a sign-in is under way. Refused, with
   * the command that shows it, when Pi cannot tell (its `invalid`: it cannot read its own logins). */
  signedIn: method(Type.Object({ provider: Account }), Type.Object({ status: Type.Enum(['ready', 'not_ready']) })),
};
export type Method = keyof typeof methods;
export type Params<M extends Method> = Static<(typeof methods)[M]['params']>;
export type Result<M extends Method> = Static<(typeof methods)[M]['result']>;

/** What the client sends: `id` is its own number for the request, repeated in the response. */
export const Envelope = Type.Object({ id, method: Type.String(), params: Type.Unknown() });
export type Response<M extends Method = Method> = { id: number; result: Result<M> } | { id: number; error: string };

/** What the server sends unasked, to every client: a window that changed, each record a window's Pi writes, and the settings
 * and the setup when they change. */
export const Push = Type.Union([
  Type.Object({ push: Type.Literal('window'), window: WindowState }),
  Type.Object({ push: Type.Literal('record'), window: Type.String(), seq: id, record: PiRecord }),
  Type.Object({ push: Type.Literal('settings'), settings: Settings }),
  Type.Object({ push: Type.Literal('setup'), setup: Setup }),
]);
export type Push = Static<typeof Push>;
export type ServerMessage = Response | Push;
