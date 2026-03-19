import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// Prevent Cloudflare Rocket Loader from rewriting type="module" scripts
function cfAsyncOff(): import('vite').Plugin {
  return {
    name: 'cf-async-off',
    transformIndexHtml(html) {
      return html.replace(/<script /g, '<script data-cfasync="false" ')
    },
  }
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          'jotai/babel/plugin-debug-label',
          ['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
        ],
      },
    }),
    tailwindcss(),
    cfAsyncOff(),
  ],
  root: resolve(__dirname, 'src'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyDirBeforeWrite: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      // Point @/ at the Electron renderer source — reuse all components
      '@': resolve(__dirname, '../electron/src/renderer'),
      '@config': resolve(__dirname, '../../packages/shared/src/config'),
      // Force single React copy (Bun hoists to root)
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      // Bypass barrel export that pulls in Node-only server.ts
      // The codec.ts in electron re-exports from the barrel; we redirect to the direct file
      '@craft-agent/server-core/transport': resolve(__dirname, '../../packages/server-core/src/transport/index-web.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai', 'pdfjs-dist'],
    exclude: ['@craft-agent/ui'],
    esbuildOptions: {
      supported: { 'top-level-await': true },
      target: 'esnext',
    },
  },
  server: {
    port: 5180,
    open: false,
  },
})
