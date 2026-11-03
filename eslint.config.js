import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import playwright from 'eslint-plugin-playwright';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Pruebas end-to-end con Playwright en TypeScript (docs/PLAN_AMBIENTES.md, E.1; skill
// estandares-pruebas-automatizadas, B.6). Sus reglas quedan acotadas a acceptance/ y no tocan la app.
const ACCEPTANCE_FILES = ['acceptance/**/*.ts'];
const TEST_LAYER_FILES = ['acceptance/specs/**/*.ts', 'acceptance/setup/**/*.ts'];
const NON_TEST_LAYER_FILES = [
  'acceptance/pages/**/*.ts',
  'acceptance/components/**/*.ts',
  'acceptance/data/**/*.ts',
  'acceptance/mocks/**/*.ts',
  'acceptance/utils/**/*.ts',
];

const FORBIDDEN_FIXED_WAIT = {
  selector: "CallExpression[callee.property.name='waitForTimeout']",
  message: 'Fixed waits are forbidden. Wait for a state instead.',
};

export default [
  { ignores: ['dist/', 'node_modules/', 'graphify-out/', 'docs/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    // Permite separar campos con desestructuración: const { id, ...data } = task.
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.config.js', 'rules-tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: ACCEPTANCE_FILES })),
  {
    files: ACCEPTANCE_FILES,
    languageOptions: {
      parserOptions: {
        project: './acceptance/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        // Los textos que la suite reutiliza de la app (LOGIN_MESSAGES…) conservan su nombre al importarse.
        { selector: 'import', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        { selector: 'variable', modifiers: ['const', 'global'], format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        {
          selector: ['variable', 'parameter', 'property'],
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'can', 'should', 'was'],
        },
        { selector: 'objectLiteralProperty', format: null },
      ],
      'id-length': ['error', { min: 2, exceptions: ['i', 'j'] }],
      'id-denylist': [
        'error',
        'data',
        'info',
        'temp',
        'tmp',
        'obj',
        'aux',
        'foo',
        'bar',
        'stuff',
        'thing',
        'misc',
        'e',
      ],
      'max-lines-per-function': ['error', { max: 25, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 3],
      complexity: ['error', 5],
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': ['error', FORBIDDEN_FIXED_WAIT],
    },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: TEST_LAYER_FILES,
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'warn',
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-element-handle': 'error',
      'playwright/no-page-pause': 'error',
      'playwright/no-force-option': 'error',
      'playwright/no-networkidle': 'error',
      'playwright/no-conditional-in-test': 'error',
      'playwright/prefer-web-first-assertions': 'error',
    },
  },
  {
    files: ['acceptance/specs/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'playwright/no-raw-locators': 'error',
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@playwright/test', message: 'Import test and expect from acceptance/fixtures.' }] },
      ],
      'no-restricted-syntax': [
        'error',
        FORBIDDEN_FIXED_WAIT,
        {
          selector: 'NewExpression[callee.name=/Page$/]',
          message: 'Get Page Objects from fixtures instead of instantiating them in specs.',
        },
      ],
    },
  },
  {
    files: NON_TEST_LAYER_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@playwright/test', importNames: ['expect', 'test'], message: 'Assertions belong in specs only.' },
          ],
        },
      ],
    },
  },
  {
    files: ['acceptance/fixtures/**/*.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },

  // Prettier se encarga del formato; ESLint, de los errores.
  prettier,
];
