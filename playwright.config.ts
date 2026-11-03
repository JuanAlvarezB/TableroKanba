import { defineConfig, devices } from '@playwright/test';
import { APP_PORT, BASE_URL } from './acceptance/utils/env';

const IS_CI = Boolean(process.env.CI);

// End-to-end suite against the Auth and Firestore emulators (demo-lucas), see docs/PLAN_AMBIENTES.md, E.1.
// DEVIATION: the npm script is test:e2e (fixed by PROMPTS_AMBIENTES.md) instead of test:acceptance (P-12).
export default defineConfig({
  testDir: './acceptance/specs',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Port 8100 so it never clashes with npm run dev (8000); --mode e2e is the only way the app uses the emulators.
    command: `npx vite --mode e2e --port ${APP_PORT} --strictPort`,
    url: `${BASE_URL}login.html`,
    reuseExistingServer: !IS_CI,
  },
});
