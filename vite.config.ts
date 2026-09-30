import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' — приложение работает и на GitHub Pages (проектный сайт),
// и внутри Telegram Mini App, независимо от регистра пути.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
