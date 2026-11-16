import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percent, THINKING } from 'pi-optchat/files';
import { THINKING as APP } from '../src/models.ts';
import type { Offered, Setting } from '../src/protocol.ts';
import { asked, field, LEVELS, model, named, offered, said, typed } from '../src/ui/config.ts';

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

test('a model is asked for at a level it has, since a running Pi refuses one at a level it has not as if it did not list the model', () => {
  const models: Offered[] = [{ provider: 'anthropic', id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', levels: ['low', 'medium', 'high'] }, { provider: 'anthropic', id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', levels: ['off'] }];
  // Off is not among its levels: the nearest above is.
  assert.deepEqual(asked(models, 'anthropic/claude-sonnet-5-5', 'off'), { provider: 'anthropic', model: 'claude-sonnet-5-5', thinking: 'low' });
  assert.deepEqual(asked(models, 'anthropic/claude-sonnet-5-5', 'high'), { provider: 'anthropic', model: 'claude-sonnet-5-5', thinking: 'high' });
  assert.deepEqual(asked(models, 'anthropic/claude-haiku-4-5', 'high'), { provider: 'anthropic', model: 'claude-haiku-4-5', thinking: 'off' });
  // A model Pi does not list is asked for as it was written, for pi-optchat to judge; what names no model is not asked for.
  assert.deepEqual(asked(models, 'local/llama', 'off'), { provider: 'local', model: 'llama', thinking: 'off' });
  assert.equal(asked(models, 'sonnet', 'off'), undefined);
  // Its levels are the ones to choose from, with the one it is kept at when a file says one it has not.
  assert.deepEqual(offered(models, { provider: 'anthropic', model: 'claude-sonnet-5-5', thinking: 'medium' }), ['low', 'medium', 'high']);
  assert.deepEqual(offered(models, { provider: 'anthropic', model: 'claude-sonnet-5-5', thinking: 'off' }), ['off', 'low', 'medium', 'high']);
  assert.deepEqual(offered(models, { provider: 'local', model: 'llama', thinking: 'off' }), LEVELS);
});

test('what the page mirrors of pi-optchat is what pi-optchat has: the page cannot load it, so this fails when they differ', () => {
  assert.deepEqual([...APP], [...THINKING]);
  assert.deepEqual(LEVELS, [...THINKING]);
  for (const share of [0, 0.3, 0.125, 0.333, 0.9]) assert.equal(said(setting('percent'), share), percent(share));
});
