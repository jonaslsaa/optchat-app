import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Agent } from '../src/protocol.ts';
import { among, busy, controls, doing, handingOff, listed, named, ownAtWork, polled, stood } from '../src/ui/agents.ts';

const agent = (id: string, state: Agent['state'], started: number, more: Partial<Agent> = {}): Agent => ({ id, task: `Task of ${id}\nand more`, model: 'm', state, started, doing: [], ...more });

test('the agents are listed with those at work first, then the newest, each one\'s own agents under it', () => {
  const agents = [
    agent('old', 'completed', 1), agent('new', 'completed', 5), agent('busy', 'running', 2), agent('lost', 'failed', 4, { parent: 'gone' }),
    agent('child', 'completed', 3, { parent: 'busy' }), agent('grandchild', 'waiting', 6, { parent: 'child' }),
  ];
  assert.deepEqual(listed(agents).map(({ agent, depth }) => [agent.id, depth]), [['busy', 0], ['child', 1], ['grandchild', 2], ['new', 0], ['lost', 0], ['old', 0]]);
});

test('an agent\'s row says what it is doing now, or how it ended', () => {
  const bash = (command: string) => ({ name: 'bash', args: { command } });
  assert.equal(doing(agent('a', 'running', 0, { doing: [bash('npm test')] })), 'Running npm test');
  assert.equal(doing(agent('a', 'running', 0, { doing: [bash('npm test'), bash('ls'), bash('pwd')] })), 'Running npm test and 2 more');
  assert.equal(doing(agent('a', 'running', 0)), 'Thinking');
  assert.equal(doing(agent('a', 'waiting', 0)), 'Waiting for its agents');
  assert.equal(doing(agent('a', 'completed', 0, { headline: '## **All green** in `npm test`.' })), 'All green in npm test.');
  assert.equal(doing(agent('a', 'failed', 0, { headline: 'Launch failed: no such model' })), 'Launch failed: no such model');
  // What an agent that was cut off was doing is not what it is doing.
  assert.equal(doing(agent('a', 'interrupted', 0, { doing: [bash('npm test')], headline: 'Pi closed before this agent finished.' })), 'Cut off when its Pi closed');
  assert.equal(named(agent('a', 'running', 0)), 'Task of a');
  assert.equal(named(agent('a', 'running', 0, { title: 'Run the tests' })), 'Run the tests');
});

test('the agents\' button has its dot by the Pi\'s own count, and the open panel looks for itself only where nothing tells it', () => {
  const working = [agent('a', 'running', 0)], ended = [agent('a', 'completed', 0)];
  assert.equal(busy('OptChat: work · 350 messages · 0 pending · 12 agents · importing'), true);
  // The list is as the panel last read it, which may be long ago: the count is the word on it, and says none work now.
  assert.equal(busy('OptChat: work · 350 messages · 0 pending · 0 agents', working), false);
  // No count, as when a Pi in a terminal has the chat: the open panel's list says, and a closed panel says nothing.
  assert.deepEqual([busy(undefined, working), busy(undefined, ended), busy(undefined)], [true, false, false]);
  // That Pi sends the app nothing, so an agent it starts later is found only by looking.
  assert.deepEqual([polled(ended, false), polled(working, false), polled(ended, true), polled([], true)], [false, true, true, true]);
});

test('a handoff being written is looked for while the Pi\'s status line counts one, or the list last had one', () => {
  const handing = { agents: [], more: 0, handing: [{ id: 'w', task: 'Fix it' }] }, none = { agents: [], more: 0 };
  assert.equal(handingOff('OptChat: work · 350 messages · 0 pending · 0 agents · 1 handing off'), true);
  assert.equal(handingOff('OptChat: work · 350 messages · 0 pending · 2 agents'), false);
  // A Pi in a terminal says nothing to the app: the list is the word, and it is read until it has none.
  assert.deepEqual([handingOff(undefined, handing), handingOff(undefined, none), handingOff()], [true, false, false]);
});

test('an agent\'s chat offers what its state allows: a message while it works or once it ended, and no dead button', () => {
  const of = (state: Agent['state'], parent?: string) => controls(agent('a', state, 0, { parent }));
  assert.deepEqual(of('running'), { message: 'work', interrupt: true, stop: true });
  // Interrupted with nothing to go on with, it waits for a message: there is no step to cut.
  assert.deepEqual(of('paused'), { message: 'work', interrupt: false, stop: true });
  assert.deepEqual(of('stopping'), { interrupt: false, stop: false });
  for (const state of ['completed', 'failed', 'stopped', 'interrupted'] as const) assert.deepEqual(of(state), { message: 'ended', interrupt: false, stop: false });
  // An agent's own agent is told and stopped like any other while it works; once it has ended only its parent resumes it.
  assert.deepEqual(of('waiting', 'b'), { message: 'work', interrupt: true, stop: true });
  assert.deepEqual(of('completed', 'b'), { interrupt: false, stop: false, owner: 'b' });
  // Colour is for three things: at work, done, failed.
  assert.deepEqual(['running', 'waiting', 'paused', 'completed', 'failed', 'stopped', 'interrupted'].map(state => stood({ state: state as Agent['state'] })),
    [{ word: 'Working', tone: 'working' }, { word: 'Waiting for its agents', tone: 'working' }, { word: 'Paused', tone: 'working' }, { word: 'Completed', tone: 'done' }, { word: 'Failed', tone: 'failed' }, { word: 'Stopped' }, { word: 'Interrupted' }]);
});

test('the chat shows the agents a call started as the list has them, and over the composer the main chat\'s own at work', () => {
  const agents = [agent('b', 'running', 5), agent('a', 'waiting', 2), agent('done', 'completed', 1), agent('child', 'running', 3, { parent: 'a' })];
  // In the call's order; one whose record is gone, or that ended before the newest the list keeps, is not there.
  assert.deepEqual(among(['a', 'gone', 'done'], agents).map(agent => agent.id), ['a', 'done']);
  assert.deepEqual(among(['gone'], agents), []);
  // An agent's own agents are the panel's, and pi-optchat's count leaves them out too.
  assert.deepEqual(ownAtWork(agents).map(agent => agent.id), ['a', 'b']);
});
