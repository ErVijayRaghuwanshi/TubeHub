import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/v5': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    port: 5174,
    strictPort: true,
  },
})

