# The server

A small local server between the UI and pi-optchat. It is a client, never a second brain: it reads a profile's memory from disk through `pi-optchat/core`, and it runs each window as one `pi --mode rpc` process. Pi and pi-optchat do all the work; the server starts and stops them, passes commands in, and pushes out what Pi writes.

## Run it

```bash
npm install
npm run server            # ws://127.0.0.1:4780/ws
```

It needs Node 22.19 or newer and a `pi` on the PATH with pi-optchat installed (`pi install npm:pi-optchat`). Options: `--port`, `--host`, `--cwd <dir>` (where windows run unless a window names its own; your home directory by default), `--pi <command>`, and after `--` any more arguments for Pi. `OPTCHAT_HOME` picks the profiles' root, as in pi-optchat. Ctrl+C stops every Pi in order, so each saves its memory and frees its profile.

```bash
npm run check             # types
npm test                  # against a fake Pi: no model, no network
npm run test:live         # real turns through your Pi on throwaway profiles (about a cent)
```

Tests only ever use a throwaway `OPTCHAT_HOME` under `/tmp`.

## The protocol

One WebSocket at `/ws` carrying JSON. `src/protocol.ts` is the whole schema, and the UI imports its types from there; `src/client.ts` is a typed client that runs in a browser and in Node.

The client sends `{ id, method, params }` and gets `{ id, result }` or `{ id, error }`:

| Method | What it does |
| --- | --- |
| `profiles` | The profiles on disk. |
| `history { profile, before?, limit? }` | A page of the log, read from disk: the messages before `before`, newest page by default. |
| `view { profile }` | The lines the agent sees this turn, as `{ id, n, text? }`: the `n` messages from `id` on. |
| `zoom { profile, id, n }` | Opens a line into the two lines under it. |
| `windows` | Every window and its state. |
| `open { profile, role?, cwd? }` | The profile's main window (always the same one), or a new connected window. Starts nothing. |
| `prompt { window, text, images?, whenBusy? }` | Sends your message, starting the window's Pi if it has none. In a run it is queued (`steer` by default, or `followUp`). Answers Pi's `disposition`: `started`, `queued` or `handled`. |
| `abort { window }` | Stops the run, and returns the messages that were still queued. |
| `complete { window }` | A connected window's `/complete`: it writes its handoff and the main chat gets it. |
| `close { window }` | Stops the window's Pi cleanly. A connected window leaves the list. |
| `records { window, after? }` | The records the window still keeps after number `after`, to catch up. |
| `command { window, command }` | Any other Pi RPC command (`get_state`, `set_model`, `get_messages`, ...). |
| `answer { window, id, ... }` | Answers a dialog Pi asked for (`extension_ui_request`). |

The server pushes two things to every client:

- `{ push: 'window', window }` when a window changes: `stopped`, `starting`, `idle`, `running` (or `closed`), its `role`, and `error` if its Pi failed.
- `{ push: 'record', window, seq, record }` for every record Pi writes: its session events and extension UI requests, passed through as they are (Pi's `docs/json.md` and `docs/rpc-extension-ui.md`).

A profile's images are plain HTTP: `GET /images/<profile>/<name>` for a message's `[image <name>]`.

### Reconnecting

Windows live in the server, so they survive a client that goes away. Each window numbers its records (`seq`) and keeps everything since its latest run began, without the streaming updates a finished message or tool call made redundant. A client that comes back asks `windows`, then `records { window, after: <last seq it saw> }` for each. `complete: false` in the answer means records before the first one returned are gone (an earlier run, or a run too large to keep): rebuild from `history` then. Messages in `history` carry Pi's own timestamps, so a log entry and a live message with the same time are the same message.

## Windows

- **Main window.** `open` gives it at once; its Pi starts on the first `prompt`, with `--optchat-profile <name>`. Until then nothing holds the profile, so a terminal Pi can still open it.
- **Connected windows.** A second Pi on a profile joins the first as a connected window: its own conversation, the profile's memory read-only, and a handoff to the main chat on Complete. The server starts the main window's Pi first if the profile has no owner. pi-optchat says which role a Pi got, and the window's `role` follows it: if a terminal Pi owns the profile, the app's main window is a connected one too. **This needs the pi-optchat after 0.11.8** (its "RPC hosts" change); on 0.11.8 a connected window fails to start and says so.
- **A Pi that cannot open its profile** is stopped, and the prompt fails with pi-optchat's reason (for example `Profile already running: …`), instead of a window that looks idle and answers nothing.
- **Stopping.** The server closes Pi's stdin, which is Pi's request for an orderly shutdown, and kills it only if it has not exited after 15 seconds.

Only pages served from this machine may connect: the server listens on 127.0.0.1 and refuses a WebSocket from any other origin, since its windows run an agent with a shell.

## From T3 Code

The Pi handling follows [T3 Code](https://github.com/pingdotgg/t3code)'s Pi adapter in what it does, with none of its code: each Pi in its own process group, records split on line feeds only, prompts always sent with a queueing behaviour so one that lands as a run starts is queued instead of failing, `clear_queue` before `abort`, and numbered records for catching up.
