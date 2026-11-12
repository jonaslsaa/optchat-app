import type { WindowState } from './protocol.ts';

/** Whether Complete has something to hand to the main chat: a connected window whose Pi is up, with a conversation that is not
 * handed off yet. The server refuses Complete by this, and the UI offers it by this. */
export const canComplete = ({ role, status, completed }: WindowState) => role === 'connected' && (status === 'idle' || status === 'running') && !completed;
