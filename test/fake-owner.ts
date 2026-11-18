import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
// pi-optchat's own socket and its wire, which the app reaches an agent through (`attachAgent`).
import { previewImport, profileSocket, readImport, readRuns, removeStaleSocket, scanChatGPT, wire, type Conversation, type ImportSelection, type RunInfo } from 'pi-optchat/files';
// How pi-optchat's Pi checks and writes a change of settings: not among its exports yet, so from where it is built.
import { checkPatch, patchConfigFile } from '../node_modules/pi-optchat/dist/profiles.js';
import { working } from '../src/agent.ts';
import { older } from '../src/server/setup.ts';

/** A Pi that owns a profile, as far as the app asks it things: pi-optchat's socket in the profile's folder, answering `attach`,
 * `say`, `interrupt`, `stop` and `resume`, and `resume-cut-off`, as pi-optchat does (its window-bridge.ts), by changing the agent's record on disk and
 * refusing in pi-optchat's words, `configure` by changing the profile's settings, and `import-*` by writing an import's files as pi-optchat does. No agent runs. It is the fake Pi's (`fake-pi.ts`), and lasts as long as its process.
 * `optchat` is the version of pi-optchat it stands for: one before 0.12.2 does not know `resume-cut-off`, and hangs up on it. */
export async function fakeOwner(directory: string, clock: () => number, optchat = '0.12.2') {
  const path = profileSocket(directory, 'windows');
  const run = (id: string) => readRuns(directory).find(run => run.id === id);
  const save = (run: RunInfo) => writeFileSync(join(directory, 'runs', `${run.id}.optchat.json`), JSON.stringify(run));
  const told = (run: RunInfo, text: string): RunInfo => ({ ...run, guidance: [...run.guidance, { text, date: clock(), state: 'queued', from: 'user' }] });
  const acts: Record<string, (run: RunInfo, text: string) => RunInfo> = {
    say: (run, text) => { if (!working(run)) throw new Error(`No running subagent ${run.id}.`); return told(run, text); },
    // Its step is cut: it goes on with what it was told and has not read, or else waits for a message.
    interrupt: run => {
      if (!working(run)) throw new Error(`No running subagent ${run.id}.`);
      const unread = run.guidance.some(told => told.state === 'queued');
      return unread ? { ...run, state: 'running', guidance: run.guidance.map(told => ({ ...told, state: 'delivered' })) } : { ...run, state: 'paused' };
    },
    stop: run => { if (!working(run)) throw new Error(`No running subagent ${run.id}.`); return { ...run, state: 'stopped', ended: clock(), report: 'Stopped by the user.' }; },
    resume: ({ ended: _, ...run }, text) => {
      if (working(run)) throw new Error(`Only a finished agent you attached to resumes; ${run.id} is running, so say reaches it`);
      if (!run.sessionFile) throw new Error(`The saved transcript of ${run.id} is missing or unreadable, so it cannot be resumed. Spawn a fresh subagent and give it the context it needs.`);
      if (run.parentId) throw new Error(`Only ${run.id}'s parent ${run.parentId} can resume it, and that parent is no longer running. Resume ${run.parentId} instead, or spawn a new subagent.`);
      return told({ ...run, state: 'running', started: clock() }, text);
    },
  };
  // An import, as pi-optchat keeps one while it runs: its job in `imports/pending.json` and how far it is in `imports/status.json`,
  // which pi-optchat's `readImport` reads (the job's numbers from the one, how far it is from the other). Nothing is summarized: it stands where it began, a third of the way, until the file
  // `import-done` is in the profile's folder, when it finishes as pi-optchat's does (`imports/<id>.json`).
  const imports = join(directory, 'imports'), pending = join(imports, 'pending.json'), progress = join(imports, 'status.json');
  const job = () => JSON.parse(readFileSync(pending, 'utf8'));
  const stand = (state: 'running' | 'paused') => { const { id, total, added } = job(), messages = total - added + Math.round(added / 3); writeFileSync(progress, JSON.stringify({ id, state, pid: process.pid, messages, summaries: Math.floor(messages * 0.9) })); };
  const importing: Record<string, (text: string) => Promise<void> | void> = {
    'import-start': async text => {
      if (existsSync(pending)) throw new Error('An import is already pending: resume or discard it first.');
      const selection: ImportSelection = JSON.parse(text), exported = selection.chatgpt ? (await scanChatGPT(selection.chatgpt)).conversations : [];
      const conversations = selection.conversations.map((c): Conversation => exported.find(e => e.id === c.id) ?? c);
      const preview = await previewImport(directory, conversations);
      if (!preview.added) throw new Error('Nothing new to import.');
      const id = randomUUID();
      mkdirSync(join(directory, 'memories', id), { recursive: true });
      writeFileSync(pending, JSON.stringify({ id, mode: selection.mode, previous: '.', target: `memories/${id}`, created: new Date(clock()).toISOString(), added: preview.added, skipped: preview.skipped, total: preview.memory.messages + preview.added, inputBytes: 4 * preview[selection.mode].tokens }));
      stand('running');
    },
    'import-pause': () => {
      if (!existsSync(progress) || JSON.parse(readFileSync(progress, 'utf8')).state !== 'running') throw new Error('No import is running.');
      stand('paused');
    },
    'import-resume': () => stand('running'),
    'import-discard': () => { const { id } = job(); rmSync(pending); rmSync(progress, { force: true }); rmSync(join(directory, 'memories', id), { recursive: true, force: true }); },
  };
  mkdirSync(imports, { recursive: true });
  setInterval(() => {
    if (!existsSync(join(directory, 'import-done')) || !existsSync(pending)) return;
    const done = job();
    rmSync(join(directory, 'import-done')); rmSync(pending); rmSync(progress, { force: true });
    writeFileSync(join(imports, `${done.id}.json`), JSON.stringify({ ...done, completed: new Date(clock()).toISOString() }));
  }, 100).unref();
  const server = createServer(socket => {
    let id: string | undefined;
    const send = wire(socket, async frame => {
      if (frame.kind !== 'request') return;
      const { action, text = '' } = frame;
      if (action === 'resume-cut-off' && older(optchat, '0.12.2')) { socket.destroy(); return; }
      try {
        // An import's step, answered with how the import stands then, as pi-optchat's own Pi answers it.
        if (importing[action]) { await importing[action](text); send({ kind: 'reply', id: frame.id, text: JSON.stringify(await readImport(directory)) }); return; }
        // A change of settings from the app: its Pi has the profile, so it is that Pi's to check and to write.
        if (action === 'configure') { const patch: unknown = JSON.parse(text); checkPatch(patch); patchConfigFile(directory, patch); }
        // What pi-optchat's resumeCutOff does to the records: the main agent's own cut-off agents start again.
        else if (action === 'resume-cut-off') { for (const { cutOff: _, ...agent } of readRuns(directory).filter(run => run.cutOff && !run.parentId)) save({ ...agent, state: 'running', started: clock() }); }
        else if (action === 'attach') { if (!run(id = text)) throw new Error(`No subagent ${text} in this profile`); }
        else if (id && acts[action]) { const agent = run(id); if (!agent) throw new Error(`No subagent ${id} in this profile`); save(acts[action](agent, text)); }
        else throw new Error(`The fake owner knows no ${action}.`);
        send({ kind: 'reply', id: frame.id });
      } catch (error) { send({ kind: 'reply', id: frame.id, error: error instanceof Error ? error.message : String(error) }); }
    });
  });
  removeStaleSocket(path); // One a Pi that is gone left behind.
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
}
