/** A file the agent named in inline code or as a link's target: `src/ui/App.tsx:42`, `[App](src/ui/App.tsx#L42)`. Only a path
 * relative to the window's folder, with a folder in it or a line after it and a file's extension at its end; never one with a
 * scheme, a `~`, a `..` or a space. It becomes a link only once the server says that file is there (`isFile`). */
const PATH = /^(?:\.\/)?((?:[\w.@+-]+\/)*[\w.@+-]*[\w@+-]\.[A-Za-z0-9]{1,12})(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?)?$/;
export function fileTarget(text: string): { path: string; line?: number } | undefined {
  const [, path, colon, hash] = PATH.exec(text) ?? [], line = Number(colon ?? hash) || undefined;
  if (!path || path.split('/').some(part => part === '.' || part === '..') || !(path.includes('/') || line)) return undefined;
  return { path, ...line && { line } };
}
