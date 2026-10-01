/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No GitHub Pages o site fica em https://usuario.github.io/NomeDoRepo/,
// então os arquivos precisam desse prefixo. O workflow define VITE_BASE.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
