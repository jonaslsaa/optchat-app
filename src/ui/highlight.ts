import type { GrammarState, HighlighterCore, LanguageInput } from 'shiki/core';

/** Syntax colours for code blocks, by Shiki. Shiki, its two themes and each language's grammar are chunks of their own, fetched
 * the first time a code block needs them, so the page loads no more than it did. */

const THEMES = { light: 'github-light', dark: 'github-dark' };
/** A piece of a line in one colour, which is CSS for the page's light and dark looks at once. */
export interface Token { text: string; color?: string }

let shiki: Promise<{ core: HighlighterCore; languages: Record<string, LanguageInput> }> | undefined;
async function load(): NonNullable<typeof shiki> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, { bundledLanguages }, light, dark] = await Promise.all([
    import('shiki/core'), import('shiki/engine/javascript'), import('shiki/langs'), import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs'),
  ]);
  // The engine in JavaScript needs no WebAssembly, and leaves out a pattern it cannot run rather than fail on it.
  return { core: await createHighlighterCore({ themes: [light, dark], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }), languages: bundledLanguages };
}
const loading = new Map<string, Promise<HighlighterCore | undefined>>();
/** Shiki with `language` loaded, or nothing when it has no grammar of that name or could not be fetched. One promise a language,
 * so a component can wait on it with `use`. */
export function highlighter(language: string): Promise<HighlighterCore | undefined> {
  let promise = loading.get(language);
  if (!promise) {
    promise = (shiki ??= load()).then(async ({ core, languages }) => {
      if (!Object.hasOwn(languages, language)) return undefined;
      await core.loadLanguage(languages[language]);
      return core;
    }).catch(() => undefined);
    loading.set(language, promise);
  }
  return promise;
}

/** Colours one code block, line by line, as often as it is asked: for a block that grows while its reply streams, the lines it
 * had are kept as they are (the same arrays, so they are not drawn again) and only what came since is read, on from where the
 * grammar stood at the end of the last whole line. */
export function painter(core: HighlighterCore, lang: string) {
  const options = { lang, themes: THEMES, defaultColor: false as const };
  let done = '', lines: Token[][] = [], state: GrammarState | undefined;
  const read = (code: string) => {
    const { tokens } = core.codeToTokens(code, { ...options, grammarState: state });
    return { state: core.getLastGrammarState(tokens), lines: tokens.map(line => line.map(({ content, htmlStyle }): Token => {
      const light = htmlStyle?.['--shiki-light'], dark = htmlStyle?.['--shiki-dark'];
      return { text: content, ...light && dark && { color: `light-dark(${light}, ${dark})` } };
    })) };
  };
  return (code: string): Token[][] => {
    if (!code.startsWith(done)) { done = ''; lines = []; state = undefined; }
    const rest = code.slice(done.length), end = rest.lastIndexOf('\n');
    if (end >= 0) {
      const whole = read(rest.slice(0, end));
      lines = [...lines, ...whole.lines]; state = whole.state; done += rest.slice(0, end + 1);
    }
    return [...lines, ...read(rest.slice(end + 1)).lines];
  };
}
