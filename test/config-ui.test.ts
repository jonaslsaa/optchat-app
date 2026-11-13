import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Setting } from '../src/protocol.ts';
import { field, model, named, said, typed } from '../src/ui/config.ts';

const setting = (kind: Setting['kind'], more: Partial<Setting> = {}): Setting => ({ key: 'k', kind, label: 'A setting', description: '', applies: '', value: 1, default: 1, ...more });

test('a number is shown and typed as you would say it, and kept as pi-optchat keeps it', () => {
  const share = setting('percent'), size = setting('number', { unit: 'KB' }), count = setting('number', { unit: '' });
  // A percent is a fraction of 1 in the file and a percentage in the field, to a tenth.
  assert.deepEqual([field(share, 0.3), said(share, 0.3), said(share, 0.125), said(share, 0)], ['30', '30%', '12.5%', '0%']);
  assert.deepEqual([typed(share, '45'), typed(share, ' 12.5 % '), typed(share, '0')], [0.45, 0.125, 0]);
  assert.deepEqual([field(size, 16), said(size, 16), said(count, 8), said(setting('toggle'), true), said(setting('toggle'), false)], ['16', '16 KB', '8', 'on', 'off']);
  // Whether a number will do is pi-optchat's to say: only what is no number at all is not sent to it.
  assert.deepEqual([typed(count, '8'), typed(count, '1.5'), typed(count, '-2')], [8, 1.5, -2]);
  for (const text of ['', '  ', 'eight', '8 agents', 'Infinity', '%']) assert.equal(typed(count, text), undefined, text);
});

test('a model is written provider/id, and its id may have a slash in it', () => {
  assert.deepEqual(model(' openrouter/anthropic/claude-sonnet-5-5 '), { provider: 'openrouter', model: 'anthropic/claude-sonnet-5-5' });
  assert.equal(named({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5-5' }), 'openrouter/anthropic/claude-sonnet-5-5');
  for (const text of ['', 'claude-sonnet-5-5', '/claude', 'anthropic/']) assert.equal(model(text), undefined, text);
});
