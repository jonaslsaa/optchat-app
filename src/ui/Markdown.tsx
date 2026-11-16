import { WrapTextIcon } from 'lucide-react';
import { createContext, Fragment, isValidElement, lazy, memo, Suspense, use, useContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { highlighter, painter, type Token } from './highlight.ts';
import { splitMarkdownBlocks } from './markdownStreamBlocks.ts';
import { dollars } from './math.ts';
import { safe } from './safe.ts';
import { csv } from './table.ts';
import { Button, cn, CopyButton, Picture } from './ui.tsx';

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
const components: Components = {
  ...safe,
  // An image that is drawn, which only one of the profile's own is (`safe`), is shown large on a click; a link stays a link.
  img: props => { const drawn = safe.img(props); return drawn.type === 'img' ? <Picture src={String(props.src)} alt={props.alt} /> : drawn; },
  pre: ({ node: _, ...props }) => <CodeBlock {...props} />,
  code: ({ node: _, className, ...props }) => className?.split(' ').includes('math-inline') ? <Formula tex={String(props.children ?? '')} display={false} /> : <code className={className} {...props} />,
  table: Table,
};
const plugins = [remarkGfm, remarkMath, dollars];
const Block = memo(function Block({ source }: { source: string }) {
  return <Source value={source}><ReactMarkdown remarkPlugins={plugins} components={components}>{source}</ReactMarkdown></Source>;
});

/** The agent's Markdown. It is cut into blocks that do not depend on each other (T3 Code's `splitMarkdownBlocks`), so while a
 * reply streams only its last block is parsed again. */
export function Markdown({ text, streaming = false, className }: { text: string; streaming?: boolean; className?: string }) {
  const blocks = splitMarkdownBlocks(text) ?? [text];
  return (
    <div data-streaming={streaming || undefined} className={cn('chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]', className)}>
      {blocks.map((source, index) => <Block key={index} source={source} />)}
    </div>
  );
}
