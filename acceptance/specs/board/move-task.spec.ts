import { buildTask } from '../../data/builders/task.builder';
import { STATUS_LABELS } from '../../data/static/messages';
import { expect, test } from '../../fixtures';

test.describe('Move a task', { tag: ['@smoke', '@board'] }, () => {
  test('moves from Pending to In progress to Completed and the history shows each step', async ({
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    const task = buildTask();
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();

    await boardPage.taskCard('Pendiente', task.text).moveForwardButton.click();
    await boardPage.taskCard('En curso', task.text).moveForwardButton.click();

    const completedCard = boardPage.taskCard('Completada', task.text);
    await expect(completedCard.root).toBeVisible();
    await expect(boardPage.taskCard('Pendiente', task.text).root).toHaveCount(0);
    await expect(completedCard.historySteps).toContainText([
      STATUS_LABELS.pending,
      STATUS_LABELS['in-progress'],
      STATUS_LABELS.completed,
    ]);
  });
});
