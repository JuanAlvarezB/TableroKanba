import { buildTask } from '../../data/builders/task.builder';
import { BOARD_TEXTS, PRIORITIES } from '../../data/static/messages';
import { expect, test } from '../../fixtures';

test.describe('Priority label', { tag: ['@regression', '@board'] }, () => {
  test('sets, changes and removes the priority of a task', async ({
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

    await card.selectPriority(PRIORITIES.urgent.label);
    await expect(card.tags).toHaveText([`${PRIORITIES.urgent.icon} ${PRIORITIES.urgent.label}`]);
    await card.selectPriority(PRIORITIES.high.label);
    await expect(card.tags).toHaveText([`${PRIORITIES.high.icon} ${PRIORITIES.high.label}`]);
    await card.selectPriority(BOARD_TEXTS.noPriority);

    await expect(card.tags).toHaveCount(0);
  });

  test('sets the priority using only the keyboard', async ({ boardPage, member, signIn, emulatorAdmin }) => {
    const task = buildTask();
    await emulatorAdmin.seedTasks(member, [task]);
    await signIn(member);
    await boardPage.goto();
    const card = boardPage.taskCard('Pendiente', task.text);

    await card.selectPriorityWithKeyboard(PRIORITIES.low.label);

    await expect(card.tags).toHaveText([`${PRIORITIES.low.icon} ${PRIORITIES.low.label}`]);
  });
});
