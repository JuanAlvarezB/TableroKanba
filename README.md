# LUCAS

**LUCAS organiza tu día a día.** Su primera función es un tablero de tareas con tres
columnas (Pendiente, En curso, Completada), etiquetas de prioridad, fechas límite y
sincronización entre dispositivos con Firebase (Firestore y Authentication).

Solo entran las personas autorizadas, con correo y contraseña o con su cuenta de Google, y
cada una ve únicamente sus propias tareas. Es un sitio estático que se construye con
[Vite](https://vite.dev) (módulos ES y el paquete `firebase` de npm):

El código está organizado por capas (ver `docs/PLAN_ARQUITECTURA.md`). Cada capa solo importa de las
que tiene debajo: `domain` no depende de nada, `data` del dominio, y `presentation` de todas.
`src/architecture.test.js` lo comprueba en cada `npm test`.

| Carpeta                        | Qué contiene                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/domain/`                  | Reglas de negocio sin dependencias: entidad `Task`, vencimientos, prioridades, casos de uso             |
| `src/data/`                    | Acceso a datos: Firestore, Firebase Authentication y `localStorage`, detrás de repositorios             |
| `src/presentation/pages/`      | Un punto de entrada por página: `home` (`index.html`), `login` (`login.html`), `board` (`tablero.html`) |
| `src/presentation/components/` | Piezas de la interfaz: tarjeta, editor, menú de etiquetas, alertas, zona de cuenta                      |
| `src/presentation/state/`      | `boardStore.js`: estado del tablero y su sincronización                                                 |
| `src/presentation/guards/`     | `session.js`: protege las páginas autenticadas y cierra la sesión                                       |
| `src/shared/`                  | Configuración de Firebase por ambiente (lee `.env.local`) y textos compartidos                          |
| `src/styles/`                  | Hojas de estilo                                                                                         |
| `public/assets/`               | Imágenes que se publican tal cual (`husky.svg`)                                                         |
| `scripts/admin/`               | Script administrativo local (Admin SDK, credenciales de Google del administrador); no se publica        |

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
npm run dev       # servidor de desarrollo en http://localhost:8000, recarga al guardar
npm run build     # genera el sitio en dist/
npm run preview   # sirve dist/ en http://localhost:5500, igual que en PDN
npm test          # pruebas (Vitest)
npm run test:rules # pruebas de firestore.rules en el emulador (necesita Java 21; ver abajo)
npm run lint      # errores comunes (ESLint)
npm run format    # formatea el código (Prettier)
```

Usa siempre `localhost` (no `127.0.0.1` ni `file://`): la clave de API de Desarrollo solo
acepta `localhost:5500` y `localhost:8000`, y el inicio de sesión necesita un dominio
autorizado. No uses Live Server de VS Code para LUCAS: sirve los archivos sin procesar y la
página se queda en "Cargando…".

## Usuarios autorizados

No hay registro público: el administrador autoriza a cada persona **en cada ambiente** (las
cuentas no se comparten entre Desarrollo y PDN).

1. Firestore → colección `allowedUsers` → documento cuyo ID es el correo **en minúsculas**,
   con el campo `name` (texto) que LUCAS mostrará.
2. Correo y contraseña: Authentication → Usuarios → Agregar usuario, con una contraseña
   temporal que no se comparte; la persona crea la suya con **¿Olvidaste tu contraseña?**
   y verifica su correo desde el login. Con Google no hay que crear nada: basta el paso 1.

Un documento con solo `name` es un **miembro activo**. Campos opcionales: `role` (`admin` da el rol
de administrador; cualquier otro valor es miembro) y `active` (`false` desactiva la cuenta sin borrar
sus datos). El campo `uid` no se escribe a mano: lo registra la propia persona en su primer acceso.
El administrador no ve las tareas de nadie más.

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

Las reglas son la única barrera real de seguridad: lo publicado tiene que ser siempre el archivo.

### Publicar reglas paso a paso

En cada ambiente, primero Desarrollo y después PDN:

1. **Antes de publicar**, abre la consola de Firebase del proyecto → Firestore → **Reglas** y anota
   la fecha y hora de la versión vigente (la primera del historial, a la izquierda). Es la versión
   a la que se vuelve si algo falla.
2. Publica con la CLI (comandos de arriba). Debe terminar en `Deploy complete!` y nombrar el
   proyecto correcto.
3. Comprueba que lo publicado es el archivo:
   `npm run admin -- verificar-reglas --ambiente dev` (o `pdn`; ver más abajo). Sin el script,
   compara a mano el texto de la consola con `firestore.rules`.
4. Anota en la descripción del Pull Request el ambiente, la hora de la versión anterior y la de la
   nueva, y el resultado de la comprobación.
5. Después de publicar en PDN, etiqueta el commit cuyo `firestore.rules` publicaste, con la hora de
   la versión anterior en el mensaje:

   ```bash
   git tag -a pdn-reglas-AAAA-MM-DD -m "Reglas en PDN. Versión anterior: AAAA-MM-DD HH:MM"
   git push origin pdn-reglas-AAAA-MM-DD
   ```

### Volver a las reglas anteriores

- **Desde la consola** (lo más rápido): Firestore → Reglas → en el historial abre la versión que
  anotaste antes de publicar; la consola la compara con la actual y permite publicarla de nuevo.
- **Desde git**, con la etiqueta de una publicación anterior:

  ```bash
  git show pdn-reglas-AAAA-MM-DD:firestore.rules > firestore.rules
  npx firebase-tools deploy --only firestore:rules --project pdn
  npm run admin -- verificar-reglas --ambiente pdn   # compara con el archivo restaurado
  git checkout -- firestore.rules                    # vuelve el archivo a la versión de la rama
  ```

Después de revertir, anota la hora en el Pull Request o en una incidencia. Si el código ya
publicado necesita las reglas nuevas, revierte también el merge (ver "Cómo hacer un cambio").

### Comprobar con el script (`verificar-reglas`)

`npm run admin -- verificar-reglas --ambiente dev|pdn` descarga, con la API de Firebase Rules, las
reglas vigentes del proyecto (el de ese alias en `.firebaserc`) y compara su huella SHA-256 con
`firestore.rules`. Solo lee: no cambia nada en Firebase. Termina con código 0 si coinciden, 1 si no
coinciden (muestra la primera línea distinta) y 2 si no pudo comprobarlo. Si solo cambian espacios al
final de línea, lo indica y cuenta como coincidencia.

Usa tus credenciales de Google, nunca archivos de llave (si existe `GOOGLE_APPLICATION_CREDENTIALS`
se niega a correr). La primera vez:

```bash
brew install --cask gcloud-cli              # Google Cloud CLI (gratis)
gcloud auth application-default login      # con la cuenta de Google que tiene rol en Firebase
```

Si pide un proyecto de cuota: `gcloud auth application-default set-quota-project <proyecto>`.
El script vive en `scripts/admin/` (fuera de `src/`): no se empaqueta con el sitio ni se despliega.

### Pull Requests que cambian las reglas: orden y borrador

Las reglas se publican en PDN **antes** del merge. Hay cambios en los que el orden es estricto: si
el código nuevo escribe campos o colecciones que las reglas anteriores rechazan (por ejemplo, un
campo nuevo en la lista de `isValidTask`), fusionar antes de publicar haría que PDN rechace las
escrituras. Para que el orden no dependa de la memoria:

1. Abre el Pull Request como **borrador** (**Create draft pull request**): GitHub no deja fusionar
   un borrador.
2. Pon en la descripción esta lista y complétala al publicar:

   ```markdown
   - [ ] Reglas en Desarrollo: versión anterior HH:MM → nueva HH:MM · verificar-reglas ✔
   - [ ] Reglas en PDN: versión anterior HH:MM → nueva HH:MM · verificar-reglas ✔
   ```

3. Marca el Pull Request **Ready for review** solo cuando las dos casillas estén marcadas; entonces
   ya se puede fusionar.

Si dudas de si un cambio es de orden estricto, trátalo como si lo fuera.

### Probar las reglas en local

Las pruebas de `rules-tests/` ejercen `firestore.rules` en el emulador de Firestore, con el
proyecto ficticio `demo-lucas`: no necesitan `firebase login`, claves ni `.env.local`, y no tocan
Desarrollo ni PDN. Si se ejecutan fuera del emulador o con un proyecto que no empiece por `demo-`,
se detienen sin conectarse a nada.

El emulador necesita **Java 21 o superior** (`java -version`). En macOS:

```bash
brew install openjdk@21
```

Después:

```bash
npm run test:rules   # arranca el emulador (puerto 8180), corre las pruebas y lo apaga
```

`npm test` no las corre, para no depender de Java. En cada Pull Request las corre el trabajo
`reglas` de `ci.yml`. Cada regla nueva lleva su prueba, también la que comprueba lo que se niega.

## Cómo hacer un cambio

`main` es PDN: cada merge a `main` despliega a GitHub Pages
(`.github/workflows/deploy.yml`). `main` está protegida, así que todo cambio entra por
Pull Request.

1. `git checkout main && git pull`, y crea una rama: `feature/…`, `fix/…`, `docs/…` o
   `chore/…`.
2. Desarrolla y prueba en local, contra Desarrollo, con commits pequeños.
3. Si cambian las reglas, publícalas en `dev`, compruébalas y prueba (ver "Publicar reglas paso a
   paso").
4. Abre un Pull Request hacia `main` (**como borrador** si cambia las reglas) y revisa "Files
   changed". `ci.yml` revisa formato, lint, pruebas y build (`revisar`) y las reglas en el emulador
   (`reglas`); los dos tienen que terminar en verde.
5. Si cambiaron las reglas, publícalas en `pdn` y compruébalas **antes** del merge; después marca el
   Pull Request **Ready for review**.
6. Haz merge con **Create a merge commit**. Espera a que Actions termine en verde y
   verifica PDN (recarga con `Cmd + Shift + R`).
7. Etiqueta la versión (`git tag -a pdn-AAAA-MM-DD`; si se publicaron reglas, también
   `pdn-reglas-AAAA-MM-DD`) y borra la rama.

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
