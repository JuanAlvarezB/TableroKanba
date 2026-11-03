import { expect, test } from '../../fixtures';

const TASK_TEXT = 'Comprar pan';

test.describe('Create a task', { tag: ['@smoke', '@board'] }, () => {
  test('a new task lands in Pending without a label and is stored in Firestore', async ({
    page,
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    await signIn(member);
    await boardPage.goto();

    await boardPage.addTask(TASK_TEXT);

    const card = boardPage.taskCard('Pendiente', TASK_TEXT);
    await expect(card.root).toBeVisible();
    await expect(card.tags).toHaveCount(0);
    await expect.poll(() => emulatorAdmin.getTaskTexts(member)).toEqual([TASK_TEXT]);
    await page.reload();
    await expect(boardPage.taskCard('Pendiente', TASK_TEXT).root).toBeVisible();
  });
});
