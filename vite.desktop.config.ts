import { defineConfig } from 'vite';

/** The desktop app's main process: `src/desktop/main.ts` with the server and everything it imports, as one JavaScript file in
 * dist/desktop. Electron's Node does not run TypeScript, and a packaged app then needs no node_modules. */
export default defineConfig({
  build: { ssr: 'src/desktop/main.ts', outDir: 'dist/desktop', emptyOutDir: true, target: 'node22', minify: false, rollupOptions: { output: { entryFileNames: 'main.js' } } },
  ssr: { noExternal: true, external: ['electron'] },
});
