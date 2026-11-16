import type { Element, RootContent } from 'hast';

// An image reads as its words, as the chat shows it.
const text = (node: RootContent): string => node.type === 'text' ? node.value : node.type === 'element' && node.tagName === 'img' ? String(node.properties.alt ?? '') : 'children' in node ? node.children.map(text).join('') : '';
const within = (node: Element, tags: string[]): Element[] => node.children.flatMap(child => child.type !== 'element' ? [] : tags.includes(child.tagName) ? [child] : within(child, tags));
const field = (cell: Element) => {
  // A cell a spreadsheet would take as a formula stays text there, after a `'`: what the agent wrote may be another's words.
  const value = text(cell).replace(/\s+/g, ' ').trim().replace(/^(?=[=+@]|-(?![\d.,]+%?$))/, "'");
  return /[",]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
};

/** A Markdown table as CSV, a line for each row, each cell as it reads (a formula as its TeX). */
export const csv = (table: Element) => within(table, ['tr']).map(row => within(row, ['th', 'td']).map(field).join(',')).join('\n');
