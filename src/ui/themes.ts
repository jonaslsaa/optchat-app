import type { Settings } from '../protocol.ts';

/** Themes, with no DOM: a theme file as the page reads it, and which theme is drawn. The built-in ones are files in `themes/`,
 * read as yours are, and their palettes are T3 Code's (MIT, see THIRD_PARTY_NOTICES.md).
 *
 * A theme file is JSON: `{ "version": 1, "name": "Grove", "appearance": "light", "colors": { … }, "variants": { "dark": { … } } }`.
 * `colors` are for its `appearance`, and a variant is the same theme in the other one. A colour is named by the page's own
 * colour of that name (`index.css`), and what a theme leaves out is the app's own of that appearance. The `art-` colours are
 * the sidebar's night sky (`Art.tsx`): a theme has all seven, or none and no drawing. A file is the user's, and what it says
 * ends up in the page's CSS, so only literal colours are taken: anything else, and the file is shown with why, and never drawn. */

export const ROLES = [
  'background', 'foreground', 'card', 'popover', 'surface-raised', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'muted-foreground', 'placeholder', 'secondary-label', 'icon-muted', 'accent', 'message-surface', 'message-foreground', 'message-action-hover',
  'error', 'error-foreground', 'error-surface', 'warning', 'warning-foreground', 'warning-surface', 'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-muted-foreground', 'sidebar-row-hover', 'sidebar-row-active', 'sidebar-border',
  'art-top', 'art-mid', 'art-bottom', 'art-highlight', 'art-secondary', 'art-tertiary', 'art-line',
] as const;
export type Role = (typeof ROLES)[number];
export type Colors = Partial<Record<Role, string>>;
export type Appearance = 'light' | 'dark';
/** A theme as it is drawn: its colours in each appearance it has. `id` is its file's name: `grove` for a built-in one, and
 * `mine.json` for yours, so the two never meet. */
export interface Theme { id: string; name: string; light?: Colors; dark?: Colors }
/** A file that is no theme, and why. */
export interface Unread { id: string; error: string }

const ART = ROLES.filter(role => role.startsWith('art-'));
const isRole = (role: string): role is Role => (ROLES as readonly string[]).includes(role);
/** A literal colour and nothing else: `#rgb` to `#rrggbbaa`, or `rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, `lch()` of
 * numbers. No other function, no `var()` or `url()`, nothing that ends the value. */
const COLOR = /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|oklch|oklab|lab|lch)\((?:[\d.\s,/%+-]|deg|none)*\))$/i;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const APPEARANCES: readonly unknown[] = ['light', 'dark'];
const isAppearance = (value: unknown): value is Appearance => APPEARANCES.includes(value);

function colors(value: unknown, where: string): Colors {
  if (!isObject(value)) throw new Error(`Its ${where} colours are no object.`);
  const read: Colors = {};
  for (const [role, color] of Object.entries(value)) {
    if (!isRole(role)) throw new Error(`"${role}" is no colour a theme sets.`);
    if (typeof color !== 'string' || color.length > 100 || !COLOR.test(color.trim())) throw new Error(`"${role}" is no colour: write one as #2563eb or oklch(0.6 0.2 260).`);
    read[role] = color.trim();
  }
  if (Object.keys(read).length === 0) throw new Error(`Its ${where} colours are empty.`);
  const art = ART.filter(role => read[role]).length;
  if (art && art < ART.length) throw new Error(`Its ${where} colours have ${art} of the 7 art- colours: give all of them, or none.`);
  return read;
}
/** A theme file's contents as a theme, or why it is none. */
export function readTheme(id: string, file: unknown): Theme | Unread {
  try {
    if (!isObject(file)) throw new Error('It is no JSON object.');
    if (file.version !== 1) throw new Error('Its "version" is not 1.');
    const { name, appearance, variants } = file;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 48) throw new Error('It needs a "name" of 48 characters at most.');
    if (!isAppearance(appearance)) throw new Error('Its "appearance" is neither "light" nor "dark".');
    const theme: Theme = { id, name: name.trim() };
    theme[appearance] = colors(file.colors, appearance);
    if (variants !== undefined) {
      if (!isObject(variants)) throw new Error('Its "variants" are no object.');
      for (const [other, value] of Object.entries(variants)) {
        if (!isAppearance(other) || other === appearance) throw new Error(`"${other}" is no variant: the one variant is the appearance it is not.`);
        theme[other] = colors(value, other);
      }
    }
    return theme;
  } catch (error) { return { id, error: error instanceof Error ? error.message : String(error) }; }
}
/** A file as its text is read. */
export function parseTheme(id: string, text: string): Theme | Unread {
  let file: unknown;
  try { file = JSON.parse(text); } catch { return { id, error: 'It is not JSON.' }; }
  return readTheme(id, file);
}

/** The app's own colours, as the cards and the scheme's pictures show them: the page draws them from `index.css`. */
export const OWN = {
  light: { background: 'oklch(99.2% 0 0)', sidebar: '#fafafa', card: '#fff', accent: '#f4f4f5', 'message-surface': '#ececee', primary: 'oklch(0.488 0.217 264)', ring: 'oklch(0.488 0.217 264)' },
  dark: { background: '#000', sidebar: '#000', card: '#111', accent: '#0a0a0a', 'message-surface': '#1d1d1d', primary: 'oklch(0.571 0.21 264)', ring: 'oklch(0.571 0.21 264)' },
} satisfies Record<Appearance, Colors>;
export const OWN_NAME = 'OptChat';

/** The theme drawn in `appearance`: the one the settings name for it, while there is one of that name with colours for it.
 * None is the app's own. */
export function chosen(themes: readonly (Theme | Unread)[], settings: Pick<Settings, 'palette'>, appearance: Appearance): Theme | undefined {
  const id = settings.palette?.[appearance], theme = themes.find(theme => theme.id === id);
  return theme && 'name' in theme && theme[appearance] ? theme : undefined;
}
