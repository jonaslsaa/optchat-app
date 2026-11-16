import type { Params } from '../protocol.ts';

/** An image on its way to an agent with a message, as Pi takes it: base64, with its kind. */
export type Image = NonNullable<Params<'prompt'>['images']>[number];
/** The kinds pi-optchat keeps, which are the ones the models read, and the most an image may weigh as a file: Pi makes one
 * smaller that is more than a model takes (a PNG of 9.6 MB reached Claude as a JPEG under 3 MB), so this is the page's own.
 * A message's images together stay under what the server takes in one message (100 MB, and base64 is a third more). */
export const KINDS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], LIMIT = 10 * 1024 * 1024, TOTAL = 50 * 1024 * 1024;

/** Why a file is not sent as an image beside the `held` bytes of the others, in words; nothing when it can be. */
export function refusal({ name, type, size }: Pick<File, 'name' | 'type' | 'size'>, held = 0) {
  if (!KINDS.includes(type)) return `${name} is not a PNG, JPEG, GIF or WebP image. Only those can be sent.`;
  if (size > LIMIT) return `${name} is ${(size / 1024 / 1024).toFixed(1)} MB. An image can be ${LIMIT / 1024 / 1024} MB at most.`;
  if (held + size > TOTAL) return `${name} is one too many. The images of a message can be ${TOTAL / 1024 / 1024} MB together at most.`;
}
/** The files that go as images beside the ones a message has, and why each of the others does not. */
export function sorted(files: Iterable<File>, has: readonly Image[]) {
  let held = has.reduce((sum, { data }) => sum + data.length * 0.75, 0);
  const taken: File[] = [], refused: string[] = [];
  for (const file of files) { const why = refusal(file, held); if (why) refused.push(why); else { taken.push(file); held += file.size; } }
  return { taken, refused };
}
/** A file as the image that is sent. */
export async function image(file: File): Promise<Image> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return { type: 'image', data: btoa(binary), mimeType: file.type };
}
/** An image as an address the page can draw. */
export const address = ({ mimeType, data }: Image) => `data:${mimeType};base64,${data}`;
