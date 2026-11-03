import type { Locator } from '@playwright/test';
import { LABEL_MENU_NAMES } from '../data/static/messages';

export class TaskCardComponent {
  readonly moveForwardButton: Locator;
  readonly moveBackButton: Locator;
  readonly labelMenuButton: Locator;
  readonly labelMenu: Locator;
  readonly dueDateInput: Locator;
  readonly editButton: Locator;
  readonly deleteButton: Locator;
  readonly addSubtasksButton: Locator;
  readonly subtasksProgressButton: Locator;
  readonly tags: Locator;
  readonly historySteps: Locator;

  constructor(readonly root: Locator) {
    this.moveForwardButton = root.getByRole('button', { name: 'Mover a la columna siguiente' });
    this.moveBackButton = root.getByRole('button', { name: 'Mover a la columna anterior' });
    this.labelMenuButton = root.getByRole('button', { name: LABEL_MENU_NAMES.both });
    this.labelMenu = root.getByRole('group', { name: LABEL_MENU_NAMES.both });
    this.dueDateInput = this.labelMenu.getByLabel('Fecha límite (opcional)');
    this.editButton = root.getByRole('button', { name: 'Editar tarea' });
    this.deleteButton = root.getByRole('button', { name: 'Eliminar tarea' });
    this.addSubtasksButton = root.getByRole('button', { name: 'Agregar subtareas' });
    this.subtasksProgressButton = root.getByRole('button', { name: /^Subtareas:/ });
    this.tags = root.locator('.card-tags .tag');
    this.historySteps = root.getByRole('list', { name: 'Historial de estados' }).getByRole('listitem');
  }

  async selectPriority(optionName: string): Promise<void> {
    await this.labelMenuButton.click();
    await this.labelMenu.getByRole('button', { name: optionName }).click();
  }

  // Same choice, operated only with the keyboard.
  async selectPriorityWithKeyboard(optionName: string): Promise<void> {
    await this.labelMenuButton.press('Enter');
    await this.labelMenu.getByRole('button', { name: optionName }).press('Enter');
  }

  async fillDueDate(date: string): Promise<void> {
    await this.labelMenuButton.click();
    await this.dueDateInput.fill(date);
  }
}
