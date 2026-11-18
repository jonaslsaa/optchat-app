import { WrapTextIcon } from 'lucide-react';
import { createContext, Fragment, isValidElement, lazy, memo, Suspense, use, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { highlighter, painter, type Token } from './highlight.ts';
import { splitMarkdownBlocks } from './markdownStreamBlocks.ts';
import { dollars } from './math.ts';
import { fileTarget } from './paths.ts';
import { link, pathOf, safe, shown } from './safe.ts';
import { app } from './store.ts';
import { csv } from './table.ts';
import { closed, paced } from './transcript.ts';
import { Button, cn, CopyButton } from './ui.tsx';
import { Picture } from './Picture.tsx';

const Line = memo(function Line({ tokens }: { tokens: Token[] }) {
  return tokens.map(({ text, color }, at) => <span key={at} style={{ color }}>{text}</span>);
});
/** Code in its language's colours. It waits for Shiki and the grammar (the plain code shows meanwhile), and stays plain in a
 * language Shiki does not know. While the block streams, only its last line is coloured and drawn again. */
function Coloured({ text, language, children }: { text: string; language: string; children: ReactNode }) {
  const shiki = use(highlighter(language));
  const paint = useMemo(() => shiki && painter(shiki, language), [shiki, language]);
  const lines = useMemo(() => { try { return paint?.(text); } catch { return undefined; } }, [paint, text]);
  return lines ? <code>{lines.map((tokens, at) => <Fragment key={at}>{at > 0 && '\n'}<Line tokens={tokens} /></Fragment>)}</code> : children;
}
/** A code block in T3 Code's frame: its language, if it names one, and buttons to wrap its lines and copy it. */
function CodeBlock({ children }: ComponentProps<'pre'>) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : {};
  const [wrapped, setWrapped] = useState(false), language = /language-(\S+)/.exec(code.className ?? '')?.[1], text = String(code.children ?? '');
  if (language === 'math') return <Formula tex={text} display />;
  return (
    <div data-wrap={wrapped} className={cn('my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-secondary text-start leading-snug dark:border-transparent dark:bg-input/32', !language && 'flex flex-row-reverse items-start')}>
      {/* A block that names its language has a line for it, with the buttons at its end. One that names none has only the
          buttons, beside the code and never over it. */}
      <div className={cn('flex shrink-0 select-none items-center justify-between gap-2 pt-1.5 pr-1.5', language ? 'pl-3' : 'pl-1.5')}>
        {language && <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">{language}</span>}
        <span className="flex gap-0.5">
          <Button variant={wrapped ? 'secondary' : 'ghost-muted'} size="icon-xs" title="Wrap lines" aria-pressed={wrapped} onClick={() => setWrapped(!wrapped)}><WrapTextIcon className="size-3" /></Button>
          <CopyButton text={text.replace(/\n$/, '')} label="Copy" />
        </span>
      </div>
      <pre className="min-w-0 flex-1">{language ? <Suspense fallback={children}><Coloured text={text} language={language}>{children}</Coloured></Suspense> : children}</pre>
    </div>
  );
}
// A chunk that could not be fetched leaves the formula as it was written.
const Typeset = lazy(() => import('./Typeset.tsx').catch(() => ({ default: ({ fallback }: { fallback: ReactNode }) => fallback })));
/** A formula (`$…$`, `$$…$$` or a `math` block), drawn by KaTeX once it has loaded and as it was written until then. */
function Formula({ tex, display }: { tex: string; display: boolean }) {
  const written = <span className="font-mono text-xs">{display ? `$$${tex.trim()}$$` : `$${tex}$`}</span>;
  return <span className={cn(display ? 'my-[0.65rem] block overflow-x-auto overflow-y-hidden' : 'inline-block max-w-full overflow-x-auto overflow-y-hidden align-middle')}>
    <Suspense fallback={written}><Typeset tex={tex.trim()} display={display} fallback={written} /></Suspense>
  </span>;
}
/** The block a table is in: a table can be copied as it was written, which is its place in that source, or as CSV. */
const Source = createContext('');
function Table({ node, ...props }: ComponentProps<'table'> & ExtraProps) {
  const source = useContext(Source);
  return (
    <div>
      <div className="table-container"><table {...props} /></div>
      <div className="-mt-2 flex select-none justify-end gap-0.5">
        <CopyButton text={source.slice(node?.position?.start.offset, node?.position?.end.offset)} label="Copy as Markdown">Markdown</CopyButton>
        <CopyButton text={node ? csv(node) : ''} label="Copy as CSV">CSV</CopyButton>
      </div>
    </div>
  );
}
/** The window whose chat is drawn: a file its agent names is looked for in the folder that window runs in. */
export const InWindow = createContext<string | undefined>(undefined);
/** A file the agent named, as a button that opens it in your editor once the server says it is there; until then, and when
 * it is not, as it was written. */
function File({ window, path, line, children }: { window: string; path: string; line?: number; children: ReactNode }) {
  return <Suspense fallback={children}><Opens window={window} path={path} line={line}>{children}</Opens></Suspense>;
}
function Opens({ window, path, line, children }: { window: string; path: string; line?: number; children: ReactNode }) {
  if (!use(app.isFile(window, path))) return children;
  return <button type="button" className="file-link" title={`Open ${path}${line ? ` at line ${line}` : ''} in your editor`} onClick={() => void app.openFile(window, path, line)}>{children}</button>;
}
/** Inside a link: what it holds (code, an image) is no control of its own, so a click is the link's alone. */
const InLink = createContext(false);
/** A link whose target is a path: a file in the window's folder opens in your editor, and any other is its words alone, since
 * the page has nothing at that address. */
function Link({ node: _, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  const window = useContext(InWindow), target = props.href && !/^[a-z][\w+.-]*:|^\/\//i.test(props.href) ? fileTarget(props.href) : undefined;
  const children = <InLink value>{props.children}</InLink>;
  return window && target ? <File window={window} {...target}>{children}</File> : link({ ...props, children });
}
/** Inline code: a formula when remark-math made it one, a file button when it is the path of a file in the window's folder. */
function Code({ node: _, ...props }: ComponentProps<'code'> & { node?: unknown }) {
  const window = useContext(InWindow), linked = useContext(InLink);
  if (props.className?.split(' ').includes('math-inline')) return <Formula tex={String(props.children ?? '')} display={false} />;
  const target = fileTarget(String(props.children)), code = <code {...props} />;
  return window && target && !linked ? <File window={window} {...target}>{code}</File> : code;
}
/** An image that is drawn, which only one the reply may draw is (`safe`), is shown large on a click; a link stays a link. In a
 * link it is the link's: drawn plain, or its words. A picture on this machine that is no longer there, or never was one, says so. */
function Image(props: ComponentProps<'img'> & ExtraProps) {
  const at = shown(props.src), linked = useContext(InLink), [gone, setGone] = useState(false);
  if (!at) return linked ? props.alt || String(props.src ?? '') : safe.img(props);
  if (gone) return <span className="inline-block rounded-md border border-border px-2 py-0.5 text-muted-foreground text-xs">No image at {pathOf(String(props.src))}</span>;
  const drawn = { src: at, alt: props.alt, className: 'max-h-[30rem]', onError: () => setGone(true) };
  return linked ? <img {...drawn} title={props.title} /> : <Picture {...drawn} />;
}
const components: Components = {
  ...safe,
  img: Image,
  a: Link,
  code: Code,
  pre: ({ node: _, ...props }) => <CodeBlock {...props} />,
  table: Table,
};
const plugins = [remarkGfm, remarkMath, dollars];
const Block = memo(function Block({ source }: { source: string }) {
  return <Source value={source}><ReactMarkdown remarkPlugins={plugins} components={components}>{source}</ReactMarkdown></Source>;
});

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** What is shown of a reply while it streams: what has come, let out at a steady pace (`paced`), one step a frame, without what
 * its end has opened and not closed (`closed`). What there was when it was first drawn shows at once, and so does all of it once
 * the reply has ended or was stopped. With reduced motion there is no pace. */
function useShown(text: string, streaming: boolean) {
  const [shown, setShown] = useState(text.length), stepped = useRef(0), behind = streaming && !still && shown < text.length;
  useEffect(() => {
    if (!behind) { stepped.current = 0; return; }
    const frame = requestAnimationFrame(now => { setShown(paced(text, shown, stepped.current ? now - stepped.current : 16)); stepped.current = now; });
    return () => cancelAnimationFrame(frame);
  }, [behind, text, shown]);
  return streaming ? closed(still ? text : text.slice(0, shown)) : text;
}
/** The agent's Markdown. It is cut into blocks that do not depend on each other (T3 Code's `splitMarkdownBlocks`), so while a
 * reply streams only its last block is parsed again. */
export function Markdown({ text: whole, streaming = false, className }: { text: string; streaming?: boolean; className?: string }) {
  const text = useShown(whole, streaming), blocks = splitMarkdownBlocks(text) ?? [text];
  return (
    <div data-streaming={streaming || undefined} className={cn('chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]', className)}>
      {blocks.map((source, index) => <Block key={index} source={source} />)}
    </div>
  );
}
