import type { Entry } from 'pi-optchat/core';
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
 * `owner` and `completed` are what pi-optchat says of the running Pi: whether it owns the profile (a connected window never
 * does; a main window does unless a Pi outside the app got there first), and whether the conversation is handed off. A
 * completed window's next prompt begins a new conversation in it.
 * `stopped`: no process (not started yet, closed, or it exited: `error` says why if it failed). `idle` and `running`: whether the
 * agent is in a run. `closed`: a connected window that is gone, pushed once as it leaves the list. `seq` is the number of the last
 * record the window pushed. `cwd` is where its Pi runs, set when the window is first opened. */
export const WindowState = Type.Object({
  id: Type.String(), profile: Type.String(), role: Type.Enum(['main', 'connected']), cwd: Type.String(),
  status: Type.Enum(['stopped', 'starting', 'idle', 'running', 'closed']), seq: id,
  owner: Type.Optional(Type.Boolean()), completed: Type.Optional(Type.Boolean()), error: Type.Optional(Type.String()),
});
export type WindowState = Static<typeof WindowState>;

const Image = Type.Object({ type: Type.Literal('image'), data: Type.String(), mimeType: Type.String() });
const target = Type.Object({ window: Type.String() });
const none = Type.Object({});
const method = <P extends TSchema, R extends TSchema>(params: P, result: R) => ({ params, result });

/** Every request: what it takes and what it answers. */
export const methods = {
  /** The profiles on disk. */
  profiles: method(none, Type.Object({ profiles: Type.Array(Type.Object({ name: Type.String() })) })),
  /** A page of a profile's log, read from disk: the `limit` messages before message `before` (the newest ones by default),
   * oldest first. `total` is how many messages the log has. */
  history: method(Type.Object({ profile: Type.String(), before: Type.Optional(id), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
    Type.Object({ total: id, messages: Type.Array(Message) })),
  /** The view: the lines the agent sees this turn, oldest first, tiling the whole log. */
  view: method(Type.Object({ profile: Type.String() }), Type.Object({ total: id, lines: Type.Array(Line) })),
  /** Opens line `id`+`n` into the two lines of `n`/2 under it (`n` at least 2; a single message is a `history` page of one). */
  zoom: method(Type.Object({ profile: Type.String(), id, n: Type.Integer({ minimum: 2 }) }), Type.Object({ lines: Type.Array(Line) })),

  /** Every window the server knows. */
  windows: method(none, Type.Object({ windows: Type.Array(WindowState) })),
  /** A profile's main window (the same one each time), or a new connected window. No Pi starts until its first prompt; a
   * connected window's first prompt starts the main window's Pi too if the profile has no owner yet. */
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
   * is written, which takes a turn of the window's agent. */
  complete: method(target, none),
  /** Stops the window's Pi, letting it shut down cleanly. A main window stays in the list and starts again on its next prompt;
   * a connected window leaves it. */
  close: method(target, none),
  /** For a client that connects late. `records`: what the window pushed after number `after` and still keeps, which is
   * everything since its latest run began. `complete` is false when there were more before these: a main window's are in
   * `history` by now, a connected window's only in its Pi (`command` with Pi's `get_messages`). `ui`: what Pi's extensions
   * show now, as the `extension_ui_request` records that said so: the latest status, widget and title, and the dialogs still
   * waiting for an `answer`. */
  records: method(Type.Object({ window: Type.String(), after: Type.Optional(id) }),
    Type.Object({ records: Type.Array(Type.Object({ seq: id, record: PiRecord })), complete: Type.Boolean(), ui: Type.Array(PiRecord) })),
  /** Any other Pi RPC command (`get_state`, `set_model`, `get_messages`, ...), answered with Pi's `data`. */
  command: method(Type.Object({ window: Type.String(), command: PiRecord }), Type.Object({ data: Type.Optional(Type.Unknown()) })),
  /** Answers a dialog Pi asked for in an `extension_ui_request` (select, confirm, input, editor): Pi's `extension_ui_response`
   * fields, `id` and one of `value`, `confirmed` or `cancelled`. */
  answer: method(Type.Object({ window: Type.String(), id: Type.String(), value: Type.Optional(Type.String()), confirmed: Type.Optional(Type.Boolean()), cancelled: Type.Optional(Type.Boolean()) }), none),
};
export type Method = keyof typeof methods;
export type Params<M extends Method> = Static<(typeof methods)[M]['params']>;
export type Result<M extends Method> = Static<(typeof methods)[M]['result']>;

/** What the client sends: `id` is its own number for the request, repeated in the response. */
export const Envelope = Type.Object({ id, method: Type.String(), params: Type.Unknown() });
export type Response<M extends Method = Method> = { id: number; result: Result<M> } | { id: number; error: string };

/** What the server sends unasked, to every client: a window that changed, and each record a window's Pi writes. */
export const Push = Type.Union([
  Type.Object({ push: Type.Literal('window'), window: WindowState }),
  Type.Object({ push: Type.Literal('record'), window: Type.String(), seq: id, record: PiRecord }),
]);
export type Push = Static<typeof Push>;
export type ServerMessage = Response | Push;
