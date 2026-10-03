# Tablero Kanban

Tablero de tareas con tres columnas (Pendiente, En curso, Completada), etiquetas de
prioridad, fechas límite y sincronización entre dispositivos con Firebase (Firestore e
inicio de sesión anónimo). Es una página estática: `index.html`, `config.js`, `script.js`
y `style.css`, sin dependencias ni paso de compilación.

Publicado en <https://juanalvarezb.github.io/TableroKanba/>.

## Ambientes

| Ambiente   | Dónde se abre                                   | Proyecto de Firebase   | Claves en `localStorage`             |
|------------|-------------------------------------------------|------------------------|--------------------------------------|
| PDN        | `juanalvarezb.github.io` (GitHub Pages)         | `tablero-kanban-76c61` | `tareas`, `tareas-migradas`          |
| Desarrollo | Cualquier otra dirección: `localhost`, `127.0.0.1`… | `tablero-kanban-dev`   | `tareas-dev`, `tareas-migradas-dev`  |

`config.js` elige el ambiente según la dirección de la página. Solo el dominio de GitHub
Pages usa PDN; cualquier otra dirección usa Desarrollo, así que un error deja datos de
prueba en Desarrollo, nunca en PDN.

**¿En qué ambiente estoy?**

- En Desarrollo aparece el distintivo **DESARROLLO** junto al título y la pestaña dice
  "[DEV] Tablero Kanban".
- En la consola del navegador, `APP_ENV.name` responde `"dev"` o `"pdn"`.

## Correr en local

Desde la carpeta del proyecto:

```bash
python3 -m http.server 8000
```

Abre <http://localhost:8000>. También sirve Live Server de VS Code. Al abrir `index.html`
directamente (`file://`) también se usa Desarrollo, pero es mejor un servidor local.

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

Si agregas un archivo que la página necesita (un `.js` o `.css`), agrégalo también a
`deploy.yml`: allí se copia a GitHub Pages y se le pone la versión contra la caché de
Safari (`?v=<commit>`). Si no, el sitio publicado no lo encuentra.
