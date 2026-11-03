import type { Locator } from '@playwright/test';
import { BOARD_MESSAGES } from '../data/static/messages';

const SUBTASK_TEXTS = BOARD_MESSAGES.subtasks;

export class SubtaskDialogComponent {
  readonly newSubtaskInput: Locator;
  readonly addButton: Locator;
  readonly closeButton: Locator;
  readonly completeButton: Locator;

  constructor(readonly root: Locator) {
    this.newSubtaskInput = root.getByRole('textbox', { name: SUBTASK_TEXTS.newLabel });
    this.addButton = root.getByRole('button', { name: SUBTASK_TEXTS.add, exact: true });
    this.closeButton = root.getByRole('button', { name: SUBTASK_TEXTS.close, exact: true });
    this.completeButton = root.getByRole('button', { name: SUBTASK_TEXTS.complete });
  }

  subtaskCheckbox(text: string): Locator {
    return this.root.getByRole('checkbox', { name: text });
  }

  async addSubtask(text: string): Promise<void> {
    await this.newSubtaskInput.fill(text);
    await this.addButton.click();
  }
}
