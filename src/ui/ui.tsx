import { CheckIcon, CopyIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import type { WindowState } from '../protocol.ts';
import { extendTailwindMerge, type ClassNameValue } from 'tailwind-merge';

/** The small parts everything else is built from. The class strings are T3 Code's (MIT, see THIRD_PARTY_NOTICES.md), from its
 * `components/ui`: button, kbd and spinner, without base-ui underneath. */

const twMerge = extendTailwindMerge({ extend: { theme: { text: ['2xs'] } } });
/** Class names joined, the later winning where two set the same thing. */
export const cn = (...inputs: ClassNameValue[]) => twMerge(inputs);

const BUTTON = "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] border font-medium text-sm outline-none transition-[box-shadow,scale] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";
const SIZES = {
  sm: 'h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)]',
  xs: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-xs [&_svg:not([class*='size-'])]:size-3.5",
  'icon-sm': 'size-7',
  'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3.5",
};
const VARIANTS = {
  default: 'border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs inset-shadow-control-highlight hover:bg-primary/90 active:shadow-none',
  'ghost-muted': 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
  outline: 'border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64',
  secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90',
  glass: 'surface-glass rounded-full border-border/60 text-foreground shadow-sm hover:border-border',
};
export function Button({ className, variant = 'default', size = 'sm', ...props }: ComponentProps<'button'> & { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES }) {
  return <button type="button" {...props} className={cn(BUTTON, SIZES[size], VARIANTS[variant], className)} />;
}
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd {...props} className={cn('pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded bg-foreground/[0.07] px-1 font-medium font-sans text-muted-foreground text-xs', className)} />;
}
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-label="Working" className={cn('size-3.5 motion-safe:animate-spin', className)} />;
}
/** A choice between a few things that are all in sight. The browser's own radio buttons, for its arrow keys; only their
 * labels are drawn. */
export function Choice<T extends string | boolean>({ label, name, title, options, value, onChange }: { label: string; name: string; title?: string; options: readonly (readonly [text: string, value: T])[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} title={title} className="flex shrink-0 rounded-[var(--control-radius)] border bg-muted/50 p-0.5">
      {options.map(([text, option]) => (
        <label key={text} className={cn('flex h-5.5 items-center rounded-[calc(var(--control-radius)-2px)] px-2 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', value === option ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
          <input type="radio" name={name} className="sr-only" checked={value === option} onChange={() => onChange(option)} />{text}
        </label>
      ))}
    </div>
  );
}
export const ROW = 'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-sm outline-none sm:min-h-7';
/** A list one row of which is picked: with a click, or with the keys from the field the typing goes on in, which says which
 * row that would be (`at`: its `aria-activedescendant` is `${id}-${at}`, its `aria-controls` `${id}-list`) and moves it with
 * the arrows (`stepped`). That row is kept in sight. `head` is what stands over a row, `selected` the row in use. The look
 * and the keys are T3 Code's model picker (MIT, see THIRD_PARTY_NOTICES.md). */
export function Options<T>({ id, label, rows, at, selected, head, empty, onPick, children }: { id: string; label: string; rows: readonly T[]; at: number; selected?: T; head?: (row: T, k: number) => ReactNode; empty: ReactNode; onPick: (row: T, k: number) => void; children: (row: T) => ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { list.current?.querySelector('[data-at]')?.scrollIntoView({ block: 'nearest' }); }, [at, rows]);
  return (
    <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5">
      {rows.map((row, k) => (
        <li key={k}>
          {head?.(row, k)}
          <div id={`${id}-${k}`} role="option" aria-selected={row === selected} data-at={k === at ? '' : undefined} onClick={() => onPick(row, k)} className={cn(ROW, 'hover:bg-foreground/[0.09] data-at:bg-foreground/[0.09]')}>{children(row)}</div>
        </li>
      ))}
      {rows.length === 0 && <li className="p-2 text-center text-muted-foreground text-sm">{empty}</li>}
    </ul>
  );
}
/** The row an arrow moves to from `at`, round the ends of the list. */
export const stepped = (key: 'ArrowDown' | 'ArrowUp', at: number, rows: number) => (at + (key === 'ArrowDown' ? 1 : rows - 1)) % Math.max(1, rows);
/** An on/off switch: the browser's own checkbox under a drawn one, so the keys and a screen reader have it as it is. */
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn('relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background', checked ? 'bg-primary' : 'bg-input')}>
      <input type="checkbox" role="switch" aria-label={label} className="absolute inset-0 cursor-pointer opacity-0" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className={cn('size-4 rounded-full bg-background shadow-sm transition-transform', checked ? 'translate-x-4' : 'dark:bg-muted-foreground')} />
    </label>
  );
}
/** "Show 8 more", under a list (the `ul` before it) that shows `step` at a time and has `more` left. It keeps the focus while
 * there are more to show. Once there are none it is gone, and the focus it had goes to the list's last row and not to the page. */
export function More({ more, step, onMore }: { more: number; step: number; onMore: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const here = button.current;
    return () => { if (here && here === document.activeElement) here.previousElementSibling?.querySelector<HTMLElement>('li:last-child :is(a, button)')?.focus(); };
  }, []);
  return <Button ref={button} variant="ghost-muted" size="xs" className="mx-2.5 mt-2" onClick={onMore}>Show {Math.min(more, step)} more</Button>;
}
/** One of the things the panel beside the main chat lists, under a small heading, with a line between it and the one above.
 * One with nothing to list is not drawn at all. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-border/65 px-2 pt-1 pb-2.5 first:[&>h3]:pe-10 [section+&]:border-t">
      <h3 className="flex min-h-8 items-center px-2.5 font-medium text-2xs text-muted-foreground select-none"><span className="min-w-0 truncate">{title}</span></h3>
      {children}
    </section>
  );
}
/** The dot that says what a window is doing. */
export function StatusDot({ tone, pulse = false }: { tone: 'working' | 'failed'; pulse?: boolean }) {
  const colour = { working: 'bg-info-foreground', failed: 'bg-red-500 dark:bg-red-300/90' }[tone];
  return <span role="img" aria-label={tone === 'working' ? 'Working' : 'Failed'} className="inline-flex size-3.5 shrink-0 items-center justify-center"><span className={cn('size-[9px] rounded-full', colour, pulse && 'motion-safe:animate-status-pulse')} /></span>;
}
/** A dot for windows of which one is working, or one's Pi failed. */
export function WindowDot({ windows }: { windows: WindowState[] }) {
  if (windows.some(window => window.status === 'running' || window.status === 'starting')) return <StatusDot tone="working" pulse />;
  return windows.some(window => window.error) ? <StatusDot tone="failed" /> : null;
}
/** Whether the page matches a media query, now. */
export function useMedia(query: string) {
  return useSyncExternalStore(changed => {
    const media = matchMedia(query);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, () => matchMedia(query).matches);
}
/** Copies `text`, and shows for a moment that it has. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  return <Button variant="ghost-muted" size="icon-xs" aria-label={label} title={label} onClick={copy}>{copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}</Button>;
}
