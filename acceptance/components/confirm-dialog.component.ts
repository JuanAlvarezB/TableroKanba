import type { Locator } from '@playwright/test';

export class ConfirmDialogComponent {
  readonly cancelButton: Locator;

  constructor(readonly root: Locator) {
    this.cancelButton = root.getByRole('button', { name: 'Cancelar', exact: true });
  }

  async confirm(actionName: string): Promise<void> {
    await this.root.getByRole('button', { name: actionName }).click();
  }
}
