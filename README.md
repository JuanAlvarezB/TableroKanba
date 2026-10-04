# LUCAS

**LUCAS organiza tu día a día.** Su primera función es un tablero de tareas con tres
columnas (Pendiente, En curso, Completada), etiquetas de prioridad, fechas límite y
sincronización entre dispositivos con Firebase (Firestore y Authentication).

Solo entran las personas autorizadas, con correo y contraseña o con su cuenta de Google, y
cada una ve únicamente sus propias tareas. Es un sitio estático, sin dependencias ni paso de
compilación:

| Archivo                               | Qué es                                                         |
|---------------------------------------|----------------------------------------------------------------|
| `login.html`, `login.css`, `login.js` | Inicio de sesión, recuperar contraseña y verificar el correo   |
| `index.html`, `inicio.js`             | Inicio de LUCAS: lista las funciones disponibles               |
| `tablero.html`, `script.js`, `style.css` | Tablero de tareas                                           |
| `auth.js`                             | Sesión compartida: carga Firebase, autoriza y cierra la sesión |
| `cuenta.js`, `lucas.css`              | Zona de usuario y diálogos (cerrar sesión, cambiar contraseña) |
| `config.js`                           | Proyecto de Firebase de cada ambiente                          |

Publicado en <https://juanalvarezb.github.io/TableroKanba/>.

## Ambientes

| Ambiente   | Dónde se abre                                   | Proyecto de Firebase   | Claves en `localStorage`             |
|------------|-------------------------------------------------|------------------------|--------------------------------------|
| PDN        | `juanalvarezb.github.io` (GitHub Pages)         | `tablero-kanban-76c61` | `tareas-<uid>`, `tareas-migradas-<uid>` |
| Desarrollo | Cualquier otra dirección: `localhost`…          | `tablero-kanban-dev`   | `tareas-dev-<uid>`, `tareas-migradas-dev-<uid>` |

Las claves llevan el `uid` de la persona, para que nadie vea la copia local de otra en el
mismo navegador; al cerrar sesión se borran. Las claves sin `uid` (`tareas`, `tareas-dev`…)
son del tablero anónimo anterior y se borran al iniciar sesión.

`config.js` elige el ambiente según la dirección de la página. Solo el dominio de GitHub
Pages usa PDN; cualquier otra dirección usa Desarrollo, así que un error deja datos de
prueba en Desarrollo, nunca en PDN.

**¿En qué ambiente estoy?**

- En Desarrollo aparece el distintivo **DESARROLLO** en cada página y la pestaña empieza
  por "[DEV]".
- En la consola del navegador, `APP_ENV.name` responde `"dev"` o `"pdn"`.

## Correr en local

Desde la carpeta del proyecto:

```bash
python3 -m http.server 8000
```

Abre <http://localhost:8000>. También sirve Live Server de VS Code en el puerto 5500. Usa
siempre `localhost` (no `127.0.0.1` ni `file://`): la clave de API de Desarrollo solo acepta
`localhost:8000` y `localhost:5500`, y el inicio de sesión necesita un dominio autorizado.

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
4. Abre un Pull Request hacia `main` y revisa "Files changed".
5. Si cambiaron las reglas, publícalas en `pdn` **antes** del merge.
6. Haz merge con **Create a merge commit**. Espera a que Actions termine en verde y
   verifica PDN (recarga con `Cmd + Shift + R`).
7. Etiqueta la versión (`git tag -a pdn-AAAA-MM-DD`) y borra la rama.

Si algo falla en PDN, se revierte el merge con el botón **Revert** del Pull Request (o
`git revert -m 1 <hash-del-merge>`). Nunca `git reset` ni `push --force` sobre `main`.

## Archivos nuevos

Si agregas un archivo que una página necesita (`.html`, `.js`, `.css` o `.svg`), agrégalo
también a la lista `cp` de `deploy.yml`; si no, el sitio publicado no lo encuentra y el
despliegue falla al comprobarlo. Las rutas `.js` y `.css` de cada HTML reciben solas la
versión contra la caché de Safari (`?v=<commit>`). Las páginas cargan los scripts como
scripts clásicos (no módulos ES), para que esa versión cubra todos los recursos.
