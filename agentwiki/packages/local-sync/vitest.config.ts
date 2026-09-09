import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep compiled copies out of discovery after Vitest 4 removed dist from its defaults.
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
