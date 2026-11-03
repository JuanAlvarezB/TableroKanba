import { buildTask } from '../../data/builders/task.builder';
import { BOARD_MESSAGES } from '../../data/static/messages';
import { expect, test } from '../../fixtures';

const DELETE_TEXTS = BOARD_MESSAGES.deleteTask;
const EDITED_TEXT = 'Texto corregido';

test.describe('Edit and delete a task', { tag: ['@regression', '@board'] }, () => {
  test('Enter saves the edited text', async ({ boardPage, member, signIn, emulatorAdmin }) => {
    const task = buildTask();
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();

    await boardPage.taskCard('Pendiente', task.text).editButton.click();
    await boardPage.taskEditor.fill(EDITED_TEXT);
    await boardPage.taskEditor.press('Enter');

    await expect(boardPage.taskCard('Pendiente', EDITED_TEXT).root).toBeVisible();
    await expect(boardPage.taskCard('Pendiente', task.text).root).toHaveCount(0);
  });

  test('Escape cancels the edit and keeps the original text', async ({
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    const task = buildTask();
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();

    await boardPage.taskCard('Pendiente', task.text).editButton.click();
    await boardPage.taskEditor.fill(EDITED_TEXT);
    await boardPage.taskEditor.press('Escape');

    await expect(boardPage.taskCard('Pendiente', task.text).root).toBeVisible();
    await expect(boardPage.taskEditor).toHaveCount(0);
  });

  test('deleting asks for confirmation and Cancel keeps the task', async ({
    boardPage,
    member,
    signIn,
    emulatorAdmin,
  }) => {
    const task = buildTask();
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();

    await boardPage.taskCard('Pendiente', task.text).deleteButton.click();
    await boardPage.confirmDialog(DELETE_TEXTS.title).cancelButton.click();

    await expect(boardPage.confirmDialog(DELETE_TEXTS.title).root).toBeHidden();
    await expect(boardPage.taskCard('Pendiente', task.text).root).toBeVisible();
  });

  test('confirming the deletion removes the task', async ({ boardPage, member, signIn, emulatorAdmin }) => {
    const task = buildTask();
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();

    await boardPage.taskCard('Pendiente', task.text).deleteButton.click();
    await boardPage.confirmDialog(DELETE_TEXTS.title).confirm(DELETE_TEXTS.confirm);

    await expect(boardPage.taskCard('Pendiente', task.text).root).toHaveCount(0);
    await expect.poll(() => emulatorAdmin.getTaskTexts(member)).toEqual([]);
  });
});
