/** How hard a model thinks, in Pi's words and from least to most. It mirrors pi-optchat's `THINKING`, which the page cannot
 * load: `pi-optchat/files` is for Node only (`test/config-ui.test.ts` fails when the two differ). */
export const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Thinking = typeof THINKING[number];

/** The levels a model can think at, from what Pi lists of it (`get_available_models`): `off` alone for one that does not
 * reason; otherwise every level its map does not rule out, and the two highest only where the map names them. This is
 * pi-ai's `getSupportedThinkingLevels`, which Pi goes by itself. */
export function levels({ reasoning, thinkingLevelMap: map }: { reasoning: boolean; thinkingLevelMap?: Record<string, string | null> }): Thinking[] {
  if (!reasoning) return ['off'];
  return THINKING.filter(level => map?.[level] !== null && (level !== 'xhigh' && level !== 'max' || map?.[level] !== undefined));
}
/** The level a model with `levels` takes for `level`: that one if it has it, else the next it has above, else the next below.
 * This is pi-ai's `clampThinkingLevel`, so the page says before a Pi runs what Pi will say once it does. */
export function clamp(levels: readonly Thinking[], level: Thinking): Thinking {
  const at = THINKING.indexOf(level), has = (level: Thinking) => levels.includes(level);
  return THINKING.slice(at).find(has) ?? THINKING.slice(0, at).findLast(has) ?? 'off';
}
