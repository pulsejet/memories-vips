import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (whose root is demo/): unit tests live in tests/.
export default defineConfig({
  test: {
    dir: './tests',
  },
});
