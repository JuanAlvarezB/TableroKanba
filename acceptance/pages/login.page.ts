import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

const LOCAL_TASK_KEY_PREFIX = 'tareas-e2e';

export class LoginPage extends BasePage {
  protected readonly path = '/login.html';
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    // The page also holds the (hidden) password-reset and email-verification views: stay inside the form.
    const signInForm = page.getByRole('form', { name: 'Inicia sesión' });
    this.heading = page.getByRole('heading', { name: 'Inicia sesión' });
    this.emailInput = signInForm.getByLabel('Correo', { exact: true });
    this.passwordInput = signInForm.getByLabel('Contraseña', { exact: true });
    this.submitButton = signInForm.getByRole('button', { name: 'Iniciar sesión' });
    this.errorMessage = page.getByRole('alert');
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  // Keys of the local copy of the tasks in this environment (tareas-e2e-<uid>, tareas-migradas-e2e-<uid>).
  async getLocalTaskKeys(): Promise<string[]> {
    return this.page.evaluate(
      (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
      LOCAL_TASK_KEY_PREFIX,
    );
  }
}
