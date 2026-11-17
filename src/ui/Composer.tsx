import { CircleAlertIcon, CornerUpRightIcon, ImagePlusIcon, ListPlusIcon, QuoteIcon, XIcon } from 'lucide-react';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { PiRecord, WindowState } from '../protocol.ts';
import { CiteCard } from './Cite.tsx';
import { called, cited, citing, joined, type Cite } from './cite.ts';
import { useCommands } from './Commands.tsx';
import { address, image, KINDS, sorted } from './images.ts';
import { escapes, label, matches, useShortcuts } from './keys.ts';
import { Model } from './Model.tsx';
import { app, type State } from './store.ts';
import { failure, news, recalled, type Item, type Live, type Notice } from './transcript.ts';
import { Button, cn, Kbd, Picture, Spinner } from './ui.tsx';

/** A question from Pi or one of its extensions (`extension_ui_request`): a choice, a yes or no, or a line of text. Esc in it
 * says no, or cancels, as its first button does and as Esc does in Pi's terminal; the run it belongs to goes on. */
function Dialog({ window, dialog }: { window: string; dialog: PiRecord }) {
  const id = String(dialog.id), options = Array.isArray(dialog.options) ? dialog.options.filter(option => typeof option === 'string') : [];
  const [value, setValue] = useState(typeof dialog.prefill === 'string' ? dialog.prefill : '');
  const answer = (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void app.answer(window, { id, ...response });
  const cancel = () => answer(dialog.method === 'confirm' ? { confirmed: false } : { cancelled: true });
  return (
    <div role="dialog" aria-label={String(dialog.title ?? 'Question')} onKeyDown={event => escapes(event, cancel)} className="enter rounded-2xl border border-warning/32 bg-warning-surface px-3.5 py-3 text-sm">
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
        <Button variant="ghost-muted" onClick={cancel}>{dialog.method === 'confirm' ? 'No' : 'Cancel'}</Button>
        {dialog.method === 'confirm' && <Button size="sm" autoFocus onClick={() => answer({ confirmed: true })}>Yes</Button>}
        {dialog.method === 'select' && options.map((option, index) => <Button key={option} variant="outline" size="sm" autoFocus={index === 0} onClick={() => answer({ value: option })}>{option}</Button>)}
        {(dialog.method === 'input' || dialog.method === 'editor') && <Button size="sm" onClick={() => answer({ value })}>Send</Button>}
      </div>
    </div>
  );
}

/** Why the window's Pi is not running, and what to do about it. */
function Failure({ error }: { error: string }) {
  const { title, detail, next } = failure(error);
  return (
    <div role="alert" className="enter flex gap-2.5 rounded-xl border border-error/24 bg-error-surface px-3.5 py-2.5 text-sm [overflow-wrap:anywhere]">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-error-foreground" />
      <div className="min-w-0">
        <p className="font-medium text-error-foreground">{title}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-foreground/80">{detail}</p>
        <p className="mt-1 text-muted-foreground">{next}</p>
      </div>
    </div>
  );
}

const TONES = { info: 'border-border', warning: 'border-warning/32 bg-warning-surface', error: 'border-error/24 bg-error-surface' };
/** What Pi or one of its extensions said in passing: why it did not take your message, a warning, a thing it did. */
function Said({ notice: { text, kind }, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('enter flex shrink-0 items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm [overflow-wrap:anywhere]', TONES[kind])}>
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-foreground/80">{text}</p>
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10"><XIcon className="size-3.5" /></button>
    </div>
  );
}

/** Your messages an agent has not read yet, under its chat: the last `later` of them wait for its run to end. Where ⌥↑ takes
 * them back into the box (`editable`), the first says so. */
