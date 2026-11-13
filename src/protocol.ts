import type { Entry } from 'pi-optchat/core';
import type { RunState } from 'pi-optchat/files';
import { Type, type Static, type TSchema } from 'typebox';
import { THINKING } from './models.ts';

/** The protocol between the app's server and its UI: one WebSocket carrying JSON. The client sends requests and gets one response
 * each; the server also pushes what happens in windows. Every type the UI needs is inferred from the schemas in this file, which
 * imports nothing from Node. */

const id = Type.Integer({ minimum: 0 });

/** A message of a profile's log, as pi-optchat keeps it (its `Entry`): `user` (your words), `talk` (the agent's replies), `tool`
 * and `echo` (tool calls and results), `note`, `work` (subagent reports). One with an `origin` is imported history. */
export const Message = Type.Unsafe<Entry>({});
export type Message = Entry;

/** A line of the summary tree, in pi-optchat's own notation: the `n` messages from `id` on, summarized in `text` as pi-optchat
 * keeps it. No `text` means its summary is not built yet. `from` and `to` are the dates of its earliest and latest message. */
export const Line = Type.Object({ id, n: Type.Integer({ minimum: 1 }), text: Type.Optional(Type.String()), from: Type.String(), to: Type.String() });
export type Line = Static<typeof Line>;

/** A record Pi wrote in RPC mode, passed through as it is: a session event (`agent_start`, `message_update`, `tool_execution_end`,
 * ...) or an `extension_ui_request`. Pi's docs (rpc.md, json.md, rpc-extension-ui.md) define them; the server reads only what tells it a window's state. */
export const PiRecord = Type.Intersect([Type.Object({ type: Type.String() }), Type.Record(Type.String(), Type.Unknown())]);
export type PiRecord = Static<typeof PiRecord>;

/** A model and how hard it thinks, as pi-optchat names one in a profile (its `ModelChoice`): Pi's `provider`, the model's id
 * there, and one of Pi's thinking levels. */
const Thinking = Type.Enum([...THINKING]);
export const ModelChoice = Type.Object({ provider: Type.String(), model: Type.String(), thinking: Thinking });
export type ModelChoice = Static<typeof ModelChoice>;
/** A model Pi can use now, as Pi lists it: its `name`, and the `levels` it can think at (`off` alone for one that does not
 * reason). */
export const Offered = Type.Object({ provider: Type.String(), id: Type.String(), name: Type.String(), levels: Type.Array(Thinking) });
export type Offered = Static<typeof Offered>;

/** A window is a conversation in the app, and one Pi process when it runs. `role` is its place in the app and never changes: the
 * profile's `main` chat, or a `connected` window beside it, whose conversation ends in a handoff to the main chat.
 * The main window's Pi owns the profile. While a Pi outside the app holds it (one in a terminal), the main window says who in
 * `outside` (`unknown` when that Pi does not say) and takes no prompt; a connected window's Pi only ever joins, that one too. `completed` is pi-optchat's word that a
 * connected window's conversation is handed off; its next prompt begins a new conversation in it, and `since` is then when the
 * last one was handed off, as pi-optchat says it: what its Pi said before then belongs to conversations the main chat has.
 * `stopped`: no process (not started yet, closed, or it exited: `error` says why if it failed). `idle` and `running`: whether the
 * agent is in a run. `closed`: a connected window that is gone, pushed once as it leaves the list. `seq` is the number of the last
 * record the window pushed. `cwd` is where its Pi runs, set when the window is first opened.
 * `model` is what its agent runs on: its Pi's own word once that runs. Before, it is the model you picked for the window,
 * which its Pi is given as it starts, or for the main chat the one it was last on, which pi-optchat keeps in the profile and
 * starts it on. With neither it is absent: the window starts on Pi's default, which `models` tells. */
export const WindowState = Type.Object({
  id: Type.String(), profile: Type.String(), role: Type.Enum(['main', 'connected']), cwd: Type.String(),
  status: Type.Enum(['stopped', 'starting', 'idle', 'running', 'closed']), seq: id,
  completed: Type.Optional(Type.Boolean()), since: Type.Optional(Type.Number()), error: Type.Optional(Type.String()),
  outside: Type.Optional(Type.Union([Type.Object({ pid: Type.Integer(), host: Type.String(), cwd: Type.String() }), Type.Literal('unknown')])),
  model: Type.Optional(ModelChoice),
});
export type WindowState = Static<typeof WindowState>;

/** An issue or pull request the chat named: `repo` is `owner/name`, `at` the last message that names it, `url` its address,
 * made from those parts. `kind` is what the address says until GitHub has said. The rest is
 * GitHub's, and absent until it has answered, or when it does not show the item to this login: `state` (a `draft` is an open pull
 * request that is one), and for an open pull request how its `checks` stand and what its `review` came to. */
