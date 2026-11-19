import type { WindowState } from './protocol.ts';

/** What a window's Pi said in the conversation the window is in. A connected window's Pi keeps the conversations it completed
 * too, and those are the main chat's by then. `since` is pi-optchat's own cut (`after` in its `optchat.role`), and this is how
 * it cuts what the agent reads, so the window shows the conversation the agent has. */
export const current = <M extends { timestamp: number }>({ since }: Pick<WindowState, 'since'>, messages: M[]) =>
  since === undefined ? messages : messages.filter(message => message.timestamp >= since);
/** Whether Complete has something to hand to the main chat: a connected window whose Pi is up, with a conversation that is not
 * handed off yet, nor being handed off. The server refuses Complete by this, and the UI offers it by this. */
export const canComplete = ({ role, status, completed, completing }: WindowState) => role === 'connected' && (status === 'idle' || status === 'running') && !completed && !completing;
