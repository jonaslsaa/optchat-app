# The server

A small local server between the UI and pi-optchat. It is a client, never a second brain: it reads a profile's memory from disk through `pi-optchat/files`, and it runs each window as one `pi --mode rpc` process. Pi and pi-optchat do all the work; the server starts and stops them, passes commands in, and pushes out what Pi writes.

## Run it

```bash
npm install
npm start                 # builds the UI, then http://127.0.0.1:4780/ (the protocol is at ws://127.0.0.1:4780/ws)
npm run server            # the same without building the UI first
```

It needs Node 22.19 or newer, and Pi with pi-optchat 0.11.13 or newer in it (`pi install npm:pi-optchat`): the `pi` on your PATH, or else the one the app installs for you ([setup.md](setup.md)). Options: `--port` and `--cwd <dir>` (where windows run unless a window names its own; your home directory by default). `OPTCHAT_HOME` picks the profiles' root, as in pi-optchat. Ctrl+C stops every Pi in order, connected windows before the main one they hand off to, so each saves its memory and frees its profile.

```bash
npm run check             # types
npm test                  # against a fake Pi: no model, no network
npm run test:ui           # the built page in your installed Chrome, headless, against the fake Pi: keys and focus
npm run test:live         # real turns through your Pi and its model login, on throwaway profiles (about a cent)
PI_OPTCHAT=<checkout> npm run test:live   # the same through a pi-optchat checkout, not the one installed in Pi
```

Tests only ever use a throwaway `OPTCHAT_HOME` under `/tmp`, and a throwaway folder for the app's own files (`OPTCHAT_APP_HOME`). `startServer` has to be told where its Pis run (`cwd`: a window's, and one that is only asked its version or its models), so no test starts one in your home folder; the app itself names that folder.

## The protocol

One WebSocket at `/ws` carrying JSON. `src/protocol.ts` is the whole schema, and the UI imports its types from there; `src/client.ts` is a typed client that runs in a browser and in Node.

The client sends `{ id, method, params }` and gets `{ id, result }` or `{ id, error }`, for a method the server does not know too:

