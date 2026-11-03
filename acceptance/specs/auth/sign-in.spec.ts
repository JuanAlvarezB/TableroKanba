import { expect, test } from '../../fixtures';

test.describe('Sign in', { tag: ['@smoke', '@auth'] }, () => {
  test('an authorized member signs in with email and password and reaches the home page', async ({
    page,
    loginPage,
    homePage,
    member,
  }) => {
    await loginPage.goto();

    await loginPage.signIn(member.email, member.password);

    await expect(homePage.greeting).toContainText(member.name);
    await expect(page).toHaveURL(/tablero\.html$/);
  });
});
