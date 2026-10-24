// Configuración de Vitest para las pruebas de firestore.rules; la usa npm run test:rules dentro del
// emulador. Va aparte de vite.config.js para que npm test no las corra (necesitan Java y el emulador).
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  test: {
    include: ['rules-tests/**/*.rules.test.js'],
    // Todos los archivos comparten el mismo emulador y lo vacían antes de cada prueba.
    fileParallelism: false,
  },
});
