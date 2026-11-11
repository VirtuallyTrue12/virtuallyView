import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/** Serves the visualizer test page (index.html here) on a free port. The music player context is stubbed. */
export async function startVizHarness(): Promise<{ url: string; server: ViteDevServer }> {
  const server = await createServer({
    root: here,
    configFile: false,
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1', fs: { allow: [resolve(here, '../../../..')] } },
    plugins: [react(), {
      name: 'stub-music-player',
      enforce: 'pre',
      resolveId: id => (/media\/MusicProvider$/.test(id) ? '\0music-stub' : null),
      load: id => (id === '\0music-stub' ? 'export const useMusicPlayer = () => ({ entry: null });' : null)
    }]
  });
  await server.listen();
  const addr = server.httpServer!.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}/`, server };
}
