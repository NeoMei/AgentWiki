import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

function localApiProxyTarget(value: string | undefined): string {
  if (!value) return 'http://127.0.0.1:3000';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AGENTWIKI_DEV_API_ORIGIN must be an absolute loopback HTTP origin');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AGENTWIKI_DEV_API_ORIGIN must be an absolute loopback HTTP origin');
  }
  return url.origin;
}

const apiProxyTarget = localApiProxyTarget(process.env.AGENTWIKI_DEV_API_ORIGIN);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The linked shared workspace package emits CommonJS, including runtime limits.
  optimizeDeps: { include: ['@agentwiki/shared'] },
  build: { commonjsOptions: { include: [/node_modules/, /packages\/shared\/dist/] } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
