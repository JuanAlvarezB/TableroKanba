import { expect, test } from '../../fixtures';

const SIGN_OUT_TITLE = '¿Cerrar sesión?';
const SIGN_OUT_ACTION = 'Cerrar sesión';

test.describe('Sign out', { tag: ['@smoke', '@auth'] }, () => {
  test('signing out asks for confirmation and returns to the login without a local copy', async ({
    page,
    loginPage,
    boardPage,
    member,
    signIn,
  }) => {
    await signIn(member);
    await boardPage.goto();
    await boardPage.addTask('Revisar el correo');
    await expect(boardPage.taskCard('Pendiente', 'Revisar el correo').root).toBeVisible();

    await boardPage.accountMenu.signOutButton.click();
    await boardPage.confirmDialog(SIGN_OUT_TITLE).confirm(SIGN_OUT_ACTION);

    await expect(loginPage.heading).toBeVisible();
    await expect(page).toHaveURL(/login\.html/);
    expect(await loginPage.getLocalTaskKeys()).toEqual([]);
  });
});
