# The server

A small local server between the UI and pi-optchat. It is a client, never a second brain: it reads a profile's memory from disk through `pi-optchat/core`, and it runs each window as one `pi --mode rpc` process. Pi and pi-optchat do all the work; the server starts and stops them, passes commands in, and pushes out what Pi writes.

## Run it

```bash
npm install
npm start                 # builds the UI, then http://127.0.0.1:4780/ (the protocol is at ws://127.0.0.1:4780/ws)
npm run server            # the same without building the UI first
```

It needs Node 22.19 or newer and a `pi` on the PATH with pi-optchat installed (`pi install npm:pi-optchat`). Options: `--port` and `--cwd <dir>` (where windows run unless a window names its own; your home directory by default). `OPTCHAT_HOME` picks the profiles' root, as in pi-optchat. Ctrl+C stops every Pi in order, connected windows before the main one they hand off to, so each saves its memory and frees its profile.

```bash
npm run check             # types
npm test                  # against a fake Pi: no model, no network
npm run test:live         # real turns through your Pi on throwaway profiles (about a cent)
PI_OPTCHAT=<checkout> npm run test:live   # the same through a pi-optchat checkout, not the one installed in Pi
```

Tests only ever use a throwaway `OPTCHAT_HOME` under `/tmp`.

## The protocol

One WebSocket at `/ws` carrying JSON. `src/protocol.ts` is the whole schema, and the UI imports its types from there; `src/client.ts` is a typed client that runs in a browser and in Node.

The client sends `{ id, method, params }` and gets `{ id, result }` or `{ id, error }`, for a method the server does not know too:

| Method | What it does |
| --- | --- |
| `profiles` | The profiles on disk. |
| `history { profile, before?, limit? }` | A page of the log, read from disk: the messages before `before`, newest page by default. |
| `view { profile }` | The lines the agent sees this turn, as `{ id, n, text? }`: the `n` messages from `id` on. |
| `zoom { profile, id, n }` | Opens a line into the two lines under it. |
| `windows` | Every window and its state. |
| `open { profile, role?, cwd? }` | The profile's main window (always the same one), or a new connected window. Starts nothing. `cwd` is where the window runs, set when it is first opened. |
| `prompt { window, text, images?, whenBusy? }` | Sends your message, starting the window's Pi if it has none. In a run it is queued (`steer` by default, or `followUp`). Answers Pi's `disposition`: `started`, `queued` or `handled`. |
| `abort { window }` | Stops the run, and returns the messages that were still queued. |
| `complete { window }` | A connected conversation's `/complete`: it writes its handoff and the main chat gets it. Its next prompt begins a new conversation. |
| `close { window }` | Stops the window's Pi cleanly. A connected window leaves the list. |
| `records { window, after? }` | For a client that connects late: the records the window still keeps after number `after`, the number of its last record (`seq`), and what Pi shows now (`ui`). |
| `command { window, command }` | Any other Pi RPC command (`get_state`, `set_model`, `get_messages`, ...). |
| `answer { window, id, ... }` | Answers a dialog Pi asked for (an `extension_ui_request` with method `select`, `confirm`, `input` or `editor`). |

The server pushes two things to every client:

- `{ push: 'window', window }` when a window changes: its `status` (`stopped`, `starting`, `idle`, `running`, or `closed`), `error` if its Pi failed, and `completed` once a connected window's conversation is handed off.
- `{ push: 'record', window, seq, record }` for every record Pi writes: its session events and extension UI requests, passed through as they are (Pi's `docs/json.md` and `docs/rpc-extension-ui.md`).

A profile's images are plain HTTP: `GET /images/<profile>/<name>` for a message's `[image <name>]`. Every other path is a file of the built UI (`dist/ui`, [ui.md](ui.md)), with the page at `/`.

### Connecting late

Windows live in the server, so they survive a client that goes away. Each window numbers its records (`seq`) and keeps everything since its latest run began, without the streaming updates a finished message or tool call made redundant. A client that connects, or comes back, asks `windows`, then `records { window, after: <last seq it saw> }` for each. The answer has:

- `records`: what it missed of the latest run, and `seq`, the number of the window's last record, so the client knows where the pushes go on even when it missed nothing.
- `complete`: false when there were records before those. What they said is in the profile's log by then for the window whose Pi owns the profile (`history`), and only in Pi for a connected window, whose conversation is not part of the log until its handoff: ask it with `command` and Pi's `get_messages`.
- `ui`: what Pi's extensions show now, as the `extension_ui_request` records that said so: the latest status per key (pi-optchat's `optchat` line among them), widget and title, and the dialogs still waiting for an `answer`. These are kept apart from the run's records, since a status set at startup still stands many runs later.

A run's finished messages are in `history` as soon as pi-optchat has logged them, and in `records` as well. Which log entries a live message became is not something the server can tell yet: one message becomes several entries with the same date.

## Windows

- **Main window.** `open` gives it at once; its Pi starts on the first `prompt`, with `--optchat-profile <name> --optchat-connect off`. Until then nothing holds the profile, so a terminal Pi can still open it. The main window never joins a profile a Pi outside the app holds: its start fails with who holds it.
- **Connected windows.** A second Pi on a profile joins the first as a connected window: its own conversation, the profile's memory read-only, and a handoff to the main chat on Complete. The server starts it with `--optchat-connect join`, after the main window's Pi if the profile has no owner yet. This needs the pi-optchat after 0.11.8 (its "RPC hosts" change).
- **`role` is the window's place in the app and never changes.** The main window's Pi owns the profile and a connected window's Pi joins it; the server starts them that way, so nothing has to be read back. `completed` is pi-optchat's word (its `optchat.role` status) that a connected window's conversation is handed off.
- **A Pi that did not open its profile** is stopped, and the prompt fails with the reason (for example pi-optchat's `Profile already running: …`, or that pi-optchat is not installed), instead of a window that looks idle and answers nothing. The server knows the profile is open when pi-optchat's `optchat` status line names it, so another extension's failure does not count.
- **Stopping.** The server closes Pi's stdin, which is Pi's request for an orderly shutdown, and kills it only if it has not exited after 15 seconds. A Pi that is still starting is stopped the same way.

## Who may connect

The windows run an agent with a shell, so the server listens on 127.0.0.1 only and checks two headers, `Host` on everything it serves and `Origin` on the WebSocket:

- `Host` must name this machine (`127.0.0.1`, `localhost`, `[::1]`): a page whose own name was pointed at 127.0.0.1 is refused.
- `Origin`, which a browser always sends on a WebSocket, must be the server's own page (`http://127.0.0.1:<port>` or `http://localhost:<port>`), or one of `startServer`'s `origins`: that option is for a desktop shell, which loads the UI from its own scheme (T3 Code's is `t3code://app`), and for Vite's address in `npm run dev`. Another program's page on this machine is refused like any other. A client that is not a browser sends no `Origin`.

The page is sent with `X-Frame-Options: DENY` and a `Content-Security-Policy` that lets it load only from the server itself, so no other page can frame it and nothing the agent writes can make it fetch an address elsewhere.

## From T3 Code

The Pi handling follows [T3 Code](https://github.com/pingdotgg/t3code)'s Pi adapter in what it does, with none of its code: each Pi in its own process group, records split on line feeds only, prompts always sent with a queueing behaviour so one that lands as a run starts is queued instead of failing, `clear_queue` before `abort`, and numbered records for catching up.
