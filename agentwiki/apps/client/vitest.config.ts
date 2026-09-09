import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Vitest 4 restores spies without resetting module-mock state.
    mockReset: true,
    exclude: ['node_modules', 'dist', 'e2e/**'],
    pool: 'forks',
    execArgv: ['--no-experimental-webstorage'],
  },
});
