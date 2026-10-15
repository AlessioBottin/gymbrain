export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@vite-pwa/nuxt'],
  runtimeConfig: {
    public: {
      allowLocalDemo: process.env.GYMBRAIN_LOCAL_DEMO === 'true',
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
    },
  },
  nitro: { devProxy: { '/api': { target: 'http://127.0.0.1:3001/api', changeOrigin: true } } },
  pwa: {
    registerType: 'prompt',
    injectRegister: false,
    manifest: {
      name: 'Gymbrain',
      short_name: 'Gymbrain',
      description: 'Il tuo ritmo. Il tuo percorso.',
      lang: 'it',
      theme_color: '#f4f1ea',
      background_color: '#f4f1ea',
      display: 'standalone',
      start_url: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,webp,woff2}'],
      navigateFallback: '/',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
    },
    client: { registerPlugin: false },
  },
  css: ['~/assets/main.css', '~/assets/application.css', '~/assets/greek.css', '~/assets/glass.css'],
  app: {
    head: {
      title: 'Gymbrain — Il tuo prossimo livello',
      htmlAttrs: { lang: 'it' },
      meta: [
        { name: 'theme-color', content: '#f4f1ea' },
        {
          name: 'description',
          content: 'Allenati con intenzione. Schede, sessioni e progressi anche offline.',
        },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
});
