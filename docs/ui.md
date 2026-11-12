# The UI

A web page the local server serves: React, Vite and Tailwind, the same stack as T3 Code, with its looks (see `THIRD_PARTY_NOTICES.md`). It needs no Electron; a desktop shell can load the same page later.

## Run it

```bash
npm start                 # builds the page, then serves it at http://127.0.0.1:4780/
npm run dev               # the server, and Vite with hot reload (open the address Vite prints)
npm run screenshots       # a PNG of every main state, in /tmp/optchat-app-shots
```

## What you see

- **Profile tabs** on top, only once two profiles are open, with a + that opens another. A tab has a dot while a window of its profile is working, and a red one when a window's Pi failed. With one profile there is no tab bar: its name sits in the title bar and opens the list of profiles.
- **Windows** on the left: the main chat, then connected windows, each with Complete and close. The button above them opens a connected window, which sends the main agent nothing until its first message and is "Untitled window" until then. Hold ⌥ to see each window's digit.
- **The chat** in the centre. The main chat is the profile's log, read from disk a page at a time as you scroll back, so it shows with no Pi running. A connected window shows its own conversation, which only its Pi has until Complete hands it over. A completed one stays as it was until your next message, which begins a new conversation in the same window: the view starts empty, and the finished one is in the main chat.
- **The chat's rows.** A tool call reads as what it did ("Ran `npm test`", "Read src/client.ts, lines 40–99", "Looked back at 128+2", "Started an agent: …") and opens to what it printed. Opened, the line is there whole and can be selected, and above what the call printed is only what the line does not say: an edit as the lines it took out and put in, the text it wrote to a file, a command of several lines. Arguments show as JSON only where the app has no words for them: a tool it does not know, or an argument its line leaves out (a search's `glob`). Finished work folds to one line, which says so when a call failed. A subagent's report goes by the title it was started under. A reply can be copied whole, and what the agent had written when you stopped it stays in view. When you complete a connected window, the handoff its agent writes for the main chat is a folded line under the conversation ("Handed to the main chat"), not a reply to you.
- **Agents** on the right, behind the robot in the main chat's title bar, which has a dot while one works. The list has the agents at work first, then the newest, each agent's own agents under it: its title (or the first line of its task), how long it has worked, and what it is doing now in the words of the chat's tool rows, or how it ended. A click opens the agent's chat in the list's place: its task, its work and its answer, drawn as the main chat is. The name on a report in the main chat opens the agent it came from. The panel only shows: an agent is told, stopped and resumed by the main agent. It is the main chat's, so a connected window has none, and on a narrow page it lies over the chat as a sheet: the focus stays in it, Esc closes it (and stops no run), and the focus then returns to what opened it. See [Agents](#agents).
- **The memory view**, in the main chat's place, behind Chat / Memory in its title bar (⌥M): the lines the agent reads its memory as, oldest first and opened at the newest, under the day each begins on. It says how many messages there are and since when, how many lines the agent reads them as, and how much of its budget those take. A line is a summary of 2, 4, 8 or more messages, shown as it is stored, or one message; it opens into the two lines it was made from, and a line of one message into the message as the chat draws it. What you opened stays open while the view is read again ("Not summarized yet" is a line whose summary its Pi has still to write). ↑ and ↓ walk the lines, → opens one and ← closes it. A message sent from here is answered in the chat. It only reads ([Memory view](#memory-view)).
- **An empty window** says what it is in the middle of the page, with the composer under it.
- **Settings**, behind the gear in the title bar: the theme, where new windows run, and what a chat needs with whether it is there ([setup.md](setup.md)). Before there is a profile, that setup is the page. A main chat that a Pi in a terminal has open says so where its composer would be.
- **The composer.** You can always type. While the agent runs, Enter steers it, ⌘Enter queues the message for after the run, and Esc stops the run and puts what was still queued back in the composer. What you were typing stays with its window. The line under it speaks only when there is news: how to steer a run, that Pi is starting, agents at work, summaries still to write. When a window's Pi has stopped, a box above the composer says why and what to do.

| Keys | |
| --- | --- |
| Enter / Shift+Enter | Send (or steer) / new line |
| ⌘Enter | Queue for after the run |
| Esc | Stop the run; in the settings, close them; with the agents lying over the chat, close them, and the run goes on |
| ⌘⇧O | New window |
| ⌥1 … ⌥9 | Go to a window |
| ⌘B | Show or hide the sidebar |
| ⌥M | The main chat, or its memory view |
| ↑ ↓ / → ← | In the memory view: the line above or below / open or close it |
| ⌘, | Settings |

## How it is built

| File | What it is |
| --- | --- |
| `src/ui/transcript.ts` | The chat as data, with no DOM: folds Pi's records into a window's state, joins that with the log, joins the log's pages, and works out what each row says (`parts`), down to the words for a tool call (`act`), for pi-optchat's status line (`news`) and for a Pi that stopped (`failure`). Tested in `test/transcript.test.ts`. |
| `src/ui/store.ts` | Everything the page knows, outside React: the connection (and reconnecting), the logs, each window's run. Components read it with `useApp`. Tested against the server in `test/store.test.ts`. |
| `src/ui/App.tsx`, `Profiles.tsx`, `Sidebar.tsx`, `Timeline.tsx`, `Rows.tsx`, `Composer.tsx`, `Markdown.tsx` | The components. They only draw: a row gets its part, and is drawn again only when that part changed. |
| `src/ui/agents.ts`, `Agents.tsx` | The agents panel: what the list says, and the panel ([Agents](#agents)). |
| `src/ui/memory.ts`, `Memory.tsx` | The memory view: what is read and what is open, and the view ([Memory view](#memory-view)). |
| `src/ui/highlight.ts` | Syntax colours for code blocks, by Shiki: see below. Tested in `test/highlight.test.ts`. |
| `src/ui/safe.ts` | What Markdown may do: see below. Tested in `test/markdown.test.ts`. |
| `src/ui/Settings.tsx`, `Setup.tsx`, `Outside.tsx`, `theme.ts` | The settings page, what a chat needs, a profile a terminal has open, and the theme ([setup.md](setup.md)). |
| `src/ui/keys.ts` | Shortcuts, and `useShortcuts`. |
| `src/ui/ui.tsx`, `WorkLog.tsx`, `markdownStreamBlocks.ts`, `index.css` | Buttons, tool-call rows, the Markdown splitter and the design tokens, from T3 Code. |
| `src/window.ts` | What a window can do (`canComplete`) and which of its Pi's messages are the conversation it is in (`current`), for the server and the page alike. |

**One chat, three sources.** Every item in the chat is a log entry, or what a message Pi has not logged yet will be logged as (by pi-optchat's own `said`, from `pi-optchat/core`). So a reply looks the same while it streams, when it has ended and after a restart, and keeps what you opened in it. The live test checks that the two readings agree on a real turn.

**Joining the log with the run.** pi-optchat dates an entry with its message's time and logs a run in order, so a message of the run counts as logged once the log has an entry of its time, and so does everything before it. That is an interim rule: a run number published by pi-optchat would be sound where timestamps are not.

**Keys.** A row's key is its first entry's number in the log, and what a run has said and the log does not have yet is numbered on from the log's last entry, which is the number the log will give it. A connected window's conversation is numbered by its place in it.

**Reconnecting.** Windows live in the server. The page asks `windows`, then `records` for each, and replays them; a gap in the pushed record numbers makes it ask again, and read again what the run said. A lost connection is retried every second, from one place: the socket's closing.

**Code is coloured by Shiki, which the page does not load until a code block names a language.** Shiki, its light and dark theme and each language's grammar are chunks of their own, fetched on first use; the code shows plain until they are there, and stays plain in a language Shiki does not know. A token's colour is CSS `light-dark()`, so it follows the page's `dark` class with nothing drawn again. While a block streams, the lines it had are kept and only what came since is read, on from where the grammar stood at the end of the last whole line.

**Nothing in a reply is fetched on its own.** The agent reads web pages and files that may tell it what to write, and a Markdown image is fetched the moment it is drawn, with whatever its address carries. So only the profile's own images (`/images/<profile>/<name>`) are drawn; any other image is shown as a link, and links open in a new tab that knows nothing of this one. The server backs this with `Content-Security-Policy: default-src 'self'`.

## Agents

pi-optchat tells an RPC host almost nothing of its agents: a count in the status line, the id the `spawn` call answers with, and the report. What an agent is and does is in the profile's files, which pi-optchat writes as it goes: a record of each run (`runs/<id>.optchat.json`, read with pi-optchat's own `readRuns`) and the run's Pi session file, which grows by a line as each message ends. So the server reads those ([server.md](server.md): `agents`, `agent`), and the panel shows an agent's messages as they end, not its words as they are written.

- **When it is read.** When the panel is opened, when the main chat changes (its Pi starts or stops, its status line changes, a message of its run ends, the log grows: an agent starting and a report arriving are among these), and every two seconds while the panel is open and an agent works, or a Pi in a terminal has the chat (it tells the app nothing of the agents it starts). Nothing is watched, and nothing is read while the panel is closed: the dot on the button then goes by the count in the status line of the app's own Pi.
- **An agent whose Pi is gone.** A record can say `running` after the Pi that ran the agent died; pi-optchat corrects it when the profile is next opened. Until then the server asks whether any Pi has the profile open, the app's or one in a terminal, and where none does such an agent is `interrupted`.
- **What is left out.** The first message of an agent's session is its task under a view of the profile's memory; the panel shows the task alone. Connected windows are runs to pi-optchat too, and are windows here.

`src/ui/agents.ts` has the list's order and words, with no DOM (`test/agents-ui.test.ts`); `src/server/agents.ts` the reading (`test/agents.test.ts`); the live test starts a real agent and follows it from `running` to `completed`.

## Memory view

pi-optchat keeps a profile's memory as a log of messages and a tree of summaries over it: one for every two messages, one for every two of those, and so on. What the agent reads each turn is a row of lines that covers the whole log, the newest messages one by one and older ones as ever larger summaries. The memory view is that row, and the tree under it.

- **Where it comes from.** The server reads the profile's files with `pi-optchat/files` (`view`, `zoom`, `original` in [server.md](server.md)); the page holds the view, and what was read under the lines you opened. The app summarizes nothing and writes nothing: a summary the owning Pi has not written yet is "Not summarized yet".
- **It can trail the chat.** A Pi writes a message when it ends and a summary a while after, and saves how the view is folded only when that changes. So the view here is the last one saved with the messages since added to it, which is how pi-optchat itself reads it back, and can be a fold behind the Pi that is running.
- **When it is read.** When it is shown, when the main chat changes (its Pi starts or stops, the log grows), and every three seconds while that says too little: while the chat's Pi runs (it logs as it goes, and the page reads the log when the run ends), while a Pi outside the app has the chat, and while a line waits for its summary. The server keeps what it read until the files change, so such a look costs it a glance at them, and the page is drawn again only when the view changed.
- **A line is the same line for as long as the memory is the same one.** `128+64` is the 64 messages from message 128 on, as pi-optchat writes it. So what was read under a line is kept and lines stay open across a read; only a tool call that was read before it had printed is asked for again. An import moves a profile to another memory: when the view names another one (or the log got shorter), everything read is dropped.
- **What it costs.** On a profile of 19,000 messages (27 MB of log, 16 MB of tree): the first read takes the server about 0.2 s, and it is kept until the files change; the view is 176 lines, about 100 kB; opening a line is about 1 kB; from the largest line (1,024 messages) down to one message is ten clicks. The page never holds the log.
- **What is left out.** Search, the shape of the tree as a chart, a connected window's own view, and anything that changes a memory.

## Screenshots

`npm run screenshots [directory]` builds the page, serves it against throwaway profiles under `/tmp` with the fake Pi (`test/fake-pi.ts`: no model, no network, nothing of yours is read), drives it in your installed Chrome through `playwright-core`, and saves one PNG per state: an empty profile, a long history, a folded reply opened, a reply streaming, a steering and a queued message, the finished reply, a new connected window, a connected window with its conversation, a completed window, two profile tabs, a narrow page with and without its sidebar, dark mode, a window whose Pi stopped, the settings in both themes, a chat that is running outside the app, and the first run on a machine without Pi (before an install, after one that failed, after one that worked, the settings of that machine later, and a sign-in under way), an edit and a write opened, and the agents panel (the list, an agent at work, a finished one opened from its report, and the list on a narrow page). `--dark` takes them all in dark mode. Clocks are fixed and the throwaway folder has one name (`/tmp/optchat-app-shots-home`, so one run at a time), so the same code gives the same bytes: compare two runs to see what a change did.
