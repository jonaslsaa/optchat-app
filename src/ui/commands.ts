import type { Command, WindowState } from '../protocol.ts';

/** pi-optchat's `/optchat` is one command to Pi, with a word after it for what to do. These answer in the app, by a dialog
 * and a notice. The others open a screen of the terminal (`profile`, `settings`, `model`, `agents`, `agents model`, `usage`,
 * `activity`: over RPC pi-optchat 0.11.13 answers each "requires interactive Pi"), as `/optchat` alone offers them, and
 * `browse` opens what the memory view shows here. */
const OPTCHAT: Command[] = [
  { name: 'optchat instructions', description: 'Edit this profile\'s instructions', source: 'extension' },
  { name: 'optchat import', description: 'Import conversations into this profile, or resume or discard an import that was paused', source: 'extension' },
];
/** pi-optchat's commands for a connected window: in the main chat it answers that they are not for it. */
const CONNECTED = ['complete', 'tell-main'];
const ORDER: Command['source'][] = ['prompt', 'skill', 'extension'];
export const SOURCES: Record<Command['source'], string> = { prompt: 'Prompt templates', skill: 'Skills', extension: 'Commands' };

/** The commands a window's list has, of those its Pi knows: your prompt templates, your skills, then what extensions add. Of
 * pi-optchat's own, the ones that do something in this window. */
export function offered(commands: readonly Command[], role: WindowState['role']): Command[] {
  return commands.flatMap(command => command.source !== 'extension' ? [command]
    : command.name === 'optchat' ? role === 'main' ? OPTCHAT : []
    : role === 'main' && CONNECTED.includes(command.name) ? [] : [command])
    .toSorted((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source));
}
/** What a message asks the list for: the name typed so far, while the message is a `/` and no more than a name. */
export const asked = (text: string) => text.startsWith('/') && !text.includes('\n') ? text.slice(1).toLowerCase() : undefined;
/** The commands whose name has what was typed in it, the best first: the one of that very name, then one that begins with it,
 * then one a word of whose name does (`skill:sol-loop` for `sol`), then the rest. What is typed after a name matches none, so the list is gone by then. */
export function matching(commands: readonly Command[], typed: string): Command[] {
  const rank = ({ name }: Command) => { const at = name.toLowerCase().indexOf(typed); return at < 0 ? Infinity : at > 0 ? /[\s:\-_.]/.test(name[at - 1]) ? 2 : 3 : name.length === typed.length ? 0 : 1; };
  return commands.filter(command => rank(command) < Infinity).toSorted((a, b) => rank(a) - rank(b));
}
