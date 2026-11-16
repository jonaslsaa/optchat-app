import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo, type ReactNode } from 'react';

/** KaTeX and its fonts are a chunk of their own, fetched the first time a reply has a formula (T3 Code's `MathTypeset`). */
export default function Typeset({ tex, display, fallback }: { tex: string; display: boolean; fallback: ReactNode }) {
  const html = useMemo(() => {
    // TeX that KaTeX cannot read, such as a formula still being written, stays as it was written.
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxSize: 20, maxExpand: 1000 }); } catch { return undefined; }
  }, [tex, display]);
  // KaTeX escapes the TeX it draws, and `trust: false` keeps it from writing links or attributes.
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : fallback;
}
