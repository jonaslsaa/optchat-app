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
- **The chat's rows.** A tool call reads as what it did ("Ran `npm test`", "Read `README.md`", "Started an agent: …") and opens to what it printed. Finished work folds to one line, which says so when a call failed. A subagent's report goes by the title it was started under. A reply can be copied whole, and what the agent had written when you stopped it stays in view. When you complete a connected window, the handoff its agent writes for the main chat is a folded line under the conversation ("Handed to the main chat"), not a reply to you.
- **An empty window** says what it is in the middle of the page, with the composer under it.
- **The composer.** You can always type. While the agent runs, Enter steers it, ⌘Enter queues the message for after the run, and Esc stops the run and puts what was still queued back in the composer. What you were typing stays with its window. The line under it speaks only when there is news: how to steer a run, that Pi is starting, agents at work, summaries still to write. When a window's Pi has stopped, a box above the composer says why and what to do.

| Keys | |
| --- | --- |
| Enter / Shift+Enter | Send (or steer) / new line |
| ⌘Enter | Queue for after the run |
| Esc | Stop the run |
| ⌘⇧O | New window |
| ⌥1 … ⌥9 | Go to a window |
| ⌘B | Show or hide the sidebar |

## How it is built

| File | What it is |
| --- | --- |
| `src/ui/transcript.ts` | The chat as data, with no DOM: folds Pi's records into a window's state, joins that with the log, joins the log's pages, and works out what each row says (`parts`), down to the words for a tool call (`act`), for pi-optchat's status line (`news`) and for a Pi that stopped (`failure`). Tested in `test/transcript.test.ts`. |
| `src/ui/store.ts` | Everything the page knows, outside React: the connection (and reconnecting), the logs, each window's run. Components read it with `useApp`. Tested against the server in `test/store.test.ts`. |
| `src/ui/App.tsx`, `Profiles.tsx`, `Sidebar.tsx`, `Timeline.tsx`, `Rows.tsx`, `Composer.tsx`, `Markdown.tsx` | The components. They only draw: a row gets its part, and is drawn again only when that part changed. |
| `src/ui/highlight.ts` | Syntax colours for code blocks, by Shiki: see below. Tested in `test/highlight.test.ts`. |
| `src/ui/safe.ts` | What Markdown may do: see below. Tested in `test/markdown.test.ts`. |
| `src/ui/keys.ts` | Shortcuts, and `useShortcuts`. |
| `src/ui/ui.tsx`, `WorkLog.tsx`, `markdownStreamBlocks.ts`, `index.css` | Buttons, tool-call rows, the Markdown splitter and the design tokens, from T3 Code. |
| `src/window.ts` | What a window can do (`canComplete`) and which of its Pi's messages are the conversation it is in (`current`), for the server and the page alike. |

**One chat, three sources.** Every item in the chat is a log entry, or what a message Pi has not logged yet will be logged as (`said` mirrors pi-optchat's own). So a reply looks the same while it streams, when it has ended and after a restart, and keeps what you opened in it. The live test checks that the two readings agree on a real turn.

**Joining the log with the run.** pi-optchat dates an entry with its message's time and logs a run in order, so a message of the run counts as logged once the log has an entry of its time, and so does everything before it. That is an interim rule: a run number published by pi-optchat would be sound where timestamps are not.

**Keys.** A row's key is its first entry's number in the log, and what a run has said and the log does not have yet is numbered on from the log's last entry, which is the number the log will give it. A connected window's conversation is numbered by its place in it.

**Reconnecting.** Windows live in the server. The page asks `windows`, then `records` for each, and replays them; a gap in the pushed record numbers makes it ask again, and read again what the run said. A lost connection is retried every second, from one place: the socket's closing.

**Code is coloured by Shiki, which the page does not load until a code block names a language.** Shiki, its light and dark theme and each language's grammar are chunks of their own, fetched on first use; the code shows plain until they are there, and stays plain in a language Shiki does not know. A token's colour is CSS `light-dark()`, so it follows the page's `dark` class with nothing drawn again. While a block streams, the lines it had are kept and only what came since is read, on from where the grammar stood at the end of the last whole line.

**Nothing in a reply is fetched on its own.** The agent reads web pages and files that may tell it what to write, and a Markdown image is fetched the moment it is drawn, with whatever its address carries. So only the profile's own images (`/images/<profile>/<name>`) are drawn; any other image is shown as a link, and links open in a new tab that knows nothing of this one. The server backs this with `Content-Security-Policy: default-src 'self'`.

## Screenshots

`npm run screenshots [directory]` builds the page, serves it against throwaway profiles under `/tmp` with the fake Pi (`test/fake-pi.ts`: no model, no network, nothing of yours is read), drives it in your installed Chrome through `playwright-core`, and saves one PNG per state: an empty profile, a long history, a folded reply opened, a reply streaming, a steering and a queued message, the finished reply, a new connected window, a connected window with its conversation, a completed window, two profile tabs, a narrow page with and without its sidebar, dark mode, and a window whose Pi stopped. `--dark` takes them all in dark mode. Clocks are fixed, so the same code gives the same bytes: compare two runs to see what a change did.
