import type { Locator } from '@playwright/test';

export class AccountMenuComponent {
  readonly signOutButton: Locator;

  constructor(readonly root: Locator) {
    this.signOutButton = root.getByRole('button', { name: 'Cerrar sesión' });
  }
}
