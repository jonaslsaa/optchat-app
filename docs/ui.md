# The UI

A web page the local server serves: React, Vite and Tailwind, the same stack as T3 Code, with its looks (see `THIRD_PARTY_NOTICES.md`). It needs no Electron; a desktop shell can load the same page later.

## Run it

```bash
npm start                 # builds the page, then serves it at http://127.0.0.1:4780/
npm run dev               # the server, and Vite with hot reload (open the address Vite prints)
npm run screenshots       # a PNG of every main state, in /tmp/optchat-app-shots
```

## What you see

- **Profile tabs** on top, only once two profiles are open. The profile's name in the sidebar opens the list of profiles; picking one opens its tab.
- **Windows** on the left: the main chat, then connected windows, each with Complete and close. "New window" opens a connected window, which sends the main agent nothing until its first message.
- **The chat** in the centre. The main chat is the profile's log, read from disk a page at a time as you scroll back, so it shows with no Pi running. A connected window shows its own conversation, which only its Pi has until Complete hands it over.
- **The composer.** You can always type. While the agent runs, Enter steers it, ⌘Enter queues the message for after the run, and Esc stops the run and puts what was still queued back in the composer.

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
| `src/ui/transcript.ts` | The chat as data, with no DOM: folds Pi's records into a window's state, joins that with the log, and groups it into what is drawn. Tested in `test/transcript.test.ts`. |
| `src/ui/store.ts` | Everything the page knows, outside React: the connection (and reconnecting), the logs, each window's run. Components read it with `useApp`. |
| `src/ui/App.tsx`, `Sidebar.tsx`, `Timeline.tsx`, `Rows.tsx`, `Composer.tsx`, `Markdown.tsx` | The components. |
| `src/ui/ui.tsx`, `WorkLog.tsx`, `markdownStreamBlocks.ts`, `index.css` | Buttons, tool-call rows, the Markdown splitter and the design tokens, from T3 Code. |

**One chat, three sources.** Every item in the chat is a log entry, or what a message Pi has not logged yet will be logged as (`said` mirrors pi-optchat's own). So a reply looks the same while it streams, when it has ended and after a restart, and keeps what you opened in it. The live test checks that the two readings agree on a real turn.

**Joining the log with the run.** pi-optchat dates an entry with its message's time and logs a run in order, so a message of the run counts as logged once the log has an entry of its time, and so does everything before it. That is an interim rule: a run number published by pi-optchat would be sound where timestamps are not.

**Reconnecting.** Windows live in the server. The page asks `windows`, then `records` for each, and replays them; a gap in the pushed record numbers makes it ask again. A lost connection is retried every second.

## Screenshots

`npm run screenshots [directory]` builds the page, serves it against throwaway profiles under `/tmp` with the fake Pi (`test/fake-pi.ts`: no model, no network, nothing of yours is read), drives it in your installed Chrome through `playwright-core`, and saves one PNG per state: an empty profile, a long history, a folded reply opened, a reply streaming, a queued message, the finished reply, a new connected window, a connected window with its conversation, a completed window, two profile tabs, a narrow page with and without its sidebar, and dark mode. Clocks are fixed, so the same code gives the same bytes: compare two runs to see what a change did.
