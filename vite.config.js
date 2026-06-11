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
      // 'auto' injects the update-aware registration that posts SKIP_WAITING to
      // a freshly-installed SW and reloads once it takes over. The previous
      // 'script-defer' shipped a bare register() that never did this, so the
      // new SW sat in "waiting" forever (it only self-skips on a message no one
      // sent) and returning users were pinned to the old precached app shell —
      // stale asset hashes broke the nav logo and tripped the offline banner.
      injectRegister: 'auto',
      workbox: {
        // Belt-and-suspenders with autoUpdate: have the SW claim open clients
        // and activate the instant it installs, so a deploy can never get stuck
        // behind a previous SW even if the registration script fails to load.
        skipWaiting: true,
        clientsClaim: true,
        // Keep the first-visit precache lean: the OG image and apple-touch-icon
        // load on demand, not as competing background downloads during the
        // user's first page load. These sit at the output root, so the globs
        // are bare filenames — '**/og-image.png' only matches nested paths and
        // silently precached it anyway. (logo-192/512 can't be dropped here:
        // they're PWA manifest icons, which the plugin always precaches so the
        // installed app has its icons available offline.)
        globIgnores: [
          'og-image.png',
          'apple-touch-icon.png',
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
