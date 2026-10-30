import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Demo-only bundling. The library itself (src/) ships as pure TS with zero
// runtime dependencies; vite is only used to serve/build demo/.
export default defineConfig({
  root: resolve(__dirname, 'demo'),
  build: {
    outDir: resolve(__dirname, 'dist-demo'),
    emptyOutDir: true,
  },
});
