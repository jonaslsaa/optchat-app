import { CheckIcon, ChevronDownIcon, SquareArrowOutUpRightIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Result } from '../protocol.ts';
import { useOverlay, walk } from './keys.ts';
import { app } from './store.ts';
import { Button, cn } from './ui.tsx';

/** T3 Code's "Open in" split button (its `OpenInPicker.tsx`): the main part opens in the editor files open in, and the chevron
 * lists the editors the server found on this machine; one picked opens there and is the one from then on. With no editor it
 * is "Open", in the Mac's text editor. Esc closes the list and nothing else (`useOverlay`). */
export function OpenIn({ onOpen }: { onOpen: (editor?: string) => void }) {
  const [found, setFound] = useState<Result<'editors'>>(), [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), main = useRef<HTMLButtonElement>(null), chevron = useRef<HTMLButtonElement>(null);
  useEffect(() => { void app.editors().then(setFound); }, []);
  useOverlay(open, () => setOpen(false), root, chevron);
  const current = found?.editors.find(editor => editor.id === found.current);
  // The option picked goes with the list, so the focus goes to the button that opens in it now.
  const pick = (id: string) => { setOpen(false); setFound(found => found && { ...found, current: id }); main.current?.focus(); onOpen(id); };
  return (
    <div ref={root} className="relative flex">
      <Button ref={main} variant="outline" className={cn(found?.editors.length && 'rounded-r-none')} onClick={() => onOpen()}>
        <SquareArrowOutUpRightIcon />{current ? `Open in ${current.label}` : 'Open'}
      </Button>
      {!!found?.editors.length && (
        <Button ref={chevron} variant="outline" size="icon-sm" aria-label="Open in…" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className="-ml-px rounded-l-none">
          <ChevronDownIcon />
        </Button>
      )}
      {open && found && (
        <ul role="listbox" aria-label="Editors" onKeyDown={walk} className="enter enter-grow absolute bottom-full left-0 z-50 mb-1 max-h-80 w-48 origin-bottom-left overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {found.editors.map(({ id, label }) => (
            <li key={id} role="option" aria-selected={id === found.current}>
              <button type="button" autoFocus={id === (found.current ?? found.editors[0]?.id)} onClick={() => pick(id)} className="flex h-8 w-full items-center gap-2 rounded-[3px] px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <span className="min-w-0 flex-1 truncate">{label}</span>{id === found.current && <CheckIcon className="size-3.5 text-muted-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
