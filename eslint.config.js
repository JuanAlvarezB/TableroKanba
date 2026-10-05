import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'graphify-out/', 'docs/'] },
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
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  // Prettier se encarga del formato; ESLint, de los errores.
  prettier,
];