export function Queued({ messages, later = 0, editable = false }: { messages: readonly string[]; later?: number; editable?: boolean }) {
  if (!messages.length) return null;
  return (
    <ol aria-label="Messages waiting for the agent" className="flex flex-col items-end gap-2 pb-1">
      {messages.map(cited).map(({ cites, text }, index) => (
        <li key={index} className="flex min-w-0 max-w-[80%] flex-col items-end gap-0.5">
          <span className="me-1 flex items-center gap-1 text-muted-foreground text-xs leading-none">
            {index < messages.length - later ? <><CornerUpRightIcon className="size-3" />Steer · waiting to be read</> : <><ListPlusIcon className="size-3" />Queued for after this run</>}
            {editable && !index && <> · <Kbd>{label('alt+↑')}</Kbd> edit</>}
          </span>
          <p className="flex flex-col gap-1.5 whitespace-pre-wrap rounded-2xl border border-muted-foreground/40 border-dashed px-3 py-2 text-muted-foreground text-sm [overflow-wrap:anywhere]">
            {cites.map((cite, at) => <CiteCard key={at} cite={cite} />)}{(text || !cites.length) && <span>{text || 'Image'}</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}
/** The round button that sends what is typed: to an agent in a run (`steer`) it is a message on its way in. */
export function SendButton({ steer, ...props }: { steer: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={steer ? 'Steer the agent' : 'Send'} title={steer ? `Steer (${label('enter')})` : `Send (${label('enter')})`} {...props}
      className="relative isolate flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:inset-shadow-control-highlight hover:scale-105 hover:bg-message-action-hover active:shadow-none disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none">
      {steer ? <CornerUpRightIcon className="size-3.5" /> : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" /></svg>}
    </button>
  );
}
/** Where you type. You can always type: while the agent runs, Enter steers it and ⌘Enter queues your message for when it has
 * stopped, and Esc stops it. The line under it says only what is news: how to steer a run, that Pi is starting, agents at
 * work. ↑ in an empty box brings back what you said last in the `chat`, and ↑ and ↓ go on through it (`recalled`), from the
 * first and the last line of what is in the box. Beside the button that
 * sends is the model the agent runs on, which is picked there. The look is T3 Code's composer
 * (MIT, see THIRD_PARTY_NOTICES.md), over a plain textarea. What the message cites (`ref.cite` adds to it) stands over the
 * box as chips, as its images do, and is sent in front of what is typed (`citing`). */
export function Composer({ state, window, live, chat, onSend, ref }: { state: State; window: WindowState; live: Live; chat: readonly Item[]; onSend?: () => void; ref?: Ref<{ cite: (cite: Cite) => void }> }) {
  // The message as it would be sent: what is typed, under what it cites. The box holds the one, and the chips are the other.
  const [draft, setDraft] = useState(() => app.draft(window.id)), [sending, setSending] = useState(false), { cites, text } = useMemo(() => cited(draft), [draft]);
  const images = state.attached[window.id] ?? [], [refused, setRefused] = useState<string>(), [reading, setReading] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null);
  const running = window.status === 'running', queued = [...live.queued.steering, ...live.queued.followUp];
  // It is kept as it is typed (`app.draft`): while you look at another window, and when the page is opened again.
  const keep = (message: string) => { setDraft(message); app.keep(window.id, message); }, change = (typed: string) => keep(citing(cites, typed));
  const attached = () => app.state.attached[window.id] ?? [];
  /** Files that were pasted, dropped or chosen go with the message as images; one that cannot says why, and the rest still do.
   * Nothing is sent while one is being read, so a message never leaves without the image that was given first. */
  const add = async (files: Iterable<File>) => {
    const { taken, refused } = sorted(files, attached());
    setRefused(refused.join(' ') || undefined); setReading(count => count + 1);
    const added = await Promise.all(taken.map(image)).finally(() => setReading(count => count - 1));
    app.attach(window.id, [...attached(), ...added]);
  };
  useEffect(() => area.current?.focus(), [window.id]);
  // A message that cites begins with what it cites, which is no command to Pi: a `/` is then a letter, and lists nothing.
  const commands = useCommands(state, window, cites.length ? '' : text, change, area);
  // What was cited in the chat or in the memory view is one more chip, and the keys are where the message is typed.
  useImperativeHandle(ref, () => ({ cite: cite => { keep(citing([...cites, cite], text)); area.current?.focus(); } }));
  const empty = !text.trim() && !images.length && !cites.length;

  const send = async (later: boolean) => {
    const message = citing(cites, text.trim()).trim();
    if (empty || sending || reading) return;
    setSending(true); keep(''); app.attach(window.id, []); setRefused(undefined); onSend?.();
    // A message the server refused goes back where it was typed, with its images, before what was typed since.
    if (!await app.send(window.id, message, later, images)) { keep(joined([message, app.draft(window.id)])); app.attach(window.id, [...images, ...attached()]); }
    setSending(false);
  };
  // What the agent had not read yet is back in the box, in front of what was typed since, as Pi's terminal puts it back: on
  // Esc, which stops the run, and on ⌥↑, which lets it go on.
  const takeBack = async (method: 'abort' | 'dequeue') => {
    const waiting = await app.takeBack(window.id, method);
    if (!waiting.length) return;
    keep(joined([...waiting, app.draft(window.id)]));
    // The caret is at the end, once the box holds it: also where only its citations changed, which leave the text as it was.
    requestAnimationFrame(() => area.current?.setSelectionRange(area.current.value.length, area.current.value.length));
  };
  const stop = () => {
    // The button that stops is gone once it has: the focus is where the next message is typed.
    area.current?.focus();
    return takeBack('abort');
  };
  // The button that dismissed is gone with its notice: the focus is where the next message is typed.
  const quiet = (text?: string) => { area.current?.focus(); app.quiet(window.id, text); };
  // Esc stops the agent while the keys are the chat's, as they are here: not from the panel beside it, nor from the memory view.
  // With no run to stop it takes what Pi said off the page.
  useShortcuts((): Record<string, () => void> => running ? { escape: () => void stop() } : live.notices.length ? { escape: () => quiet() } : {}, [running, window.id, live.notices.length], 'chat');
  return (
    <div data-keys="chat" className="shrink-0 px-3 pb-3 sm:px-12 sm:pb-4">
      <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-2">
        <Queued messages={queued} later={live.queued.followUp.length} editable />
        {live.dialogs.map(dialog => <Dialog key={String(dialog.id)} window={window.id} dialog={dialog} />)}
        {window.error && window.status === 'stopped' && <Failure error={window.error} />}
        {/* However much Pi says, the box you type in stays on the page: past a few lines they scroll. */}
        {live.notices.length > 0 && <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">{live.notices.map(notice => <Said key={notice.text} notice={notice} onDismiss={() => quiet(notice.text)} />)}</div>}
        <div onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void add(event.dataTransfer.files); } }}
          className="relative isolate rounded-2xl bg-card shadow-composer after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-black/8 dark:bg-(--surface-raised) dark:shadow-none dark:after:border-white/8">
          {images.length > 0 && (
            <ul aria-label="Images to send" className="flex flex-wrap gap-2.5 px-4 pt-3.5">
              {images.map((picture, at) => (
                <li key={at} className="relative">
                  <Picture src={address(picture)} className="size-14 rounded-lg object-cover" />
                  <button type="button" aria-label="Remove the image" onClick={() => app.attach(window.id, images.filter(other => other !== picture))} className="absolute -end-1.5 -top-1.5 rounded-full border bg-popover p-0.5 text-muted-foreground shadow-xs hover:text-foreground"><XIcon className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
          {cites.length > 0 && (
            <ul aria-label="Cited in the message" className="flex flex-wrap gap-1.5 px-4 pt-3.5">
              {cites.map((cite, at) => (
                <li key={at} title={called(cite) === cite.text ? undefined : cite.text} className="enter flex min-w-0 max-w-64 items-center gap-1 rounded-md bg-black/6 py-0.5 ps-1.5 pe-0.5 text-muted-foreground text-xs dark:bg-white/8">
                  <QuoteIcon className="size-3 shrink-0" />
                  <span className="min-w-0 truncate text-foreground/90">{called(cite)}</span>
                  <button type="button" aria-label="Remove the citation" onClick={() => { keep(citing(cites.filter(other => other !== cite), text)); area.current?.focus(); }} className="shrink-0 rounded-sm p-0.5 hover:bg-foreground/10 hover:text-foreground"><XIcon className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
          {refused && <p role="alert" className="px-4 pt-3 text-error-foreground text-xs">{refused}</p>}
          <div ref={commands.root} className="relative px-4 pt-3.5 pb-2">
            {commands.menu}
            <textarea
              ref={area} value={text} rows={1} aria-label="Message" {...commands.field}
              placeholder={running ? 'Steer the agent, or queue a message for later' : window.role === 'main' ? 'Message the main chat' : window.completed ? 'A message starts a new connected window' : 'Message this window'}
              onChange={event => change(event.target.value)}
              // A file that was copied is attached, and its name, which Finder copies with it, is not typed. Copied cells are
              // text, a table and a picture of them: there the text is what is pasted.
              onPaste={event => { const { files, types } = event.clipboardData; if (files.length && !(types.includes('text/plain') && types.includes('text/html'))) { event.preventDefault(); void add(files); } }}
              onKeyDown={event => {
                // The list a `/` opens gets its keys first: the arrows, Tab and Enter.
                if (commands.keyed(event)) return;
                // Backspace in an empty box takes the last citation off, as it would the letter before the caret.
                if (event.key === 'Backspace' && !text && cites.length) { event.preventDefault(); keep(citing(cites.slice(0, -1), '')); return; }
                // ⌥↑ takes the messages still waiting back into the box, to be edited and sent again; the run goes on.
                if (queued.length && matches(event, 'alt+arrowup') && !event.nativeEvent.isComposing) { event.preventDefault(); void takeBack('dequeue'); return; }
                if (event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); void send(event.metaKey || event.ctrlKey); }
                // ↑ on the first line and ↓ on the last go through what you said; on a line between, they move in the text.
                const up = event.key === 'ArrowUp', { selectionStart, selectionEnd } = event.currentTarget, edge = !(up ? text.slice(0, selectionStart) : text.slice(selectionEnd)).includes('\n');
                const past = (up || event.key === 'ArrowDown') && edge && !event.metaKey && !event.ctrlKey ? recalled(chat, draft, up) : undefined;
                if (past !== undefined) { event.preventDefault(); keep(past); }
              }}
              className="field-sizing-content block max-h-52 min-h-[2lh] w-full resize-none overflow-y-auto bg-transparent text-foreground text-sm leading-relaxed placeholder:text-placeholder focus:outline-none"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 px-2 pb-2">
            <p className="min-w-0 flex-1 truncate ps-2 text-muted-foreground text-xs">
              {window.status === 'starting' ? <span className="inline-flex items-center gap-1.5"><Spinner />Starting Pi…</span>
                : running ? <><Kbd>{label('enter')}</Kbd> steer · <Kbd>{label('mod+enter')}</Kbd> queue · <Kbd>Esc</Kbd> stop</>
                : window.status === 'stopped' ? null
                : news(live.status.optchat).join(' · ')}
            </p>
            <input ref={picker} type="file" hidden multiple accept={KINDS.join()} onChange={event => { void add(event.target.files ?? []); event.target.value = ''; }} />
            <Button variant="ghost-muted" size="icon-sm" aria-label="Attach an image" title="Attach an image" onClick={() => picker.current?.click()}><ImagePlusIcon /></Button>
            <Model state={state} window={window} />
            {running && empty ? (
              <button type="button" aria-label="Stop the agent" title="Stop (Esc)" onClick={() => void stop()} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/90 text-white shadow-destructive/24 shadow-xs inset-shadow-control-highlight transition-colors duration-150 hover:bg-destructive active:shadow-none">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" /></svg>
              </button>
            ) : (
              <SendButton steer={running} disabled={empty || sending || reading > 0} onClick={() => void send(false)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
