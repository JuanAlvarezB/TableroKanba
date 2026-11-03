import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class HomePage extends BasePage {
  protected readonly path = '/index.html';
  readonly greeting: Locator;
  readonly boardLink: Locator;

  constructor(page: Page) {
    super(page);
    // The login page has its own h1: only the home greeting proves the sign-in finished.
    this.greeting = page.getByRole('heading', { level: 1, name: /^Hola,/ });
    this.boardLink = page.getByRole('link', { name: 'Abrir tablero' });
  }
}