export const GitHubItem = Type.Object({
  repo: Type.String(), number: Type.Integer({ minimum: 1 }), url: Type.String(), kind: Type.Enum(['pull', 'issue']), at: id,
  title: Type.Optional(Type.String()), state: Type.Optional(Type.Enum(['open', 'draft', 'merged', 'closed'])),
  checks: Type.Optional(Type.Enum(['passing', 'failing', 'pending'])), review: Type.Optional(Type.Enum(['approved', 'changes_requested', 'review_required'])),
});
export type GitHubItem = Static<typeof GitHubItem>;

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
 * (`providers`: those that are; `models`: the models Pi lists for them, each as `provider/id`; `terminal`: the app can open a terminal here for Pi's sign-in, `signIn`). `job` is an install the app is running, or the last one it ran: `line` is the latest line it
 * printed, and `output` the end of everything it printed once it has failed. */
export const Setup = Type.Object({
  pi: Type.Intersect([Need, Type.Object({ shell: Type.Optional(Type.String()) })]),
  optchat: Need,
  login: Type.Intersect([Need, Type.Object({ providers: Type.Array(Type.String()), models: Type.Array(Type.String()), terminal: Type.Optional(Type.Boolean()) })]),
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

/** One of a profile's settings, as pi-optchat describes it (its `SETTINGS`) and as the profile has it (`value`). A `toggle` is
 * on or off; a `number` is whole, from `min` to `max` where it has them, of a `unit` where it has one; a `percent` is kept as
 * a fraction of 1. `applies` says when a change takes hold. */
export const Setting = Type.Object({
  key: Type.String(), kind: Type.Enum(['number', 'toggle', 'percent']), label: Type.String(), description: Type.String(), applies: Type.String(),
  value: Type.Union([Type.Number(), Type.Boolean()]), default: Type.Union([Type.Number(), Type.Boolean()]),
  min: Type.Optional(Type.Number()), max: Type.Optional(Type.Number()), unit: Type.Optional(Type.String()),
});
export type Setting = Static<typeof Setting>;
/** What pi-optchat keeps of a profile for you to change: its `settings`, in pi-optchat's order; the model that writes its
 * summaries (`compactor`, a new profile's being `standard`) and the one its agents run on (`subagent`); and its
 * `instructions`, the profile's AGENTS.md, which its agents are given every turn. */
export const Config = Type.Object({ settings: Type.Array(Setting), compactor: ModelChoice, standard: ModelChoice, subagent: ModelChoice, instructions: Type.String() });
export type Config = Static<typeof Config>;

const Image = Type.Object({ type: Type.Literal('image'), data: Type.String(), mimeType: Type.String() });
const target = Type.Object({ window: Type.String() });
const none = Type.Object({});
const method = <P extends TSchema, R extends TSchema>(params: P, result: R) => ({ params, result });

/** Every request: what it takes and what it answers. */
export const methods = {
  /** The profiles on disk. */
  profiles: method(none, Type.Object({ profiles: Type.Array(Type.Object({ name: Type.String() })) })),
  /** Makes a new, empty profile, as pi-optchat makes one (its `createProfile`): refused when the name is not one pi-optchat
   * takes, or is taken. Of a profile that exists, the app changes only its settings and its instructions (`configure`, `instruct`), and those by pi-optchat's hand too. */
  createProfile: method(Type.Object({ name: Type.String() }), none),
  /** A page of a profile's log, read from disk: the `limit` messages before message `before` (the newest ones by default),
   * oldest first. `total` is how many messages the log has. */
  history: method(Type.Object({ profile: Type.String(), before: Type.Optional(id), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
    Type.Object({ total: id, messages: Type.Array(Message) })),
  /** The memory view: the lines the agent reads its memory as, oldest first, tiling the whole log. `size` is how many bytes
   * they are as the agent gets them, of the `budget` pi-optchat keeps the view under. It is read from the profile's files, so
   * it can trail a running chat by what its Pi has not written yet. `memory` names the memory it is of: a line is the same
   * line only for as long as that stays. */
  view: method(Type.Object({ profile: Type.String() }), Type.Object({ memory: Type.String(), total: id, lines: Type.Array(Line), size: id, budget: id })),
  /** Opens line `id`+`n` into the two lines of `n`/2 under it (`n` at least 2; a line of one message opens with `original`). */
  zoom: method(Type.Object({ profile: Type.String(), id, n: Type.Integer({ minimum: 2 }) }), Type.Object({ lines: Type.Array(Line) })),
  /** Message `id` as it was said, under a line of one message. A tool call comes with what it printed, and what a tool
   * printed with its call, since the chat draws the two as one row. */
  original: method(Type.Object({ profile: Type.String(), id }), Type.Object({ messages: Type.Array(Message) })),

  /** A profile's subagents, read from disk: those at work, and the newest `limit` of those that have ended (30 unless said);
   * `more` is how many ended ones that leaves out. No Pi is asked, so the list is there whether or not one runs. */
  agents: method(Type.Object({ profile: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 0 })) }), Type.Object({ agents: Type.Array(Agent), more: id })),
  /** One agent's chat, from its Pi session file: its messages as Pi wrote them (Pi's docs: session.md), from number `after` on,
   * of `total`. The first is its task, without the view of the profile's memory it was sent with, and images are left out.
   * `report` is what it reported, whole, and `ended` when it ended. `queued`: your messages to it that it has not read yet
   * (`tellAgent`). An agent there is no record of has no messages. */
  agent: method(Type.Object({ profile: Type.String(), id: Type.String(), after: Type.Optional(id) }),
    Type.Object({ total: id, messages: Type.Array(Type.Unknown()), report: Type.Optional(Type.String()), ended: Type.Optional(Type.Number()), queued: Type.Optional(Type.Array(Type.String())) })),
  /** Your message to one of a profile's agents, through the Pi that has the profile open (pi-optchat's `attachAgent`), which
   * is the only one that reaches it: the main window's Pi is started first if no Pi has it. An agent at work reads the message
   * after its current tool calls; one that has ended goes on with it in its earlier conversation, and its new report goes to
   * the agent that started it (`resumed`). The server picks by how pi-optchat's record of the agent stands. pi-optchat can
   * refuse, and the error is its own words: only the main agent's own agents are resumed, not the agents those started. */
  tellAgent: method(Type.Object({ profile: Type.String(), id: Type.String(), text: Type.String() }), Type.Object({ resumed: Type.Boolean() })),
  /** Cuts an agent's current step, as Esc does in its terminal view: it goes on at once with your messages it has not read
   * yet, or else waits (`paused`) for the next one. It ends nothing. */
  interruptAgent: method(Type.Object({ profile: Type.String(), id: Type.String() }), none),
  /** Ends an agent and the agents it started. The agent that started it gets a report that says you stopped it. */
  stopAgent: method(Type.Object({ profile: Type.String(), id: Type.String() }), none),

  /** The issues and pull requests the profile's main chat named by their address on github.com, with what GitHub says of
   * them: the open ones first, then the latest named, `limit` of them (30 unless said), and `more` for how many that leaves
   * out. They are found in the log each time, so nothing of them is kept. What GitHub says is asked through the GitHub CLI
   * (`gh`) with the login it has, after the answer: `pending` is how many items it is being asked about, which a look a
   * moment later has the news of. `gh` says how the last asking went: `missing` (no `gh`), `signed_out`, or `failed`
   * (`message` has why). The list is there either way, without the status. A `gh` that could not ask is tried again by a look
   * a few seconds later, or at once by one that is `fresh`, and such a look waits for it. */
  github: method(Type.Object({ profile: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 0 })), fresh: Type.Optional(Type.Boolean()) }),
    Type.Object({ items: Type.Array(GitHubItem), more: id, pending: id, gh: Type.Enum(['ok', 'missing', 'signed_out', 'failed']), message: Type.Optional(Type.String()) })),

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
  /** The models the window's agent can run on: those of the providers Pi is logged in to. The window's Pi is asked; when it
   * has none yet, a Pi that only answers this is, and `preset` is then what a Pi started now runs on by itself. */
  models: method(Type.Object({ window: Type.String() }), Type.Object({ models: Type.Array(Offered), preset: Type.Optional(ModelChoice) })),
  /** Picks the model of the window's agent and how hard it thinks, at once and in the middle of a run too: the request under
   * way keeps its model and the next is made with the new one. A window with no Pi yet keeps the pick for when it starts.
   * The main chat's pick is the profile's from then on (pi-optchat keeps it); a connected window's is that window's alone.
   * Refused for a main chat a Pi outside the app runs, whose model is picked there. The window's `model` then says what it
   * runs on, which is Pi's word: a level the model has not got becomes the nearest it has. */
  setModel: method(Type.Object({ window: Type.String(), model: ModelChoice }), none),
  /** Answers a dialog Pi asked for in an `extension_ui_request` (select, confirm, input, editor): Pi's `extension_ui_response`
   * fields, `id` and one of `value`, `confirmed` or `cancelled`. */
  answer: method(Type.Object({ window: Type.String(), id: Type.String(), value: Type.Optional(Type.String()), confirmed: Type.Optional(Type.Boolean()), cancelled: Type.Optional(Type.Boolean()) }), none),

  /** A profile's settings and instructions as pi-optchat keeps them, read from its files. */
  config: method(Type.Object({ profile: Type.String() }), Config),
  /** Changes one thing of a profile's settings, and answers them as they then are: a setting by its `key`, or the model
   * `compactor` or `subagent`. pi-optchat makes the change (its `updateConfig`) and is its judge: the Pi that has the profile
   * open applies it at once, and with none the profile's file is changed under its lock. Refused in pi-optchat's words. */
  configure: method(Type.Object({ profile: Type.String(), key: Type.String(), value: Type.Union([Type.Number(), Type.Boolean(), ModelChoice]) }), Config),
  /** Keeps a profile's instructions (pi-optchat's `saveInstructions`). Its agents read them again each turn. */
  instruct: method(Type.Object({ profile: Type.String(), text: Type.String() }), none),

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
