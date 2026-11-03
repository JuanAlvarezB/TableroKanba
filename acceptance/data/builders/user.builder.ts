import { randomUUID } from 'node:crypto';

export type Role = 'member' | 'admin';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  role: Role;
  isActive: boolean;
}

export interface RegisteredUser extends TestUser {
  uid: string;
}

const DEFAULT_PASSWORD = 'e2e-Password-2026';

// Unique per test: tests run in parallel and never share accounts.
export function buildUser(overrides: Partial<TestUser> = {}): TestUser {
  const suffix = randomUUID().slice(0, 8);
  return {
    email: `persona-${suffix}@example.com`,
    password: DEFAULT_PASSWORD,
    name: `Persona ${suffix}`,
    role: 'member',
    isActive: true,
    ...overrides,
  };
}
