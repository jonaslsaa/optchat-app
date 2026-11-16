import assert from 'node:assert/strict';
import { test } from 'node:test';
import { address, image, LIMIT, refusal, sorted, TOTAL } from '../src/ui/images.ts';
import { png } from './support.ts';

test('a file goes as an image when it is one a model reads and is not too large, and else it is said why not', async () => {
  const data = png(300, [60, 90, 220]), file = new File([data], 'blue.png', { type: 'image/png' });
  assert.equal(refusal(file), undefined);
  // As Pi takes it, whole: more bytes than one call can turn into text at once.
  const sent = await image(new File([Buffer.alloc(100_000, 7)], 'large.png', { type: 'image/png' }));
  assert.deepEqual([sent.type, sent.mimeType, Buffer.from(sent.data, 'base64').equals(Buffer.alloc(100_000, 7))], ['image', 'image/png', true]);
  assert.equal(address(await image(file)), `data:image/png;base64,${data.toString('base64')}`);
  assert.equal(refusal({ name: 'photo.heic', type: 'image/heic', size: 10 }), 'photo.heic is not a PNG, JPEG, GIF or WebP image. Only those can be sent.');
  assert.equal(refusal({ name: 'notes.txt', type: '', size: 10 }), 'notes.txt is not a PNG, JPEG, GIF or WebP image. Only those can be sent.');
  assert.equal(refusal({ name: 'at the limit.jpg', type: 'image/jpeg', size: LIMIT }), undefined);
  assert.equal(refusal({ name: 'wall.png', type: 'image/png', size: 12.34 * 1024 * 1024 }), 'wall.png is 12.3 MB. An image can be 10 MB at most.');
  // Together they stay under what one message to the server may weigh: the ones that fit go, in the order they were given.
  const has = [{ type: 'image' as const, mimeType: 'image/png', data: 'A'.repeat((TOTAL - 1000) / 3 * 4) }];
  const small = new File([Buffer.alloc(600)], 'small.png', { type: 'image/png' }), other = new File([Buffer.alloc(600)], 'other.png', { type: 'image/png' });
  assert.deepEqual(sorted([small, new File(['x'], 'notes.txt'), other], has), { taken: [small], refused: ['notes.txt is not a PNG, JPEG, GIF or WebP image. Only those can be sent.', 'other.png is one too many. The images of a message can be 50 MB together at most.'] });
});
