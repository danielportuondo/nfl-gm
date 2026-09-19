import { defineConfig, devices } from '@playwright/test'

/**
 * One smoke flow (HANDOFF §7 Phase 5C): new game → draft round with a trade → sim 4 weeks → reload
 * persists. Chromium only; runs against a preview server built from `app/dist` so it exercises the real
 * production bundle, on a port distinct from the vite dev server (5199 is reserved elsewhere).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5210',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'pnpm exec vite preview --port 5210 --strictPort',
    url: 'http://localhost:5210',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
