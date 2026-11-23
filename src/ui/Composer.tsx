import { CircleAlertIcon, CornerUpRightIcon, ImagePlusIcon, ListPlusIcon, PencilIcon, QuoteIcon, XIcon } from 'lucide-react';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type MouseEvent, type Ref } from 'react';
import type { PiRecord, WindowState } from '../protocol.ts';
import { anchorOf, CiteCommentPopover, CiteGroup, SkillChip, type CiteAnchor } from './Cite.tsx';
import { called, cited, citing, commented, joined, yours, type Cite } from './cite.ts';
import { useCommands, useMentions } from './Commands.tsx';
import { address, image, KINDS, sorted } from './images.ts';
import { escapes, label, matches, useHeld, useShortcuts } from './keys.ts';
import { Model } from './Model.tsx';
import { app, type State } from './store.ts';
import { failure, news, recalled, type Item, type Live, type Notice } from './transcript.ts';
import { Button, cn, Kbd, Spinner } from './ui.tsx';
import { Picture } from './Picture.tsx';

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

/** A waiting message's cite card sits 5px in from the dashed border it meets, so its 10px corners follow the bubble's 16px
 * ones (16 = 10 + 5 + the 1px border); the text keeps its padding. */
const QUEUED_BLEED = '-mx-[7px] first:-mt-[3px] last:-mb-[3px]';
/** Your messages an agent has not read yet, under its chat: the last `later` of them wait for its run to end. Where ⌥↑ takes
 * them back into the box (`editable`), the first says so. */
