import type { Locator, Page } from '@playwright/test';
import { AccountMenuComponent } from '../components/account-menu.component';
import { ConfirmDialogComponent } from '../components/confirm-dialog.component';
import { SubtaskDialogComponent } from '../components/subtask-dialog.component';
import { TaskCardComponent } from '../components/task-card.component';
import { BasePage } from './base.page';

export type ColumnName = 'Pendiente' | 'En curso' | 'Completada';

export class BoardPage extends BasePage {
  protected readonly path = '/tablero.html';
  readonly newTaskInput: Locator;
  readonly addTaskButton: Locator;
  readonly taskEditor: Locator;
  readonly accountMenu: AccountMenuComponent;

  constructor(page: Page) {
    super(page);
    this.newTaskInput = page.getByRole('textbox', { name: 'Nueva tarea' });
    this.addTaskButton = page.getByRole('button', { name: 'Agregar', exact: true });
    this.taskEditor = page.getByRole('textbox', { name: 'Texto de la tarea' });
    this.accountMenu = new AccountMenuComponent(page.getByRole('navigation', { name: 'LUCAS' }));
  }

  column(name: ColumnName): Locator {
    return this.page.getByRole('region', { name });
  }

  // Only the cards themselves, matched by their exact text: a card also contains lists and its history, which
  // can quote an earlier text of the task.
  taskCard(column: ColumnName, text: string): TaskCardComponent {
    const exactText = this.page.getByText(text, { exact: true });
    return new TaskCardComponent(this.column(column).locator('.task-list > li').filter({ has: exactText }));
  }

  confirmDialog(title: string): ConfirmDialogComponent {
    return new ConfirmDialogComponent(this.page.getByRole('dialog', { name: title }));
  }

  subtaskDialog(taskText: string): SubtaskDialogComponent {
    return new SubtaskDialogComponent(this.page.getByRole('dialog', { name: taskText }));
  }

  async addTask(text: string): Promise<void> {
    await this.newTaskInput.fill(text);
    await this.addTaskButton.click();
  }
}
