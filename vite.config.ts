import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' — приложение работает и на GitHub Pages (проектный сайт),
// и внутри любой вебвью, независимо от регистра пути.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    /* Движок в разработке поднимается рядом (npm run api) — прокси нужен, чтобы
       фронт и на dev, и на проде звал один и тот же относительный /api/chat. */
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true } },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    // Тот же прокси, что и в dev: иначе собранный фронт на `vite preview` ходит за /api
    // на сам себя и молча получает 404 — расхождение dev/preview замечали не раз.
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true } },
  },
})
