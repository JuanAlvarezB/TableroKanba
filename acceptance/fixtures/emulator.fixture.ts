import { test as base } from '@playwright/test';
import { buildUser, type RegisteredUser } from '../data/builders/user.builder';
import { EmulatorAdmin } from '../utils/emulator-admin';

interface EmulatorWorkerFixtures {
  emulatorAdmin: EmulatorAdmin;
}

interface AccountFixtures {
  member: RegisteredUser;
}

export const emulatorFixture = base.extend<AccountFixtures, EmulatorWorkerFixtures>({
  emulatorAdmin: [
    async ({}, use) => {
      const admin = new EmulatorAdmin();
      await use(admin);
      await admin.close();
    },
    { scope: 'worker' },
  ],
  // A fresh authorized member per test: no test depends on data left by another.
  member: async ({ emulatorAdmin }, use) => {
    await use(await emulatorAdmin.registerUser(buildUser()));
  },
});
