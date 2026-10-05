import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

// Variables que necesita src/shared/config/firebase.config.js en cada ambiente.
const FIREBASE_KEYS = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID'];
const REQUIRED_ENV = ['DEV', 'PDN'].flatMap((name) => FIREBASE_KEYS.map((key) => `VITE_FIREBASE_${name}_${key}`));

export default defineConfig(({ command, mode }) => {
  // Sin configuración, Firebase fallaría en el navegador; mejor que falle el build (y el deploy).
  if (command === 'build') {
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
    const missing = REQUIRED_ENV.filter((key) => !env[key]);
    if (missing.length) {
      throw new Error(`Faltan variables de Firebase (ver .env.example): ${missing.join(', ')}`);
    }
  }

  return {
    // Rutas relativas: el sitio funciona en https://juanalvarezb.github.io/TableroKanba/ y en local.
    base: './',
    // La clave de API de Desarrollo solo acepta localhost:8000 y localhost:5500 (ver README).
    // npm run dev usa el 8000 para no chocar con Live Server de VS Code, que usa el 5500.
    server: { port: 8000, strictPort: true },
    preview: { port: 5500, strictPort: true },
    build: {
      // El SDK de Firestore (~560 kB) es un solo bloque y se carga aparte, solo cuando hace falta.
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        input: {
          inicio: resolve(import.meta.dirname, 'index.html'),
          login: resolve(import.meta.dirname, 'login.html'),
          tablero: resolve(import.meta.dirname, 'tablero.html'),
        },
      },
    },
  };
});
