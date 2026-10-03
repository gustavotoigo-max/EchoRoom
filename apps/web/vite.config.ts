/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// No GitHub Pages o site fica em https://usuario.github.io/NomeDoRepo/,
// então os arquivos precisam desse prefixo. O workflow define VITE_BASE.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    // Pacote compartilhado com o backend (código TypeScript, sem build próprio).
    alias: { '@echoroom/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
