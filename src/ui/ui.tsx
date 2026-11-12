import { cva, cx, type CxOptions, type VariantProps } from 'class-variance-authority';
import { LoaderCircleIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { extendTailwindMerge } from 'tailwind-merge';

/** The small parts everything else is built from. The class strings are T3 Code's (MIT, see THIRD_PARTY_NOTICES.md), from its
 * `components/ui`: button, kbd and spinner, without base-ui underneath. */

const twMerge = extendTailwindMerge({ extend: { theme: { text: ['2xs'] } } });
export const cn = (...inputs: CxOptions) => twMerge(cx(inputs));

const button = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] border font-medium text-sm outline-none transition-[box-shadow,scale] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: 'default', variant: 'default' },
    variants: {
      size: {
        default: 'h-8 px-[calc(--spacing(3)-1px)]',
        sm: 'h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)]',
        xs: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-xs [&_svg:not([class*='size-'])]:size-3.5",
        icon: 'size-8',
        'icon-sm': 'size-7',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default: 'border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs inset-shadow-control-highlight hover:bg-primary/90 active:shadow-none',
        ghost: 'border-transparent text-foreground hover:bg-accent',
        'ghost-muted': 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
        outline: 'border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90',
        glass: 'surface-glass rounded-full border-border/60 text-foreground shadow-sm hover:border-border',
      },
    },
  },
);
export function Button({ className, variant, size, ...props }: ComponentProps<'button'> & VariantProps<typeof button>) {
  return <button type="button" {...props} className={cn(button({ size, variant }), className)} />;
}
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd {...props} className={cn('pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded bg-foreground/[0.07] px-1 font-medium font-sans text-muted-foreground text-xs', className)} />;
}
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-label="Working" className={cn('size-3.5 motion-safe:animate-spin', className)} />;
}
/** The dot that says what a window is doing. */
export function StatusDot({ tone, pulse = false }: { tone: 'working' | 'failed' | 'done' | 'waiting'; pulse?: boolean }) {
  const colour = { working: 'bg-sky-500 dark:bg-sky-300/80', failed: 'bg-red-500 dark:bg-red-300/90', done: 'bg-emerald-500 dark:bg-emerald-300/90', waiting: 'bg-amber-500 dark:bg-amber-300/90' }[tone];
  return <span className="inline-flex size-3.5 shrink-0 items-center justify-center"><span className={cn('size-[9px] rounded-full', colour, pulse && 'motion-safe:animate-status-pulse')} /></span>;
}
