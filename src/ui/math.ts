/// <reference types="mdast-util-math" />
import type { Nodes, Root } from 'mdast';
import type { VFile } from 'vfile';

/** `$…$` is a formula only by Pandoc's rule: no space just inside either dollar, and no letter, digit, `\` or `{` just after
 * the closing one. So prices and shell variables stay prose: in "It costs $5 and $10" remark-math pairs "$5 and $", which ends in a space,
 * and in "$5-$10", "$HOME/$USER" or "$HOME/${USER}" the closing dollar is followed by a digit, a letter or a brace. What fails the rule is put back as
 * text, its dollars around what it held. `$$…$$` is always a formula. */
const FORMULA = /^\$(?!\s)[^]*(?<!\s)\$$/;
export function dollars() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    const walk = (node: Nodes) => 'children' in node && node.children.forEach((child, at) => {
      const start = child.position?.start.offset, end = child.position?.end.offset;
      if (child.type !== 'inlineMath' || start === undefined || end === undefined) return walk(child);
      const written = source.slice(start, end);
      if (!written.startsWith('$$') && !(FORMULA.test(written) && !/[\p{L}\p{N}\\{]/u.test(source.charAt(end)))) node.children[at] = { type: 'text', value: `$${child.value}$`, position: child.position };
    });
    walk(tree);
  };
}
