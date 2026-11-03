import { mergeTests } from '@playwright/test';
import type { TestUser } from '../data/builders/user.builder';
import { emulatorFixture } from './emulator.fixture';
import { pagesFixture } from './pages.fixture';

interface SessionFixtures {
  signIn: (user: TestUser) => Promise<void>;
}

// Signs in through the real login form and waits for the home page, so each test starts from its own session.
export const test = mergeTests(pagesFixture, emulatorFixture).extend<SessionFixtures>({
  signIn: async ({ loginPage, homePage }, use) => {
    await use(async (user) => {
      await loginPage.goto();
      await loginPage.signIn(user.email, user.password);
      await homePage.greeting.waitFor();
    });
  },
});

export { expect } from '@playwright/test';
