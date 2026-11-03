import { test as base } from '@playwright/test';
import { BoardPage } from '../pages/board.page';
import { HomePage } from '../pages/home.page';
import { LoginPage } from '../pages/login.page';

interface PageFixtures {
  loginPage: LoginPage;
  homePage: HomePage;
  boardPage: BoardPage;
}

export const pagesFixture = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  boardPage: async ({ page }, use) => {
    await use(new BoardPage(page));
  },
});
