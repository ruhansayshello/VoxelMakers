import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const USE_CUSTOM_ENGINE = true; // ← flip this to false to use Three.js

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    base: './', // ← important for itch.io relative paths
    resolve: {
      alias: [
        {
          find: '@',
          replacement: path.resolve(import.meta.dirname, '.'),
        },
        ...(USE_CUSTOM_ENGINE
          ? [
              {
                // Exact match on 'three' so 'three/examples/jsm/...' still resolves cleanly
                find: /^three$/,
                replacement: path.resolve(import.meta.dirname, 'src/engine/index.ts'),
              },
            ]
          : []),
      ],
    },
    optimizeDeps: {
      exclude: ['three'], // forces Vite to process Three.js (or your alias) through Rollup's tree-shaker
    },
    worker: {
      format: 'es' as const,
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      // Allow AI Studio preview Cloud Run proxy domains:
      allowedHosts: true as const,
      cors: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR === 'true' ? false : { clientPort: 443 },
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
  };
});
