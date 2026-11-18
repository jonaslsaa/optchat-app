import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Other tools' histories as they keep them on a Mac, made up, in a throwaway home folder: Claude Code's sessions and its
 * memories, Codex's and Pi's sessions, in the formats pi-optchat's scanners read. For the import's tests and screenshots, which
 * must never read yours. Every name is invented and the same each time; `now` dates them back from then. One conversation has
 * a block Claude Code may write and pi-optchat does not read, which it warns of. */

const PROJECTS = [
  ['claude', 'code/garden-planner', 64], ['claude', 'code/tide-tables', 41], ['claude', 'work/invoice-service', 23], ['claude', 'code/pixel-forge', 17],
  ['claude', 'code/recipe-box', 12], ['claude', 'work/design-tokens', 9], ['claude', 'notes', 6], ['claude', 'code/trail-maps', 3], ['claude', 'tmp/scratch', 2],
  ['codex', 'work/invoice-service', 21], ['codex', 'code/budget-app', 15], ['codex', 'code/tide-tables', 8], ['codex', 'code/kiln-timer', 4],
  ['pi', 'code/garden-planner', 11], ['pi', 'code/weather-station', 7], ['pi', 'dotfiles', 3],
] as const;
const ASKS = [
  'Why does the watering schedule skip Sundays?', 'Add a dark mode that follows the system', 'The CSV export drops the last row', 'Write tests for the date parser',
  'Move the settings into one file', 'Make the map load faster on a slow phone', 'Rename the user model to account', 'What does this stack trace mean?',
  'Set up CI for pull requests', 'Explain how the cache is invalidated', 'Clean up the old migration scripts', 'Draft the release notes for 2.0',
  'Find why the build is slow', 'Add keyboard shortcuts to the editor', 'Fix the off-by-one in pagination', 'Review my error handling',
  'Port the script from Python to TypeScript', 'Why is the tide graph a day late?', 'Make the invoice PDF match the design', 'Plan the database schema for teams',
];
const REPLIES = [
  'Found it: the loop starts at 1. I changed it to 0 and added a test that covers the first day.',
  'Done. The colours come from CSS variables now, so the system setting switches them without a reload.',
  'The last row had no newline, so the reader dropped it. Fixed in the writer, with a test.',
  'It is the timezone: the dates were parsed as local time. They are UTC now, and the graph lines up.',
];
const DAY = 86_400_000;
/** A number in [0, 1) that is the same for the same `n`. */
const noise = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
const uuid = (n: number) => { const hex = (n * 2654435761 >>> 0).toString(16).padStart(8, '0'); return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`; };
const lines = (values: object[]) => values.map(value => JSON.stringify(value)).join('\n') + '\n';

/** Writes the histories under `home`, and answers how many conversations of each source it wrote. */
export function writeHistories(home: string, now: number) {
  let n = 0;
  for (const [source, folder, count] of PROJECTS) for (let k = 0; k < count; k++) {
    n++;
    const cwd = join(home, folder), id = uuid(n), start = now - Math.floor(noise(n) ** 2 * 420 * DAY) - 3_600_000;
    const at = (step: number) => new Date(start + step * 61_000).toISOString();
    const turns = 1 + Math.floor(noise(n + 0.5) * 4), ask = (t: number) => ASKS[(n + t * 7) % ASKS.length], reply = (t: number) => REPLIES[(n + t) % REPLIES.length];
    let file: string;
    if (source === 'claude') {
      file = join(home, '.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, lines([...Array.from({ length: turns }, (_, t) => [
        { type: 'user', sessionId: id, cwd, uuid: `${id}-u${t}`, timestamp: at(2 * t), message: { role: 'user', content: ask(t) } },
        { type: 'assistant', sessionId: id, cwd, uuid: `${id}-a${t}`, timestamp: at(2 * t + 1), message: { role: 'assistant', content: [{ type: 'text', text: reply(t) }], stop_reason: 'end_turn' } },
      ]).flat(), ...folder === 'tmp/scratch' && k === 0 ? [{ type: 'user', sessionId: id, cwd, uuid: `${id}-x`, timestamp: at(9), message: { role: 'user', content: [{ type: 'canvas', id: 'c1' }] } }] : []]));
    } else if (source === 'codex') {
      file = join(home, '.codex/sessions', at(0).slice(0, 4), at(0).slice(5, 7), `rollout-${id}.jsonl`);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, lines([{ type: 'session_meta', timestamp: at(0), payload: { id, cwd, timestamp: at(0) } }, ...Array.from({ length: turns }, (_, t) => [
        { type: 'response_item', timestamp: at(2 * t), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: ask(t) }] } },
        { type: 'response_item', timestamp: at(2 * t + 1), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply(t) }] } },
        { type: 'event_msg', timestamp: at(2 * t + 1), payload: { type: 'task_complete' } },
      ]).flat()]));
    } else {
      file = join(home, '.pi/agent/sessions', `--${folder.replace(/\//g, '-')}--`, `${at(0).replace(/[:.]/g, '-')}_${id}.jsonl`);
      mkdirSync(join(file, '..'), { recursive: true });
      let parent: string | undefined;
      const entry = (key: string, t: number, message: object) => { const value = { type: 'message', id: key, parentId: parent ?? null, timestamp: at(t), message }; parent = key; return value; };
      writeFileSync(file, lines([{ type: 'session', version: 3, id, cwd, timestamp: at(0) }, ...Array.from({ length: turns }, (_, t) => [
        entry(`${id.slice(0, 8)}u${t}`, 2 * t, { role: 'user', content: [{ type: 'text', text: ask(t) }], timestamp: start }),
        entry(`${id.slice(0, 8)}a${t}`, 2 * t + 1, { role: 'assistant', content: [{ type: 'text', text: reply(t) }], stopReason: 'stop', timestamp: start }),
      ]).flat()]));
    }
    utimesSync(file, new Date(start), new Date(start));
  }
  // Claude Code's memories: a file a topic, beside the sessions of the project they are of.
  const memories = [['code/garden-planner', 'watering', 'The schedule runs at 6am local time and skips frost days.'], ['code/garden-planner', 'testing', 'Run the tests with npm test; the e2e ones need the emulator.'],
    ['code/tide-tables', 'data', 'Tide data comes from the harbour API, cached for a day.'], ['work/invoice-service', 'style', 'Money is always in minor units, never floats.'], ['work/invoice-service', 'deploy', 'Deploys go out on Tuesdays after the review.']] as const;
  for (const [folder, name, body] of memories) {
    const dir = join(home, '.claude/projects', join(home, folder).replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: What to remember about ${name}\nmodified: ${new Date(now - 9 * DAY).toISOString()}\n---\n${body}\n`);
  }
  return { claude: PROJECTS.filter(p => p[0] === 'claude').reduce((s, p) => s + p[2], 0), codex: PROJECTS.filter(p => p[0] === 'codex').reduce((s, p) => s + p[2], 0), pi: PROJECTS.filter(p => p[0] === 'pi').reduce((s, p) => s + p[2], 0), 'claude-memory': memories.length };
}
/** A ChatGPT export's conversations.json, made up: `count` conversations of two messages. */
export function chatgptExport(count: number, now: number) {
  return JSON.stringify(Array.from({ length: count }, (_, k) => {
    const time = (now - (k + 1) * 3 * DAY) / 1000;
    return { id: uuid(9000 + k), title: ASKS[k % ASKS.length], create_time: time, update_time: time + 60, current_node: 'b', mapping: {
      a: { id: 'a', parent: null, children: ['b'], message: { id: `m${k}a`, author: { role: 'user' }, create_time: time, content: { content_type: 'text', parts: [ASKS[k % ASKS.length]] } } },
      b: { id: 'b', parent: 'a', children: [], message: { id: `m${k}b`, author: { role: 'assistant' }, create_time: time + 30, status: 'finished_successfully', end_turn: true, channel: 'final', content: { content_type: 'text', parts: [REPLIES[k % REPLIES.length]] } } },
    } };
  }));
}
