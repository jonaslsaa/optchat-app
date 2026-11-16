export interface Quitting {
  /** How many agents a quit would stop. */
  working(): Promise<number>;
  /** Asks whether that many agents may be stopped. */
  ask(working: number): Promise<boolean>;
  /** Stops everything the app runs. */
  close(): Promise<void>;
  /** Quits the app, which asks `request` once more. */
  quit(): void;
}
/** Decides what becomes of a quit. `request` is asked each time the app is about to quit and says whether it may: only once
 * everything it runs has stopped, which the first request starts, and then quits again itself. While agents work it asks
 * first, once however often a quit is asked for meanwhile (a Cmd+Q held), and a No leaves everything running. `sure` is a quit
 * that is not asked about: one you already agreed to (a restart into an update), or a signal. */
export function quitter({ working, ask, close, quit }: Quitting) {
  let asking = false, closing: Promise<void> | undefined, closed = false;
  const stop = () => { closing ??= close().then(() => { closed = true; quit(); }); };
  return {
    request(sure = false) {
      if (closed) return true;
      if (sure || closing) stop();
      else if (!asking) {
        asking = true;
        // What cannot be counted is not asked about: a quit that never comes is worse than one that was not asked about.
        void working().catch(() => 0).then(count => count === 0 || ask(count)).then(yes => { asking = false; if (yes) stop(); }, () => { asking = false; });
      }
      return false;
    },
  };
}