export function Queued({ messages, later = 0, editable = false }: { messages: readonly string[]; later?: number; editable?: boolean }) {
  if (!messages.length) return null;
  return (
    <ol aria-label="Messages waiting for the agent" className="flex flex-col items-end gap-2 pb-1">
      {messages.map(yours).map(({ skill, cites, text }, index) => (
        <li key={index} className="flex min-w-0 max-w-[80%] flex-col items-end gap-0.5">
          <span className="me-1 flex items-center gap-1 text-muted-foreground text-xs leading-none">
            {index < messages.length - later ? <><CornerUpRightIcon className="size-3" />Steer · waiting to be read</> : <><ListPlusIcon className="size-3" />Queued for after this run</>}
            {editable && !index && <> · <Kbd>{label('alt+↑')}</Kbd> edit</>}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-muted-foreground/40 border-dashed px-3 py-2 text-muted-foreground text-sm [overflow-wrap:anywhere]">
            {skill && <SkillChip skill={skill} />}{cites.length > 0 && <CiteGroup cites={cites} queued className={QUEUED_BLEED} />}{(text || !cites.length && !skill) && <p className="whitespace-pre-wrap">{text || 'Image'}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
/** The pencil and × on a citation's chip. */
const CHIP_ACTION = 'shrink-0 rounded-[5px] p-[3px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 dark:hover:bg-white/9';
/** The round button that sends what is typed: to an agent in a run (`steer`) it is a message on its way in, and with ⌘ or Ctrl
 * down (`queue`) one that waits for the run to end. */
export function SendButton({ steer, queue = false, ...props }: { steer: boolean; queue?: boolean; disabled: boolean; onClick: (event: MouseEvent) => void }) {
  const [name, keys] = queue ? ['Queue the message for after this run', `Queue (${label('mod+enter')})`] : steer ? ['Steer the agent', `Steer (${label('enter')})`] : ['Send', `Send (${label('enter')})`];
  return (
    <button type="button" aria-label={name} title={keys} {...props}
      className="relative isolate flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:inset-shadow-control-highlight hover:scale-105 hover:bg-message-action-hover active:shadow-none disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none">
      {queue ? <ListPlusIcon className="size-3.5" /> : steer ? <CornerUpRightIcon className="size-3.5" /> : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" /></svg>}
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
export function Composer({ state, window, live, chat, onSend, ref }: { state: State; window: WindowState; live: Live; chat: readonly Item[]; onSend?: () => void; ref?: Ref<{ cite: (cite: Cite, anchor?: CiteAnchor) => void; closeComment: () => void }> }) {
  // The message as it would be sent: what is typed, under what it cites. The box holds the one, and the chips are the other.
  const [draft, setDraft] = useState(() => app.draft(window.id)), [sending, setSending] = useState(false), { cites, text } = useMemo(() => cited(draft), [draft]);
  // Which citation chip's comment popover is open (`fresh` removes it on Cancel/Esc; `above` opens over a chip in the composer).
  const [editing, setEditing] = useState<{ index: number; anchor: CiteAnchor; fresh: boolean; above: boolean; opener?: Element | null }>();
  const popover = useRef<ComponentRef<typeof CiteCommentPopover>>(null);
  const images = state.attached[window.id] ?? [], [refused, setRefused] = useState<string>(), [reading, setReading] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null), [caret, setCaret] = useState(0);
  const running = window.status === 'running', queued = [...live.queued.steering, ...live.queued.followUp];
  // ⌘ or Ctrl down while it runs: the button, as ⌘↵, queues the message for after the run.
  const queueing = useHeld(event => event.metaKey || event.ctrlKey) && running;
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
  // An `@` where the caret is lists files, and the list of commands is then shut.
  const mentions = useMentions(window, text, caret, (typed, at) => { change(typed); setCaret(at); }, area, root);
  // A text the box is given (↑, a message sent back) has the caret where the box puts it, at its end: an `@` is read there, and
  // not where the caret was in the text before.
  useLayoutEffect(() => { if (area.current) setCaret(area.current.selectionStart); }, [text]);
  // A message that cites begins with what it cites, which is no command to Pi: a `/` is then a letter, and lists nothing.
  const commands = useCommands(state, window, cites.length || mentions.active ? '' : text, change, area, root);
  // What was cited in the chat or in the memory view is one more chip, and opens its comment popover where the Cite trigger was.
  useImperativeHandle(ref, () => ({
    cite: (cite, anchor) => {
      const next = [...cites, cite];
      keep(citing(next, text));
      if (anchor) setEditing({ index: next.length - 1, anchor, fresh: true, above: false });
      else area.current?.focus();
    },
    closeComment: () => {
      if (popover.current) popover.current.commit();
      setEditing(undefined);
    },
  }));
  const empty = !text.trim() && !images.length && !cites.length;

  const send = async (later: boolean, override?: string) => {
    const message = override ?? citing(cites, text.trim()).trim();
    if ((!override && empty) || sending || reading) return;
    setEditing(undefined); setSending(true); keep(''); app.attach(window.id, []); setRefused(undefined); onSend?.();
    // A message the server refused goes back where it was typed, with its images, before what was typed since.
    if (!await app.send(window.id, message, later, images)) { keep(joined([message, app.draft(window.id)])); app.attach(window.id, [...images, ...attached()]); }
    setSending(false);
  };
  const edited = editing && cites[editing.index];
  const saveComment = (comment: string, focus: boolean) => {
    if (!editing || !cites[editing.index]) return;
    const next = cites.map((item, at) => at === editing.index ? commented(item, comment) : item);
    keep(citing(next, text));
    setEditing(undefined);
    if (focus) area.current?.focus();
  };
  const saveAndSend = (comment: string) => {
    if (!editing || !cites[editing.index] || sending || reading > 0) return;
    const next = cites.map((item, at) => at === editing.index ? commented(item, comment) : item);
    keep(citing(next, text));
    const message = citing(next, text.trim()).trim();
    void send(false, message);
  };
  const cancelComment = () => {
    if (!editing) return;
    if (editing.fresh) keep(citing(cites.filter((_, at) => at !== editing.index), text));
    setEditing(undefined);
    area.current?.focus();
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
            <ul data-gallery="" aria-label="Images to send" className="flex flex-wrap gap-2.5 px-4 pt-3.5">
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
                <li key={at} title={cite.text ? cite.text : undefined} className="enter flex h-6.5 min-w-0 max-w-64 items-center gap-1.5 rounded-[7px] border border-border bg-background ps-2 pe-[3px] text-xs dark:border-white/12">
                  <QuoteIcon className="size-3 shrink-0 text-cite-ink" />
                  <span className={cn('min-w-0 truncate', cite.comment ? 'text-foreground' : 'text-muted-foreground')}>{called(cite)}</span>
                  <button type="button" data-cite-action aria-label={cite.comment ? 'Edit citation comment' : 'Add comment to citation'} title={cite.comment ? 'Edit comment' : 'Add comment'} aria-pressed={editing?.index === at}
                    onClick={event => {
                      if (editing?.index === at) { if (popover.current?.commit()) area.current?.focus(); return; }
                      if (popover.current && !popover.current.commit()) return;
                      setEditing({ index: at, anchor: anchorOf(event.currentTarget), fresh: false, above: true, opener: event.currentTarget });
                    }}
                    className={cn(CHIP_ACTION, editing?.index === at && 'bg-accent text-foreground dark:bg-white/9')}><PencilIcon className="size-3" /></button>
                  <button type="button" data-cite-action aria-label="Remove the citation" onClick={() => {
                    const updated = editing && editing.index !== at ? popover.current?.draft() : undefined;
                    const next = cites.map((item, index) => updated !== undefined && index === editing?.index ? commented(item, updated) : item).filter((_, index) => index !== at);
                    setEditing(undefined);
                    keep(citing(next, text));
                    area.current?.focus();
                  }} className={CHIP_ACTION}><XIcon className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
          {edited && editing && (
            <CiteCommentPopover
              ref={popover}
              key={`${editing.index}-${editing.fresh}-${editing.anchor.top}-${editing.anchor.right}`}
              item={edited} anchor={editing.anchor} above={editing.above} showQuote={editing.above} opener={editing.opener} canSend={!sending && reading === 0}
              onSave={(comment, focus) => saveComment(comment, focus)}
              onSaveAndSend={saveAndSend}
              onCancel={cancelComment}
            />
          )}
          {refused && <p role="alert" className="px-4 pt-3 text-error-foreground text-xs">{refused}</p>}
          <div ref={root} className="relative px-4 pt-3.5 pb-2">
            {commands.menu}{mentions.menu}
            <textarea
              ref={area} value={text} rows={1} aria-label="Message" {...mentions.active ? mentions.field : commands.field}
              placeholder={running ? 'Steer the agent, or queue a message for later' : window.role === 'main' ? 'Message the main chat' : window.completed ? 'A message starts a new connected window' : 'Message this window'}
              onChange={event => { change(event.target.value); setCaret(event.target.selectionStart); }}
              onSelect={event => setCaret(event.currentTarget.selectionStart)}
              // A file that was copied is attached, and its name, which Finder copies with it, is not typed. Copied cells are
              // text, a table and a picture of them: there the text is what is pasted.
              onPaste={event => { const { files, types } = event.clipboardData; if (files.length && !(types.includes('text/plain') && types.includes('text/html'))) { event.preventDefault(); void add(files); } }}
              onKeyDown={event => {
                // The list a `/` or an `@` opens gets its keys first: the arrows, Tab and Enter.
                if (mentions.keyed(event) || commands.keyed(event)) return;
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
              <SendButton steer={running} queue={queueing} disabled={empty || sending || reading > 0} onClick={event => void send(event.metaKey || event.ctrlKey)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
