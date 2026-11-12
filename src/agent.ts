import type { Agent } from './protocol.ts';

/** Whether an agent has not ended: it runs, waits for its own agents, is paused, or is being stopped. The server lists agents
 * by this, and the UI draws them by it. */
export const working = ({ state }: Pick<Agent, 'state'>) => state === 'running' || state === 'waiting' || state === 'stopping' || state === 'paused';
