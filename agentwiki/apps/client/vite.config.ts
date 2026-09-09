import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { clientBundleBudget } from './build/bundleBudget';

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
  plugins: [react(), tailwindcss(), clientBundleBudget()],
  // The linked shared workspace package emits CommonJS, including runtime limits.
  optimizeDeps: { include: ['@agentwiki/shared'] },
  build: {
    commonjsOptions: { include: [/node_modules/, /packages\/shared\/dist/] },
    rollupOptions: {
      output: {
        // Keep shared dependencies in Rollup's own chunks: pulling them into a
        // feature vendor chunk can eagerly load the editor or create cycles.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//u.test(id)) return 'react-vendor';
          if (/\/node_modules\/katex\//u.test(id)) return 'math-vendor';
          if (/\/node_modules\/@codemirror\/(view|state)\//u.test(id)) return 'editor-core';
          if (/\/node_modules\/(@dagrejs|dagre-d3-es|d3-[^/]+)\//u.test(id)) return 'diagram-layout';
          // Preserve Mermaid's upstream shared-module boundaries. Its complete
          // parser remains lazy; using the tiny build would drop diagram types.
          const mermaidShared = id.match(/\/mermaid\/dist\/chunks\/mermaid\.core\/(chunk-[^/]+)\.mjs$/u);
          if (mermaidShared) return `diagram-${mermaidShared[1]}`;
          return undefined;
        },
      },
    },
  },
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
