import { buildTask } from '../../data/builders/task.builder';
import { BOARD_TEXTS } from '../../data/static/messages';
import { DUE_SOON_DATE, FIXED_NOW, OVERDUE_DATE } from '../../data/static/times';
import { expect, test } from '../../fixtures';

test.describe('Due date', { tag: ['@regression', '@board'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
  });

  test('a due date two business days away is marked as due soon', async ({
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    const task = buildTask({ createdAt: FIXED_NOW.getTime() });
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();
    const card = boardPage.taskCard('Pendiente', task.text);

    await card.fillDueDate(DUE_SOON_DATE);

    await expect(card.tags).toHaveText([BOARD_TEXTS.dueSoon]);
  });

  test('a past due date is marked as overdue', async ({ boardPage, member, signIn, emulatorAdmin }) => {
    const task = buildTask({ createdAt: FIXED_NOW.getTime(), dueDate: OVERDUE_DATE });
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);

    await boardPage.goto();

    await expect(boardPage.taskCard('Pendiente', task.text).tags).toHaveText([BOARD_TEXTS.overdue]);
  });
});
