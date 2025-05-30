import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      process: 'process',
      util: 'util',
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      assert: 'assert',
      url: 'url',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'process'],
  },
})
