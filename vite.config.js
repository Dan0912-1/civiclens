import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Read the version from package.json at build time so the app always ships
// the same version string as the package — no more manually keeping
// src/App.jsx's hardcoded version in sync.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
)

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Defer the SW registration script instead of render-blocking in <head>
      injectRegister: 'script-defer',
      workbox: {
        // Keep the first-visit precache lean: install icons and the OG image
        // (~450 KB combined) load on demand, not as competing background
        // downloads during the user's first page load.
        globIgnores: [
          '**/logo-512.png',
          '**/logo-192.png',
          '**/apple-touch-icon.png',
          '**/og-image.png',
        ],
        runtimeCaching: [
          {
            urlPattern: /\/api\/bill\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bill-detail-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /\/api\/personalize/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'personalize-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: /\/api\/legislation/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'legislation-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: 'CapitolKey',
        short_name: 'CapitolKey',
        theme_color: '#0A1929',
        background_color: '#F5F2EC',
        display: 'standalone',
        icons: [
          { src: '/logo-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/logo-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          sentry: ['@sentry/react'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})