| Method | What it does |
| --- | --- |
| `profiles` | The profiles on disk. |
| `createProfile { name }` | Makes a new, empty profile with pi-optchat's own `createProfile`. Refused when pi-optchat does not take the name, or it is taken. |
| `history { profile, before?, limit? }` | A page of the log, read from disk: the messages before `before`, newest page by default. |
| `view { profile }` | The lines the agent sees this turn, as `{ id, n, text?, from, to }`: the `n` messages from `id` on, said between `from` and `to` (the earliest and the latest date among them: imported history is not always in order). A line without `text` is not summarized yet. With them, `total` (messages in the log), the view's `size` of its `budget`, in bytes, and `memory`, a name for the memory it is of (its directory and when it begins): the lines are other lines once that changes. Read from the profile's files, so it can trail a running chat by what its Pi has not written yet. |
| `zoom { profile, id, n }` | Opens a line into the two lines under it. |
| `original { profile, id }` | Message `id` as it was said, for a line of one message. A tool call comes with what it printed and what a tool printed with its call, which the chat draws as one row; the two are found by pi-optchat's own rule (a message's calls are followed by their results in the same order, and a result starts with its call's tool name). |
| `search { profile, text, before? }` | The messages that contain `text`, found by pi-optchat's own `Memory.search`, which is what the agent's `search` tool runs: the messages as they were said (never summaries, nor a logged zoom or search), in any case, newest first. `hits` are the newest 20 before message `before` (of all, without it), each as `{ id, kind, date, imported?, lead, match, rest }`: the stretch around where the message first says it, 40 characters before the match and 160 after, with the match as the message writes it. `more` is how many older ones there are. |
| `agents { profile, limit? }` | The profile's subagents, from pi-optchat's records of them on disk: those at work, and the newest `limit` (30) of those that ended, with `more` for how many that leaves out. Each has its `state`, title, task, times, the agent that started it (`parent`), the tool calls it is waiting on (`doing`) and the first line of its report (`headline`). One saved as working is `interrupted` when no Pi has the profile open. |
| `agent { profile, id, after? }` | An agent's chat, from its Pi session file: its messages from number `after` on, of `total`, its whole `report`, and when it `ended`. The first message is its task alone, and images are left out. `queued` is what you told it and it has not read yet. |
| `tellAgent { profile, id, text }` | Your message to an agent. One at work reads it after its current tool calls; one that has ended goes on with it in its earlier conversation (`resumed`), and its new report goes to the agent that started it. The server picks by pi-optchat's record of the agent. See [Agents](#agents). |
| `interruptAgent { profile, id }` | Cuts the agent's current step: it goes on at once with your messages it has not read, or else waits for the next one. It ends nothing. |
| `stopAgent { profile, id }` | Ends the agent and the agents it started. The agent that started it gets a report that says you stopped it. |
| `github { profile, limit?, fresh? }` | The issues and pull requests the profile's main chat named by their address on github.com, found in the log each time: the open ones first, then the latest named, `limit` (30) of them, with `more` for how many that leaves out. Each has its `repo`, `number`, `url` and `kind`, and from GitHub its `title`, `state` (`open`, `draft`, `merged`, `closed`), and for an open pull request its `checks` and `review`. GitHub is asked through the GitHub CLI after the answer, so `pending` says how many items are being asked about, and `gh` how the last asking went (`ok`, `missing`, `signed_out`, `failed` with a `message`). See [GitHub](#github). |
| `windows` | Every window and its state. |
| `open { profile, role?, cwd? }` | The profile's main window (always the same one), or a new connected window. Starts nothing. `cwd` is where the window runs, set when it is first opened. |
| `prompt { window, text, images?, whenBusy? }` | Sends your message, starting the window's Pi if it has none. In a run it is queued (`steer` by default, or `followUp`). Answers Pi's `disposition`: `started`, `queued` or `handled`. |
| `abort { window }` | Stops the run, and returns the messages that were still queued. |
| `complete { window }` | A connected conversation's `/complete`: it writes its handoff and the main chat gets it. Until it has answered, the window takes no prompt; its next prompt begins a new conversation, and the window's `since` then says when the last one was handed off: pi-optchat's own cut (`after` in its `optchat.role`), the one its agent reads from. |
| `close { window }` | Stops the window's Pi cleanly. A connected window leaves the list. |
| `records { window, after? }` | For a client that connects late: the records the window still keeps after number `after`, the number of its last record (`seq`), and what Pi shows now (`ui`). |
| `command { window, command }` | Any other Pi RPC command (`get_state`, `set_model`, `get_messages`, ...). A message to the agent is not one of them: that is `prompt`. |
| `commands { window }` | The commands the window's Pi runs for a message that begins with `/` and their name (Pi's `get_commands`): each with its `name`, its `description` if it has one, and its `source` (`extension`, `prompt` or `skill`). They come from the Pi's extensions, prompt templates and skills, so the window's Pi is started for the question, as for a first message; nothing is written to the profile's memory. A main chat's Pi that starts goes on with what waited for it (summaries still to write, a window's handoff, which begins a turn). |
| `models { window }` | The models the window's agent can run on, each with its `provider`, `id`, `name` and the `levels` it can think at: what Pi lists for the providers it is logged in to. The window's own Pi is asked; when it has none, a Pi started for the question is, and `preset` is then what a Pi started now runs on by itself. |
| `setModel { window, model }` | Picks the window's model and thinking level (`{ provider, model, thinking }`), in the middle of a run too. With no Pi yet the pick is kept and given to the window's Pi as it starts. The window's `model` then says what it runs on ([The model](#the-model)). |
| `answer { window, id, ... }` | Answers a dialog Pi asked for (an `extension_ui_request` with method `select`, `confirm`, `input` or `editor`). |
| `config { profile }` | A profile's settings as pi-optchat keeps them: every setting it has, as it describes it (its `SETTINGS`: a toggle, a whole number or a percent, with its label, what it does, its default, its range and when a change applies) with the profile's `value`; the models that write its summaries (`compactor`, and `standard`, a new profile's) and that its agents run on (`subagent`); and its `instructions` (its AGENTS.md). See [A profile's settings](#a-profiles-settings). |
| `configure { profile, key, value }` | Changes one of them, a setting by its `key` or the model `compactor` or `subagent`, and answers them all as they then are. Refused in pi-optchat's words. |
| `instruct { profile, text }` | Keeps the profile's instructions. |
| `usage { profile, range? }` | What the profile used in a range (`Last hour`, `Today` unless said, `Last 7 days`, `All time`), in tokens and dollars: all of it, each role's and each of a role's models', and its cost over time. Read from pi-optchat's usage ledger each time; nothing is written. See [Usage](#usage). |
| `settings`, `setSettings { theme?, cwd? }` | The app's own settings, and a change to the ones it names ([setup.md](setup.md)). |
| `setup { fresh? }` | What a chat needs and whether it is there: Pi, pi-optchat in it, a model that is logged in. `fresh` looks again. |
| `install { what }` | Installs or updates `pi` or `optchat` where the setup says `installable`: only the app's own Pi, and a pi-optchat from npm. Answers once it has started; the rest is pushed. |
| `signIn { provider }`, `signedIn { provider }` | Opens a terminal where Pi signs you in to `anthropic`, `openai-codex` or `github-copilot`; and whether Pi can use that provider now (`ready` or `not_ready`; refused when Pi cannot tell). The app sees nothing of the sign-in ([setup.md](setup.md)). |

The server pushes four things to every client:

- `{ push: 'window', window }` when a window changes: its `status` (`stopped`, `starting`, `idle`, `running`, or `closed`), `error` if its Pi failed, `completed` once a connected window's conversation is handed off, and the `model` it runs on.
- `{ push: 'record', window, seq, record }` for every record Pi writes: its session events and extension UI requests, passed through as they are (Pi's `docs/json.md` and `docs/rpc-extension-ui.md`).
- `{ push: 'settings', settings }` when the settings are changed, and `{ push: 'setup', setup }` as an install runs and when it ends.

A profile's images are plain HTTP: `GET /images/<profile>/<name>` for a message's `[image <name>]`. Every other path is a file of the built UI (`dist/ui`, [ui.md](ui.md)), with the page at `/`.

### Connecting late

Windows live in the server, so they survive a client that goes away. Each window numbers its records (`seq`) and keeps everything since its latest run began, without the streaming updates a finished message or tool call made redundant. A client that connects, or comes back, asks `windows`, then `records { window, after: <last seq it saw> }` for each. The answer has:

- `records`: what it missed of the latest run, and `seq`, the number of the window's last record, so the client knows where the pushes go on even when it missed nothing.
- `complete`: false when there were records before those. What they said is in the profile's log by then for the window whose Pi owns the profile (`history`), and only in Pi for a connected window, whose conversation is not part of the log until its handoff: ask it with `command` and Pi's `get_messages`.
- `ui`: what Pi's extensions show now, as the `extension_ui_request` records that said so: the latest status per key (pi-optchat's `optchat` line among them), widget and title, and the dialogs still waiting for an `answer`. These are kept apart from the run's records, since a status set at startup still stands many runs later.

A run's finished messages are in `history` as soon as pi-optchat has logged them, and in `records` as well. Which log entries a live message became is not something the server can tell yet: one message becomes several entries with the same date.

## Windows

- **Main window.** `open` gives it at once; its Pi starts on the first `prompt`, with `--optchat-profile <name> --optchat-connect off`, and with the app's own instructions ([below](#what-the-app-tells-an-agent)). Until then nothing holds the profile, so a terminal Pi can still open it. The main window never joins a profile a Pi outside the app holds: it says who that is (`outside`) and takes no prompt while that Pi has it ([setup.md](setup.md)).
- **Connected windows.** A second Pi on a profile joins the first as a connected window: its own conversation, the profile's memory read-only, and a handoff to the main chat on Complete. The server starts it with `--optchat-connect join`, after the main window's Pi if the profile has no owner yet. On a profile a Pi outside the app holds, it joins that one.
- **`role` is the window's place in the app and never changes.** The main window's Pi owns the profile and a connected window's Pi joins it; the server starts them that way, so nothing has to be read back. `completed` is pi-optchat's word (its `optchat.role` status) that a connected window's conversation is handed off.
- **A Pi that did not open its profile** is stopped, and the prompt fails with the reason (for example pi-optchat's `Profile already running: …`, or that pi-optchat is not installed or older than 0.11.13), instead of a window that looks idle and answers nothing. The server knows the profile is open when pi-optchat's `optchat.role` status names it, which it sends as the session starts; another extension's failure does not count.
- **Stopping.** The server closes Pi's stdin, which is Pi's request for an orderly shutdown, and kills it only if it has not exited after 15 seconds. A Pi that is still starting is stopped the same way.

### What the app tells an agent

One sentence, for now (`PROMPT` in `src/server/windows.ts`): when it first mentions a GitHub pull request or issue, it gives the full link. The [GitHub list](#github) finds an item by its address, and an agent left to itself writes "#12".

The server hands it to every Pi it starts for a window with Pi's own `--append-system-prompt`. Pi puts it in the system prompt as an `<addendum>` section, and pi-optchat, which replaces Pi's preamble and adds the profile's instructions, leaves that section as it is. The live test reads what Pi sends to the model and finds the sentence there, beside pi-optchat's own prompt, in the main window and in a connected one.

It reaches the agent of a window the app started and nobody else: not the agents that agent starts (pi-optchat builds their prompt itself), and not the main agent of a chat that runs in a terminal, which the app did not start.

### The model

What a window runs on is Pi's to say, and the server only passes a pick on (`models` and `setModel` in `src/server/windows.ts`, `src/server/models.ts`, `test/models.test.ts`).

- **A window's `model` is Pi's word** once its Pi runs: `get_state`, read when it has started and after each pick. A pick is Pi's `set_model` and then `set_thinking_level`, since `set_model` chooses a level of its own; a level the model has not got comes back as the nearest it has.
- **Before a Pi runs**, the main window's `model` is what pi-optchat keeps in the profile (`main` in its `config.json`, read with `loadConfig`), which is what pi-optchat starts the main chat on. It is read again whenever the server looks at who holds the profile, so a pick made in a terminal shows when the page looks. A connected window has none until it starts: it begins on Pi's default.
- **A pick with no Pi yet** is kept in the server and given to the Pi as it starts, before the first message. A Pi that cannot take it does not start, and says why; the pick stays until a Pi has taken it or another is made, so a message never goes to a model that was not picked. While a terminal has the profile the pick waits, and the window says the model the profile keeps.
- **One pick at a time** for a window. Pi takes its next command while it still sets a model, so two picks at once could leave it on the model of one with the level of the other.
- **Where a pick is kept is pi-optchat's doing.** The main chat's goes into the profile; a connected window's stays in that window's Pi. Neither changes Pi's own default: `set_model` over RPC does not save it. Checked against Pi 1.5.2 with pi-optchat 0.11.12 (`npm run test:live`).
- **A main chat a Pi outside the app runs** takes no pick from the app.
- **The list** comes from the window's own Pi, which also knows the providers its extensions add. With no Pi it comes from one started for the question, with no session, no extension and no network (`catalog`), the same one the setup asks which providers are logged in. The levels a model can think at follow pi-ai's own rule (`levels` in `src/models.ts`).

## A profile's settings

They are pi-optchat's, and so is every rule about them (`config`, `configure` and `instruct` in `src/server/profiles.ts`, `test/config.test.ts`).

- **What there is to change is asked of pi-optchat**, not written down here: `config` lists its `SETTINGS` as they are, so a setting pi-optchat gains is in the app once the app has that pi-optchat, with no change to the app.
- **pi-optchat makes the change**, with its `updateConfig`. While a Pi has the profile open, the app's or one in a terminal, that Pi is told over the profile's socket and applies it to the chat that is running, where it holds from when the setting's `applies` says. With no Pi on the profile, pi-optchat takes the profile's lock, changes `config.json` and lets go; what the file has that this pi-optchat does not know stays in it.
- **pi-optchat is the judge.** The server checks only that a value is a number, a truth value or a model, and passes it on. What pi-optchat refuses, it refuses in its own words, which the page shows as they are: a number out of its range, a model the running Pi does not offer, a Pi that takes no changes (one that is still starting, or runs headless).
- **The main model is not among them.** It follows what is picked in Pi (`set_model`, which is what the app's `setModel` sends: [The model](#the-model)), and pi-optchat refuses it here.
- **Instructions** are written with pi-optchat's `saveInstructions`. Pi reads them again each turn, so no Pi has to be told.
- **The models to choose from** are the ones the profile's main chat can run on (`models`, [The model](#the-model)): its Pi's while it runs, and else those of a Pi started for the question, so they are there with no chat running. Each comes with the levels it thinks at, which is how the page asks for a model only at a level it has: a running Pi refuses a model at a level it has not in the same words as a model it does not list. A model that is not in the list can be typed; pi-optchat says whether it will do.

## GitHub

The list is what the log says, and the status is what GitHub says (`src/server/github.ts`, `test/github.test.ts`).

- **What names an item.** An address, `https://github.com/<owner>/<repo>/pull/<n>` or `/issues/<n>`, in what you or the agent said, in an agent's report, or in a `gh pr` or `gh issue` command that is about items it names (`create`, `view`, `merge`, `checks`, `comment`, `edit`, `close`, `reopen`, `review`, `ready`) and that was run, not merely spoken of (`rg "gh pr view"`). Of what such a command printed, only the item's own address counts: the one after `url:` or `"url":`, and one that stands alone on a line, as `gh pr create` prints it. A pull request's body and comments name other people's, so nothing under the `--` that `gh pr view` prints them under is read. Not other tool output, which is full of the links of every page the agent read, and not `gh pr list`, `status` or `gh search`, which print what the chat never dealt with, nor a command that runs one of those beside the others. An item is listed once, by the last message that names it.
- **"#12" is not an item.** Nothing in the log says which repository it is in. On two real profiles about half of the items a chat spoke of were only ever written that way, and the best guess (the repository of the nearest link before it) was wrong one time in four on one of them: a wrong pull request with a live status is worse than a missing one. So the list says what it is, "PRs and issues the chat named by link", and the app asks the agents it starts to give the link.
- **Only what the pattern matched reaches `gh`.** The log holds text the agent read from anywhere. An owner, a repository and a number are letters, digits, `.`, `_` and `-`, and at most nine digits: nothing a query or a command line can be broken out of. `gh` is run as a program with its arguments in a list (`gh api graphql --hostname github.com -f query=…`), never through a shell, and asks github.com whatever host it is set to ask by default.
- **No token.** `gh` asks with the login it has. The app reads no token and keeps none; without `gh`, or signed out of it, the list is there without the status, and says which.
- **When GitHub is asked.** Only at a look, and the page looks only while the list is in sight: when it is opened, when a turn of the main chat begins or ends, and once a minute. A look answers at once with what is known and asks behind that about what is due: an item never asked about, and one that is not merged or closed and was last asked about more than 50 seconds ago (the open ones, and those GitHub said nothing of). One that is merged or closed is not asked about again while the server runs. One question covers up to 100 items (one point of the 5,000 an hour GitHub gives a login, about a second for ten and six for a hundred), three at a look at most.
- **Nothing is kept.** The log is read through at every look (about 10 ms for 20,000 messages, once it is in memory: reading a log of that size from its files takes about 0.2 s, which is why a look waits for the turn to end and is not made at every message), and what GitHub said is held in the server's memory until it stops.

## Agents

An agent lives in the Pi that has its profile open, and only that Pi reaches it. `agents` and `agent` read what that Pi writes to the profile's files, so they need no Pi. `tellAgent`, `interruptAgent` and `stopAgent` ask that Pi, through pi-optchat's `attachAgent` (`pi-optchat/files`): a connection to the socket it keeps in the profile's folder, opened for the one request and closed after it.

- **Which Pi.** The one that has the profile: the main window's, or one in a terminal. `tellAgent` starts the main window's Pi first when no Pi has the profile, since an agent that has ended can only go on in one; the other two start nothing, as there is then nothing to interrupt or stop.
- **Told or resumed.** pi-optchat has two words for a message to an agent: `say` reaches one at work and does not wake one that has ended, and `resume` wakes one that has ended and refuses one at work. The server reads the agent's record as it is at that moment and uses the one that fits. Should the agent end in between, pi-optchat refuses, and the message can be sent again.
- **What pi-optchat refuses** comes back as the request's error, in its own words. An agent that has ended is resumed only if the main agent started it: an agent's own agent is its parent's to resume ("Only <id>'s parent <parent> can resume it…"), though it is told, interrupted and stopped like any other while it works.

## Usage

What a profile cost is pi-optchat's to count, and the server only reads it (`src/server/usage.ts`, `test/usage.test.ts`).

- **Where it comes from.** pi-optchat keeps a ledger in the profile's folder, a line for every answer of a model: the main chat's, an agent's, a summary's (the compactor), an import's. The Pi that has the profile writes it as each answer ends. The server reads it with pi-optchat's `readUsage`, which writes nothing and leaves out a line that Pi is halfway through writing.
- **pi-optchat does the sums.** The range is picked by its `selectUsage`, the total and the rows by its `summarizeUsage`, and the cached share by its `cacheShare`: the code `/optchat usage` shows its numbers with in a terminal. So the page and the terminal say the same, which a test holds them to: `test/usage-terminal.txt` is what pi-optchat's own page printed for the ledger in `test/usage.jsonl`, and the app's figures for that ledger have to be those, range by range.
- **The ranges are pi-optchat's**, but for "This session": that is one Pi process's, and the app shows a profile, not a process. "Today" is since midnight by the clock of this machine.
- **The dollars are an estimate**, at the provider's API prices as Pi knows them. A subscription bills none of it.
- **The bars over time** are made here, from the same records: from the first spending in the range to now, by five minutes while that is within three hours, by the hour within three days, by the day within three months, and by the month beyond. A bar with nothing in it is there too. Minutes and hours are counted in time gone by, so the hour that comes twice when the clocks go back has its bars twice. "Last 7 days" is the last 7 times 24 hours, which reach into eight days: its first bar is the part of a day that is in them.
- **Nothing is kept, and nothing is watched.** Every look reads the ledger whole. A ledger of 100,000 records (42 MB, far more than a profile of 20,000 messages has) takes 0.2 s to read and 25 ms to sum; one of 300,000 takes 0.6 s.
- **What is unreadable** is left out, and pi-optchat says how many lines that was (`warnings`). A last line cut short by a Pi that died is not counted until that Pi's profile is opened again, which ends the line.

## Who may connect

The windows run an agent with a shell, so the server listens on 127.0.0.1 only and checks two headers, `Host` on everything it serves and `Origin` on the WebSocket:

- `Host` must name this machine (`127.0.0.1`, `localhost`, `[::1]`): a page whose own name was pointed at 127.0.0.1 is refused.
- `Origin`, which a browser always sends on a WebSocket, must be the server's own page (`http://127.0.0.1:<port>` or `http://localhost:<port>`), or one of `startServer`'s `origins`: that option is for a desktop shell, which loads the UI from its own scheme (T3 Code's is `t3code://app`), and for Vite's address in `npm run dev`. Another program's page on this machine is refused like any other. A client that is not a browser sends no `Origin`.

The page is sent with `X-Frame-Options: DENY` and a `Content-Security-Policy` that lets it load only from the server itself, so no other page can frame it and nothing the agent writes can make it fetch an address elsewhere.

## From T3 Code

The Pi handling follows [T3 Code](https://github.com/pingdotgg/t3code)'s Pi adapter in what it does, with none of its code: each Pi in its own process group, records split on line feeds only, prompts always sent with a queueing behaviour so one that lands as a run starts is queued instead of failing, `clear_queue` before `abort`, and numbered records for catching up.
