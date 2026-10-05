# LUCAS

**LUCAS organiza tu día a día.** Su primera función es un tablero de tareas con tres
columnas (Pendiente, En curso, Completada), etiquetas de prioridad, fechas límite y
sincronización entre dispositivos con Firebase (Firestore y Authentication).

Solo entran las personas autorizadas, con correo y contraseña o con su cuenta de Google, y
cada una ve únicamente sus propias tareas. Es un sitio estático que se construye con
[Vite](https://vite.dev) (módulos ES y el paquete `firebase` de npm):

| Archivo                                                 | Qué es                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `login.html`, `src/login.js`, `src/styles/login.css`    | Inicio de sesión, recuperar contraseña y verificar el correo   |
| `index.html`, `src/inicio.js`, `src/styles/inicio.css`  | Inicio de LUCAS: lista las funciones disponibles               |
| `tablero.html`, `src/script.js`, `src/styles/style.css` | Tablero de tareas                                              |
| `src/auth.js`                                           | Sesión compartida: carga Firebase, autoriza y cierra la sesión |
| `src/cuenta.js`, `src/styles/lucas.css`                 | Zona de usuario y diálogos (cerrar sesión, cambiar contraseña) |
| `src/shared/config/firebase.config.js`                  | Proyecto de Firebase de cada ambiente (lee `.env.local`)       |
| `public/assets/`                                        | Imágenes que se publican tal cual (`husky.svg`)                |

La reestructuración por capas (dominio, datos, presentación) está en curso: ver
`docs/PLAN_ARQUITECTURA.md`.

Publicado en <https://juanalvarezb.github.io/TableroKanba/>.

## Ambientes

| Ambiente   | Dónde se abre                           | Proyecto de Firebase   | Claves en `localStorage`                        |
| ---------- | --------------------------------------- | ---------------------- | ----------------------------------------------- |
| PDN        | `juanalvarezb.github.io` (GitHub Pages) | `tablero-kanban-76c61` | `tareas-<uid>`, `tareas-migradas-<uid>`         |
| Desarrollo | Cualquier otra dirección: `localhost`…  | `tablero-kanban-dev`   | `tareas-dev-<uid>`, `tareas-migradas-dev-<uid>` |

Las claves llevan el `uid` de la persona, para que nadie vea la copia local de otra en el
mismo navegador; al cerrar sesión se borran. Las claves sin `uid` (`tareas`, `tareas-dev`…)
son del tablero anónimo anterior y se borran al iniciar sesión.

`src/shared/config/firebase.config.js` elige el ambiente según la dirección de la página (no
según el modo de Vite). Solo el dominio de GitHub
Pages usa PDN; cualquier otra dirección usa Desarrollo, así que un error deja datos de
prueba en Desarrollo, nunca en PDN.

**¿En qué ambiente estoy?**

- En Desarrollo aparece el distintivo **DESARROLLO** en cada página y la pestaña empieza
  por "[DEV]".
- En la pestaña Red del navegador, las peticiones a Firebase llevan el `projectId` del ambiente.

## Correr en local

Necesitas Node 22 o superior. La primera vez, desde la carpeta del proyecto:

```bash
npm install
cp .env.example .env.local   # y rellena los valores (Firebase → Configuración del proyecto)
```

Después:

```bash
npm run dev       # servidor de desarrollo en http://localhost:5500, recarga al guardar
npm run build     # genera el sitio en dist/
npm run preview   # sirve dist/ en http://localhost:8000, igual que en PDN
npm test          # pruebas (Vitest)
npm run lint      # errores comunes (ESLint)
npm run format    # formatea el código (Prettier)
```

Usa siempre `localhost` (no `127.0.0.1` ni `file://`): la clave de API de Desarrollo solo
acepta `localhost:5500` y `localhost:8000`, y el inicio de sesión necesita un dominio
autorizado. Cierra Live Server de VS Code antes de `npm run dev`: también usa el puerto 5500.

## Usuarios autorizados

No hay registro público: el administrador autoriza a cada persona **en cada ambiente** (las
cuentas no se comparten entre Desarrollo y PDN).

1. Firestore → colección `allowedUsers` → documento cuyo ID es el correo **en minúsculas**,
   con el campo `name` (texto) que LUCAS mostrará.
2. Correo y contraseña: Authentication → Usuarios → Agregar usuario, con una contraseña
   temporal que no se comparte; la persona crea la suya con **¿Olvidaste tu contraseña?**
   y verifica su correo desde el login. Con Google no hay que crear nada: basta el paso 1.

Las contraseñas nunca se escriben en el repositorio ni se envían por chat o correo.

## Reglas de Firestore

Las reglas están en `firestore.rules` y se publican con la CLI de Firebase (`firebase.json`
y `.firebaserc` definen los alias `dev` y `pdn`). Se usa con `npx`, sin instalarla
globalmente:

```bash
npx firebase-tools login                                          # una sola vez
npx firebase-tools deploy --only firestore:rules --project dev    # primero Desarrollo
npx firebase-tools deploy --only firestore:rules --project pdn    # PDN, antes del merge
```

- Publica siempre con `--only firestore:rules` y con `--project`.
- No uses `firebase init`: puede sobrescribir `firestore.rules`.

## Cómo hacer un cambio

`main` es PDN: cada merge a `main` despliega a GitHub Pages
(`.github/workflows/deploy.yml`). `main` está protegida, así que todo cambio entra por
Pull Request.

1. `git checkout main && git pull`, y crea una rama: `feature/…`, `fix/…`, `docs/…` o
   `chore/…`.
2. Desarrolla y prueba en local, contra Desarrollo, con commits pequeños.
3. Si cambian las reglas, publícalas en `dev` y prueba.
4. Abre un Pull Request hacia `main` y revisa "Files changed". `ci.yml` revisa formato, lint,
   pruebas y build; tiene que terminar en verde.
5. Si cambiaron las reglas, publícalas en `pdn` **antes** del merge.
6. Haz merge con **Create a merge commit**. Espera a que Actions termine en verde y
   verifica PDN (recarga con `Cmd + Shift + R`).
7. Etiqueta la versión (`git tag -a pdn-AAAA-MM-DD`) y borra la rama.

Si algo falla en PDN, se revierte el merge con el botón **Revert** del Pull Request (o
`git revert -m 1 <hash-del-merge>`). Nunca `git reset` ni `push --force` sobre `main`.

## Archivos nuevos

- **`.js` y `.css`**: van en `src/` y se importan desde el módulo de su página (o se enlazan
  desde el HTML). Vite los incluye en el build y les pone un hash en el nombre, así Safari
  nunca usa una versión anterior de su caché.
- **Imágenes y otros archivos que se publican tal cual**: van en `public/assets/` y se
  enlazan como `/assets/<archivo>`.
- **Una página `.html` nueva**: agrégala también a `build.rolldownOptions.input` de
  `vite.config.js` y a la comprobación de `deploy.yml`.

## Despliegue y variables de Firebase

`deploy.yml` ejecuta `npm ci` y `npm run build`, comprueba el sitio y publica `dist/`. La
configuración de Firebase sale de las **variables del repositorio** en GitHub (Settings →
Secrets and variables → Actions → Variables), con los mismos nombres que `.env.example`.
Para cargarlas desde tu `.env.local`:

```bash
gh variable set -f .env.local
```

Si falta alguna, `vite build` se detiene y no se despliega nada.
