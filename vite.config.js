import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/v5': {
        target: 'https://api.cdnframe.com',
        changeOrigin: true,
        secure: true,
        headers: {
          Referer: 'https://clickapi.net/',
          Origin: 'https://clickapi.net',
        },
      },
    },
  },
})

