import { useRef } from 'react';
import { NAME } from '../protocol.ts';
import { app } from './store.ts';
import { cn } from './ui.tsx';

/** A box something is renamed in, in place of its name (`name`, what it is called now): Enter or leaving the box keeps what was
 * typed (`keep`, when it changed), Esc what it was called. Its keys are its own: none of them reaches a shortcut of the page,
 * Esc stops no run, and a click in it picks no row. */
export function NameBox({ label, name, max, keep, done, className }: { label: string; name: string; max: number; keep: (typed: string) => void; done: () => void; className?: string }) {
  const keeps = useRef(true);
  return (
    <input data-renaming autoFocus aria-label={label} defaultValue={name} maxLength={max} onFocus={event => event.currentTarget.select()}
      className={cn('min-w-0 rounded-sm bg-background px-1 text-foreground text-sm outline-none ring-1 ring-ring', className)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') keeps.current = false;
        if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
      }}
      onBlur={event => {
        const typed = event.currentTarget.value;
        done();
        if (keeps.current && typed.trim() !== name) keep(typed);
      }} />
  );
}
/** The box a connected window is renamed in: an empty one gives it back its automatic name. */
export const Rename = ({ window, name, done, className }: { window: string; name: string; done: () => void; className?: string }) =>
  <NameBox label="Window name" name={name} max={NAME} keep={typed => void app.rename(window, typed)} done={done} className={className} />;
