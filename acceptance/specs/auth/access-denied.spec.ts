import { buildUser } from '../../data/builders/user.builder';
import { LOGIN_MESSAGES } from '../../data/static/messages';
import { expect, test } from '../../fixtures';

test.describe('Access denied', { tag: ['@smoke', '@auth'] }, () => {
  test('an account without authorization cannot enter LUCAS', async ({ page, loginPage, emulatorAdmin }) => {
    const stranger = await emulatorAdmin.createAccount(buildUser());
    await loginPage.goto();

    await loginPage.signIn(stranger.email, stranger.password);

    await expect(loginPage.errorMessage).toHaveText(LOGIN_MESSAGES.denied);
    await expect(page).toHaveURL(/login\.html$/);
  });

  test('a deactivated account sees the deactivation notice and does not enter', async ({
    page,
    loginPage,
    emulatorAdmin,
  }) => {
    const deactivated = await emulatorAdmin.registerUser(buildUser({ isActive: false }));
    await loginPage.goto();

    await loginPage.signIn(deactivated.email, deactivated.password);

    await expect(loginPage.errorMessage).toHaveText(LOGIN_MESSAGES.inactive);
    await expect(page).toHaveURL(/login\.html$/);
  });
});
