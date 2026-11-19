import { useRef } from 'react';
import { NAME } from '../protocol.ts';
import { app } from './store.ts';
import { cn } from './ui.tsx';

/** The box a connected window is renamed in, in place of its name (`name`, what it is called now): Enter or leaving the box keeps
 * what was typed, Esc what it was called, and an empty box gives it back its automatic name. Its keys are its own: none of them
 * reaches a shortcut of the page, Esc stops no run, and a click in it picks no row. */
export function Rename({ window, name, done, className }: { window: string; name: string; done: () => void; className?: string }) {
  const keeps = useRef(true);
  return (
    <input data-renaming autoFocus aria-label="Window name" defaultValue={name} maxLength={NAME} onFocus={event => event.currentTarget.select()}
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
        if (keeps.current && typed.trim() !== name) void app.rename(window, typed);
      }} />
  );
}
