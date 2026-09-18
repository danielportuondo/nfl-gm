/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const alias = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// GitHub Pages serves the app from /<repo>/; local dev and tests use /.
const base = process.env.GITHUB_PAGES ? '/nfl-gm/' : '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@contracts': alias('./src/contracts'),
      '@engine': alias('./src/engine'),
      '@data': alias('./src/data'),
      '@store': alias('./src/store'),
      '@ui': alias('./src/ui'),
      '@screens': alias('./src/screens'),
      '@fixtures': alias('./tests/fixtures'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Real-data tests (60-sim calibration, multi-offseason cap/anchoring runs) take 5–10 s under a parallel run.
    testTimeout: 30_000,
    // UI tests opt into jsdom with `// @vitest-environment jsdom` at the top of the file.
  },
})
