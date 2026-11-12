import { WrapTextIcon } from 'lucide-react';
import { Fragment, isValidElement, memo, Suspense, use, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlighter, painter, type Token } from './highlight.ts';
import { splitMarkdownBlocks } from './markdownStreamBlocks.ts';
import { safe } from './safe.ts';
import { Button, cn, CopyButton } from './ui.tsx';

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
  return (
    <div data-wrap={wrapped} className="my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-secondary text-start leading-snug dark:border-transparent dark:bg-input/32">
      <div className="flex select-none items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">{language}</span>
        <span className="flex gap-0.5">
          <Button variant={wrapped ? 'secondary' : 'ghost-muted'} size="icon-xs" title="Wrap lines" aria-pressed={wrapped} onClick={() => setWrapped(!wrapped)}><WrapTextIcon className="size-3" /></Button>
          <CopyButton text={text.replace(/\n$/, '')} label="Copy" />
        </span>
      </div>
      <pre>{language ? <Suspense fallback={children}><Coloured text={text} language={language}>{children}</Coloured></Suspense> : children}</pre>
    </div>
  );
}
const components: Components = {
  ...safe,
  pre: ({ node: _, ...props }) => <CodeBlock {...props} />,
  table: ({ node: _, ...props }) => <div className="table-container"><table {...props} /></div>,
};
const Block = memo(function Block({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{source}</ReactMarkdown>;
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
