import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx tsx server.ts',
    url: 'http://127.0.0.1:3000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      NODE_ENV: 'development',
      PORT: '3000',
      OTP_DEV_ECHO: 'true',
      DEMO_MODE: 'true',
      AISTUDIO_PREVIEW: 'false',
    },
  },
});
