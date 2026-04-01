/**
 * Vite config for the React SPA.
 *
 * Dev server serves the UI (port 5173 by default). The browser uses the same origin for `/api` and `/ws`;
 * these proxies forward to FastAPI on 127.0.0.1:8000 so CORS is avoided during local dev.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on LAN so other laptops can open http://YOUR_IP:5173
    host: true,
    // Without this, Vite may 403 module requests when Host is an IP (blank page, title only).
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})
