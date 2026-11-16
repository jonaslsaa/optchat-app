/** What keeps the Mac from sleeping: Electron's `powerSaveBlocker`, as far as it is used. */
export interface Blocker { start(): number; stop(id: number): void }
export interface Awake {
  /** Whether the Mac is to be kept awake at all: the app's setting. */
  wanted(): boolean;
  /** How many agents work now, in the server's own count. */
  working(): Promise<number>;
  blocker: Blocker;
}
/** How many looks in a row have to find nothing at work before the Mac may sleep again: one is not believed. Between an
 * agent's end and the turn its report starts, nothing works for a moment (about 10 ms with a real Pi). A Mac let go by a look
 * in that moment may fall asleep before the next one, when you have not touched it for long, and the turn dies with it. */
const IDLE = 2;
/** Keeps the Mac awake while agents work. `look` is for a timer: it holds the Mac awake from the first look that finds an
 * agent at work until `IDLE` looks in a row found none, or the setting is turned off, which lets go at once. It is held
 * once however often it is looked. `release` is for the app's end, once everything has stopped: it lets go, and no look
 * takes hold again, also not one that began while agents were still being stopped and counted one of them. */
export function awake({ wanted, working, blocker }: Awake) {
  let held: number | undefined, idle = 0, over = false;
  const hold = (on: boolean) => {
    if (on && held === undefined) held = blocker.start();
    else if (!on && held !== undefined) { blocker.stop(held); held = undefined; }
  };
  return {
    async look() {
      // A count that fails is nothing at work: the Mac is not kept awake for what cannot be seen.
      const on = wanted(), busy = on && await working().catch(() => 0) > 0;
      if (over) return;
      idle = busy ? 0 : idle + 1;
      if (busy || !on || idle >= IDLE) hold(busy);
    },
    release() { over = true; hold(false); },
  };
}
