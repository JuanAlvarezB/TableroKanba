// Where the suite runs. The app is served by Playwright's webServer (vite --mode e2e) and talks only to the
// local emulators of a fictitious demo-... project: no credentials and no real Firebase project.
export const APP_PORT = 8100;
export const BASE_URL = `http://localhost:${APP_PORT}/`;

const DEMO_PROJECT_PREFIX = 'demo-';
const REQUIRED_EMULATOR_VARIABLES = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'] as const;

// Same defense as rules-tests/helpers.js: refuse to seed anything unless firebase emulators:exec started the
// emulators of a demo-... project (npm run test:e2e).
export function getEmulatorProjectId(): string {
  const projectId = process.env.GCLOUD_PROJECT ?? '';
  if (!projectId.startsWith(DEMO_PROJECT_PREFIX)) {
    throw new Error(
      `The e2e suite only runs against a demo-... project (got "${projectId}"). Use npm run test:e2e.`,
    );
  }
  const missing = REQUIRED_EMULATOR_VARIABLES.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing emulator variables: ${missing.join(', ')}. Use npm run test:e2e.`);
  }
  return projectId;
}
