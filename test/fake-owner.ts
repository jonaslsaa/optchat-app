import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { RunInfo } from 'pi-optchat/files';
// pi-optchat's own socket and its wire, which the app reaches an agent through (`attachAgent`).
import { checkPatch, patchConfigFile, profileSocket, removeStaleSocket } from '../node_modules/pi-optchat/dist/profiles.js';
import { readRun } from '../node_modules/pi-optchat/dist/run-record.js';
import { wire } from '../node_modules/pi-optchat/dist/window-client.js';
import { working } from '../src/agent.ts';

/** A Pi that owns a profile, as far as the app asks it things: pi-optchat's socket in the profile's folder, answering `attach`,
 * `say`, `interrupt`, `stop` and `resume` as pi-optchat does (its window-bridge.ts), by changing the agent's record on disk and
 * refusing in pi-optchat's words, and `configure` by changing the profile's settings. No agent runs. It is the fake Pi's (`fake-pi.ts`), and lasts as long as its process. */
export async function fakeOwner(directory: string, clock: () => number) {
  const path = profileSocket(directory, 'windows');
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
  const server = createServer(socket => {
    let id: string | undefined;
    const send = wire(socket, frame => {
      if (frame.kind !== 'request') return;
      const { action, text = '' } = frame;
      try {
        // A change of settings from the app: its Pi has the profile, so it is that Pi's to check and to write.
        if (action === 'configure') { const patch: unknown = JSON.parse(text); checkPatch(patch); patchConfigFile(directory, patch); }
        else if (action === 'attach') { try { readRun(directory, id = text); } catch { throw new Error(`No subagent ${text} in this profile`); } }
        else if (id && acts[action]) save(acts[action](readRun(directory, id), text));
        else throw new Error(`The fake owner knows no ${action}.`);
        send({ kind: 'reply', id: frame.id });
      } catch (error) { send({ kind: 'reply', id: frame.id, error: error instanceof Error ? error.message : String(error) }); }
    });
  });
  removeStaleSocket(path); // One a Pi that is gone left behind.
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
}
