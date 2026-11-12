import { CornerUpRightIcon, ListPlusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PiRecord, WindowState } from '../protocol.ts';
import { label, useShortcuts } from './keys.ts';
import { app } from './store.ts';
import type { Live } from './transcript.ts';
import { Button, cn, Kbd, Spinner } from './ui.tsx';

/** What you were typing in each window, kept while you look at another. */
const drafts = new Map<string, string>();

/** A question from Pi or one of its extensions (`extension_ui_request`): a choice, a yes or no, or a line of text. */
function Dialog({ window, dialog }: { window: string; dialog: PiRecord }) {
  const id = String(dialog.id), options = Array.isArray(dialog.options) ? dialog.options.filter(option => typeof option === 'string') : [];
  const [value, setValue] = useState(typeof dialog.prefill === 'string' ? dialog.prefill : '');
  const answer = (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void app.answer(window, { id, ...response });
  return (
    <div role="dialog" aria-label={String(dialog.title ?? 'Question')} className="rounded-2xl border border-warning/32 bg-warning-surface px-3.5 py-3 text-sm">
      <p className="font-medium">{String(dialog.title ?? 'Pi asks')}</p>
      {typeof dialog.message === 'string' && <p className="mt-0.5 text-muted-foreground">{dialog.message}</p>}
      {dialog.method === 'editor' && (
        <textarea autoFocus rows={4} aria-label={String(dialog.title ?? 'Answer')} value={value} onChange={event => setValue(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) answer({ value }); }} className="mt-2 block max-h-64 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      )}
      {dialog.method === 'input' && (
        <input autoFocus aria-label={String(dialog.title ?? 'Answer')} value={value} placeholder={typeof dialog.placeholder === 'string' ? dialog.placeholder : ''} onChange={event => setValue(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) answer({ value }); }} className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      )}
      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost-muted" onClick={() => answer(dialog.method === 'confirm' ? { confirmed: false } : { cancelled: true })}>{dialog.method === 'confirm' ? 'No' : 'Cancel'}</Button>
        {dialog.method === 'confirm' && <Button size="sm" autoFocus onClick={() => answer({ confirmed: true })}>Yes</Button>}
        {dialog.method === 'select' && options.map((option, index) => <Button key={option} variant="outline" size="sm" autoFocus={index === 0} onClick={() => answer({ value: option })}>{option}</Button>)}
        {(dialog.method === 'input' || dialog.method === 'editor') && <Button size="sm" onClick={() => answer({ value })}>Send</Button>}
      </div>
    </div>
  );
}

/** Where you type. You can always type: while the agent runs, Enter steers it and ⌘Enter queues your message for when it has
 * stopped, and Esc stops it. The look is T3 Code's composer (MIT, see THIRD_PARTY_NOTICES.md), over a plain textarea. */
export function Composer({ window, live }: { window: WindowState; live: Live }) {
  const [text, setText] = useState(drafts.get(window.id) ?? ''), [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const running = window.status === 'running', queued = [...live.queued.steering, ...live.queued.followUp];
  const change = (value: string) => { drafts.set(window.id, value); setText(value); };
  useEffect(() => area.current?.focus(), [window.id]);

  const send = async (later: boolean) => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true); change('');
    // A message the server refused goes back where it was typed, before what was typed since.
    if (!await app.send(window.id, message, later)) change([message, drafts.get(window.id)].filter(Boolean).join('\n\n'));
    setSending(false);
  };
  const stop = async () => {
    const waiting = await app.stop(window.id);
    if (waiting.length) change([...waiting, drafts.get(window.id) ?? ''].filter(Boolean).join('\n\n'));
  };
  // Esc stops the agent wherever the focus is.
  useShortcuts((): Record<string, () => void> => running ? { escape: () => void stop() } : {}, [running, window.id]);
  return (
    <div className="shrink-0 px-3 pb-3 sm:px-12 sm:pb-4">
      <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-2">
        {queued.length > 0 && (
          <ol aria-label="Messages waiting for the agent" className="flex flex-col items-end gap-2 pb-1">
            {queued.map((message, index) => (
              <li key={index} className="flex min-w-0 max-w-[80%] flex-col items-end gap-0.5">
                <span className="me-1 flex items-center gap-1 text-muted-foreground text-xs leading-none">
                  {index < live.queued.steering.length ? <><CornerUpRightIcon className="size-3" />Steer · waiting to be read</> : <><ListPlusIcon className="size-3" />Queued for after this run</>}
                </span>
                <p className="whitespace-pre-wrap rounded-2xl border border-muted-foreground/40 border-dashed px-3 py-2 text-muted-foreground text-sm [overflow-wrap:anywhere]">{message}</p>
              </li>
            ))}
          </ol>
        )}
        {live.dialogs.map(dialog => <Dialog key={String(dialog.id)} window={window.id} dialog={dialog} />)}
        {window.error && window.status === 'stopped' && (
          <p role="alert" className="rounded-xl border border-error/24 bg-error-surface px-3.5 py-2.5 text-error-foreground text-sm [overflow-wrap:anywhere]">{window.error}</p>
        )}
        <div className="relative isolate rounded-2xl bg-card shadow-composer after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-black/8 dark:bg-(--surface-raised) dark:shadow-none dark:after:border-white/8">
          <div className="relative px-4 pt-3.5 pb-2">
            <textarea
              ref={area} value={text} rows={1} aria-label="Message"
              placeholder={running ? 'Steer the agent, or queue a message for later' : window.role === 'main' ? 'Message the main chat' : window.completed ? 'A message starts a new connected window' : 'Message this window'}
              onChange={event => change(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event.metaKey || event.ctrlKey); }
              }}
              className="field-sizing-content block max-h-52 min-h-[2lh] w-full resize-none overflow-y-auto bg-transparent text-foreground text-sm leading-relaxed placeholder:text-placeholder focus:outline-none"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 px-2 pb-2">
            <p className="min-w-0 flex-1 truncate ps-2 text-muted-foreground text-xs">
              {window.status === 'starting' ? <span className="inline-flex items-center gap-1.5"><Spinner />Starting Pi</span>
                : running ? <><Kbd>{label('enter')}</Kbd> steer · <Kbd>{label('mod+enter')}</Kbd> queue · <Kbd>Esc</Kbd> stop</>
                : window.completed ? 'Completed: the main chat has this conversation'
                : live.status.optchat?.replace(/^OptChat: /, '') ?? (window.status === 'stopped' ? 'Pi starts with your first message' : '')}
            </p>
            {running && !text.trim() ? (
              <button type="button" aria-label="Stop the agent" title="Stop (Esc)" onClick={() => void stop()} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/90 text-white shadow-destructive/24 shadow-xs inset-shadow-control-highlight transition-colors duration-150 hover:bg-destructive active:shadow-none">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" /></svg>
              </button>
            ) : (
              <button type="button" aria-label={running ? 'Steer the agent' : 'Send'} title={running ? `Steer (${label('enter')})` : `Send (${label('enter')})`} disabled={!text.trim() || sending} onClick={() => void send(false)}
                className={cn('relative isolate flex size-8 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:inset-shadow-control-highlight hover:scale-105 hover:bg-message-action-hover active:shadow-none disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none')}>
                {running ? <CornerUpRightIcon className="size-3.5" /> : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" /></svg>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
