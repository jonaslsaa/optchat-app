import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The UI is a plain web page: `npm run build` puts it in dist/ui, which the server serves. In `npm run dev` Vite serves it with
 * hot reload, and passes the WebSocket and images on to the server. */
const server = `http://127.0.0.1:${process.env.OPTCHAT_APP_PORT ?? 4780}`;
export default defineConfig({
  root: 'src/ui',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/ui', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { '/ws': { target: server, ws: true }, '/images': server } },
});
