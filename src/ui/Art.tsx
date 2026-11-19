import { useId } from 'react';

/** A theme's drawing at the top of the sidebar: a night sky with stars and clouds, in the theme's `art-` colours (`themes.ts`).
 * It is there only while the page has `data-art` (`theme.ts`), and is only a picture: nothing on it is read or pressed. T3 Code's
 * nightly sidebar art (MIT, see THIRD_PARTY_NOTICES.md). */
const STARS = [
  [14, 10, 0.6, 0.85], [38, 22, 0.4, 0.55], [58, 8, 0.5, 0.7], [84, 16, 0.4, 0.5], [104, 7, 0.6, 0.8], [126, 20, 0.4, 0.55],
  [148, 11, 0.5, 0.7], [170, 24, 0.4, 0.5], [192, 9, 0.6, 0.8], [214, 18, 0.4, 0.55], [236, 8, 0.5, 0.7], [258, 20, 0.45, 0.6],
  [278, 11, 0.55, 0.75], [26, 34, 0.4, 0.45], [118, 34, 0.4, 0.45], [202, 32, 0.4, 0.5], [268, 34, 0.4, 0.45],
] as const;
const SPARKLES = [[70, 28], [160, 36], [246, 26]] as const;
const color = (name: string) => ({ stopColor: `var(--art-${name})` });

export function Art() {
  const id = useId().replaceAll(':', ''), url = (name: string) => `url(#${id}-${name})`;
  return (
    <div aria-hidden="true" data-art-drawing className="sidebar-art pointer-events-none absolute inset-x-0 top-0 hidden h-20 select-none overflow-hidden art:block">
      <svg className="h-full w-full" fill="none" preserveAspectRatio="xMinYMin slice" viewBox="0 0 8192 96" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={`${id}-sky`} x1="24" y1="0" x2="264" y2="96" gradientUnits="userSpaceOnUse" spreadMethod="reflect">
            <stop style={color('bottom')} /><stop offset="0.5" style={color('mid')} /><stop offset="1" style={color('top')} />
          </linearGradient>
          <radialGradient id={`${id}-glow`} cx="0" cy="0" r="1" gradientTransform="translate(216 18) rotate(137) scale(120 84)" gradientUnits="userSpaceOnUse">
            <stop style={color('highlight')} stopOpacity="0.4" /><stop offset="0.5" style={color('secondary')} stopOpacity="0.16" /><stop offset="1" style={color('bottom')} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-cloud`} x1="0" y1="60" x2="288" y2="96" gradientUnits="userSpaceOnUse">
            <stop style={color('highlight')} stopOpacity="0.5" /><stop offset="0.52" style={color('secondary')} stopOpacity="0.62" /><stop offset="1" style={color('tertiary')} stopOpacity="0.5" />
          </linearGradient>
          <filter id={`${id}-soft`} x="-24" y="-24" width="336" height="144" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="4" /></filter>
          <pattern id={`${id}-stars`} width="288" height="96" patternUnits="userSpaceOnUse">
            <g style={{ fill: 'var(--art-line)' }}>{STARS.map(([cx, cy, r, opacity]) => <circle key={`${cx} ${cy}`} cx={cx} cy={cy} r={r} fillOpacity={opacity} />)}</g>
            <g style={{ stroke: 'var(--art-line)' }} strokeLinecap="round" strokeOpacity="0.7" strokeWidth="0.6">
              {SPARKLES.map(([x, y]) => <path key={x} d={`M${x - 1.5} ${y}H${x + 1.5}M${x} ${y - 1.5}V${y + 1.5}`} />)}
            </g>
          </pattern>
          <pattern id={`${id}-glows`} width="640" height="96" patternUnits="userSpaceOnUse"><rect width="640" height="96" fill={url('glow')} /></pattern>
        </defs>
        <rect width="100%" height="96" fill={url('sky')} />
        <rect width="100%" height="96" fill={url('glows')} />
        <rect width="100%" height="96" fill={url('stars')} />
        <g filter={url('soft')}>
          <path d="M-12 88C-12 74 0 63 14 63C18 50 30 41 44 41C58 41 70 49 74 62C79 57 86 54 94 54C110 54 123 66 124 82C132 83 138 88 141 96H-12V88Z" fill={url('cloud')} />
        </g>
        <g filter={url('soft')}>
          <path d="M150 96C151 84 161 75 173 75C176 64 186 57 198 57C210 57 220 64 223 75C231 75 238 80 241 87C250 87 257 91 260 96H150Z" fill={url('cloud')} fillOpacity="0.8" />
        </g>
      </svg>
    </div>
  );
}
