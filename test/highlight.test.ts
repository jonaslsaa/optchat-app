import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlighter, painter } from '../src/ui/highlight.ts';

// A block whose lines depend on the ones before: a template string and a comment that run over lines.
const CODE = Array.from({ length: 120 }, (_, n) => `const value${n} = \`line ${n}\n  still \${${n} + 1}\`; /* a comment\n that goes on */ export function f${n}(a: number) { return a * ${n}; }\n`).join('');

test('a code block is coloured the same while it streams as when it is whole, reading each finished line once', async () => {
  const shiki = await highlighter('ts');
  assert.ok(shiki);
  const whole = painter(shiki, 'ts')(CODE);
  assert.deepEqual(whole.map(line => line.map(token => token.text).join('')).join('\n'), CODE.slice(0, -1)); // Less Markdown's last newline.
  assert.ok(whole.flat().some(token => /^light-dark\(#\w+, #\w+\)$/.test(token.color ?? '')), 'a token has its light and its dark colour');

  // Count what Shiki is given to read as the block arrives 17 characters at a time, each time with the newline Markdown adds.
  let read = 0;
  const counting = new Proxy(shiki, { get: (target, key) => key === 'codeToTokens' ? (code: string, options: Parameters<typeof shiki.codeToTokens>[1]) => { read += code.length; return target.codeToTokens(code, options); } : Reflect.get(target, key) });
  const paint = painter(counting, 'ts');
  let lines = paint(''), before = lines;
  for (let end = 17; end < CODE.length + 17; end += 17) { before = lines; lines = paint(`${CODE.slice(0, end).replace(/\n$/, '')}\n`); }
  assert.deepEqual(lines, whole);
  assert.ok(read < CODE.length * 3, `read ${read} characters for a block of ${CODE.length}`);
  // The lines it had are the same arrays, so their rows are not drawn again.
  assert.ok(before.length > 100 && before.slice(0, -1).every((line, at) => line === lines[at]));
  // A block that is another now starts over.
  assert.deepEqual(paint('let x = 1;\n').map(line => line.map(token => token.text).join('')), ['let x = 1;']);
});

test('a language Shiki does not know has no highlighter, and is asked for once', async () => {
  assert.equal(await highlighter('no-such-language'), undefined);
  assert.equal(highlighter('no-such-language'), highlighter('no-such-language'));
  assert.equal(await highlighter('constructor'), undefined);
});
