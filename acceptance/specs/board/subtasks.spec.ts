import { buildSubtask, buildTask } from '../../data/builders/task.builder';
import { BOARD_MESSAGES } from '../../data/static/messages';
import { expect, test } from '../../fixtures';

const SUBTASK_TEXTS = BOARD_MESSAGES.subtasks;

test.describe('Subtasks', { tag: ['@regression', '@board'] }, () => {
  test('adds subtasks and shows the progress on the card', async ({
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    const task = buildTask();
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();
    const card = boardPage.taskCard('Pendiente', task.text);
    const dialog = boardPage.subtaskDialog(task.text);

    await card.addSubtasksButton.click();
    await dialog.addSubtask('Medir la pared');
    await dialog.addSubtask('Comprar la pintura');
    await dialog.closeButton.click();

    await expect(card.subtasksProgressButton).toHaveAccessibleName(SUBTASK_TEXTS.openLabel(0, 2));
  });

  test('cannot complete a task with pending subtasks', async ({
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    const task = buildTask({
      status: 'in-progress',
      subtasks: [buildSubtask('Medir la pared', true), buildSubtask('Comprar la pintura')],
    });
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();

    await boardPage.taskCard('En curso', task.text).moveForwardButton.click();

    await expect(boardPage.confirmDialog(SUBTASK_TEXTS.blocked.title).root).toBeVisible();
    await expect(boardPage.taskCard('En curso', task.text).root).toBeVisible();
  });

  test('completes the task once every subtask is done', async ({
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    const task = buildTask({
      status: 'in-progress',
      subtasks: [buildSubtask('Medir la pared', true), buildSubtask('Comprar la pintura')],
    });
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();
    const dialog = boardPage.subtaskDialog(task.text);

    await boardPage.taskCard('En curso', task.text).subtasksProgressButton.click();
    await dialog.subtaskCheckbox('Comprar la pintura').check();
    await dialog.completeButton.click();

    await expect(boardPage.taskCard('Completada', task.text).root).toBeVisible();
  });
});
