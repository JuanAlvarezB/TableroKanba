# LUCAS
Prueba
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

| Ambiente   | Para qué                                     | Dónde se abre                                                                        | Proyecto de Firebase   | Claves en `localStorage`                        |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------------------- |
| PDN        | Uso real                                     | `juanalvarezb.github.io` (GitHub Pages)                                              | `tablero-kanban-76c61` | `tareas-<uid>`, `tareas-migradas-<uid>`         |
| QA         | Probar lo que ya está en `main` antes de PDN | `tablero-kanban-qa.web.app` y `tablero-kanban-qa.firebaseapp.com` (Firebase Hosting) | `tablero-kanban-qa`    | `tareas-qa-<uid>`, `tareas-migradas-qa-<uid>`   |
| Desarrollo | Construir funciones nuevas                   | Cualquier otra dirección: `localhost`…                                               | `tablero-kanban-dev`   | `tareas-dev-<uid>`, `tareas-migradas-dev-<uid>` |

Los tres proyectos no comparten nada: ni datos, ni usuarios, ni reglas, ni claves de API. QA se
publica solo, con sus reglas, en cada merge a `main` (ver [Despliegue](#despliegue-y-variables-de-firebase)).

Las claves llevan el `uid` de la persona, para que nadie vea la copia local de otra en el
mismo navegador; al cerrar sesión se borran. Las claves sin `uid` (`tareas`, `tareas-dev`…)
son del tablero anónimo anterior y se borran al iniciar sesión.

`src/shared/config/firebase.config.js` elige el ambiente según la dirección de la página (no
según el modo de Vite), por igualdad exacta: solo el dominio de GitHub Pages usa PDN y solo los dos
dominios de Hosting de QA usan QA; cualquier otra dirección (subdominios, mayúsculas, `localhost`…)
usa Desarrollo, así que un error deja datos de prueba en Desarrollo, nunca en QA ni en PDN.

**¿En qué ambiente estoy?**

- En Desarrollo aparece el distintivo ámbar **DESARROLLO** en cada página y la pestaña empieza
  por "[DEV]".
- En QA aparece el distintivo violeta **QA** y la pestaña empieza por "[QA]".
- En PDN no hay distintivo ni prefijo.
- En la pestaña Red del navegador, las peticiones a Firebase llevan el `projectId` del ambiente
  (`tablero-kanban-dev`, `tablero-kanban-qa` o `tablero-kanban-76c61`).

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
cuentas no se comparten entre Desarrollo, QA y PDN). En QA solo se da de alta a quien prueba, y
nunca se copian allí datos ni cuentas de PDN.

1. En LUCAS, inicio → **Gestión de usuarios** (`usuarios.html`, solo para administradores) →
   **Autorizar correo**, con su nombre y su rol. La misma página desactiva, reactiva, da o quita el
   rol de administrador, enciende o apaga las funciones de un miembro (**Permisos…**) y elimina a una
   persona desactivada (tras el respaldo del script, ver «Script administrativo»), y cada cambio queda
   en el registro `adminLog`. Sin la página (o para el
   primer administrador), a mano: Firestore → colección `allowedUsers` → documento cuyo ID es el
   correo **en minúsculas**, con el campo `name` (texto) que LUCAS mostrará.
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
y `.firebaserc` definen los alias `dev`, `qa` y `pdn`). Se usa con `npx`, sin instalarla
globalmente:

```bash
npx firebase-tools login                                          # una sola vez
npx firebase-tools deploy --only firestore:rules --project dev    # solo Desarrollo
```

En QA y en PDN **no se publican a mano**: lo hace `deploy.yml` en cada merge a `main`, siempre antes del
sitio y comprobándolas con `verificar-reglas` (en PDN, después de tu aprobación). Desde tu terminal solo se
publican en Desarrollo.

- Publica siempre con `--only firestore:rules` y con `--project`. Nunca `firebase deploy` sin `--only`.
- Nunca `--only hosting` fuera de QA: `firebase.json` solo tiene el target de Hosting `qa`, asociado
  en `.firebaserc` únicamente a `tablero-kanban-qa`, así que en `dev` o `pdn` termina en error.
- No uses `firebase init`: puede sobrescribir `firestore.rules`.

Las reglas son la única barrera real de seguridad: lo publicado tiene que ser siempre el archivo.

### Publicar reglas paso a paso

En Desarrollo, desde tu terminal (en QA y PDN el pipeline hace los pasos 2 y 3 y crea la etiqueta del paso 5;
las menciones a PDN de esta sección sirven para una emergencia o para leer el historial):

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
5. En PDN, la etiqueta `pdn-reglas-<fecha>-<run>` la crea el pipeline (job `etiquetar`) sobre el commit
   publicado, con la versión anterior en el mensaje. Si ese job fallara, el resumen del run da los
   comandos `git tag` para crearla a mano.

### Volver a las reglas anteriores

- **Lo normal en QA y PDN:** **Revert** del Pull Request por el pipeline (ver "Cómo hacer un cambio",
  "Reversión por ambiente"); el piso de reglas impide que la reversión baje de lo que exigen los datos.
- **Urgente en PDN, desde la consola:** Firestore → Reglas → en el historial abre la versión anterior (la
  que nombra el resumen del run o el mensaje de la etiqueta `pdn-reglas-…`), **comprueba el piso** (los `grep`
  de abajo, en el texto de esa versión) y publícala. Después haz igual el Revert por el pipeline, para que el
  archivo y lo publicado vuelvan a coincidir.
- **Desde git** (Desarrollo, o para leer una versión anterior), con la etiqueta de una publicación:

  ```bash
  git show pdn-reglas-AAAA-MM-DD:firestore.rules > firestore.rules
  npx firebase-tools deploy --only firestore:rules --project dev
  npm run admin -- verificar-reglas --ambiente dev   # compara con el archivo restaurado
  git checkout -- firestore.rules                    # vuelve el archivo a la versión de la rama
  ```

Después de revertir, anota la hora en el Pull Request o en una incidencia. Si el código ya
publicado necesita las reglas nuevas, revierte también el merge (ver "Cómo hacer un cambio").

**Piso de reglas.** Como el pipeline publica `firestore.rules` en cada merge, revertir el merge de una
función revertiría también sus reglas. `scripts/admin/rules-floor.test.js` lo impide: `npm test` falla
(en el Pull Request y en el pipeline, antes de publicar nada) si al archivo le falta alguno de los
marcadores de abajo (`history`, subtareas, `taskIndex` estricto y permisos). Ningún PR de funcionalidad
toca esa prueba: el piso se sube en un PR aparte cuando la función ya está estable y con datos en PDN, y
solo se baja en un PR que lo explique y que limpie antes los datos con el script administrativo. Las
comprobaciones con `grep` de esta sección son la misma lista, para revisar una versión en la consola.

#### Historial de tareas: nunca revertir a reglas sin `history`

Desde el historial de tareas (`docs/PLAN_USUARIOS.md`, sección 4) los documentos de `tasks` pueden
tener el campo `history`. Unas reglas sin `'history'` en el `hasOnly` de `isValidTask` rechazan
**cualquier** edición de esas tareas, aunque no toque el historial (caso H-9 de
`rules-tests/history.rules.test.js`; alarma A-41). Por eso:

- **No vuelvas a una versión de las reglas anterior a la publicación del historial**, ni desde el
  historial de la consola ni con una etiqueta `pdn-reglas-…` anterior.
- Para deshacer un cambio de reglas posterior, parte de la versión anterior y, antes de publicar,
  comprueba que conserva `history` y su tope de 100:

  ```bash
  grep -q "'ownerId', 'history'" firestore.rules && grep -q "&& isHistory(data)" firestore.rules \
    && echo "Conserva history" || echo "NO conserva history: no la publiques"
  ```

  En la consola, busca lo mismo en el texto de la versión elegida antes de publicarla.

- **Para revertir el historial** se revierte solo el código, nunca las reglas:
  1. Revierte el merge del Pull Request (`git revert -m 1 <hash-del-merge>`). El código anterior no
     lee `history` y sus ediciones (`updateDoc`) solo cambian los campos que tocan, así que no lo
     borran.
  2. Las reglas se quedan como están, con `history` en `hasOnly`.
  3. Quitar el campo de todas las tareas solo tiene sentido si se abandona la función: se hará con un
     comando del script administrativo, primero en Desarrollo y con respaldo previo de PDN.

#### Subtareas: las reglas antes que el código, y nunca revertir a reglas sin `subtasks`

Desde las subtareas (`docs/PLAN_SUBTAREAS.md`, parte 2) los documentos de `tasks` pueden tener los campos
`subtasks` y `openSubtasks`, y las reglas exigen que una tarea completada no tenga subtareas pendientes.
Pasa lo mismo que con `history` (caso S-17 de `rules-tests/subtasks.rules.test.js`; alarma AT-5):

- **Al publicar**, las reglas con `subtasks` van **antes** que el código que
  los escribe: con las reglas anteriores, `hasOnly` rechazaría cualquier escritura de una tarea con
  subtareas.
- **No vuelvas a una versión de las reglas anterior a las subtareas**: rechazaría **cualquier** edición de
  las tareas que ya las tienen. Antes de publicar una versión anterior, comprueba que conserva los dos
  campos y `history`:

  ```bash
  grep -q "'history', 'subtasks', 'openSubtasks'" firestore.rules && grep -q "&& isSubtasks(data)" firestore.rules \
    && echo "Conserva las subtareas" || echo "NO conserva las subtareas: no la publiques"
  ```

- Si hiciera falta quitar la barrera "completada sin pendientes", se publica la versión actual **sin esa
  línea** de `isSubtasks`, conservando los dos campos en `hasOnly`.
- **Para revertir las subtareas** se revierte solo el código (`git revert -m 1 <hash-del-merge>`): el
  código anterior no lee los campos y sus ediciones (`updateDoc`) no los borran. Las reglas se quedan. Con
  la interfaz revertida, una tarea con subtareas pendientes no se puede completar hasta volver a
  publicarla (las reglas lo impiden): avisa a las personas antes de revertir.

#### Índice de tareas: primero el código, después las reglas

Desde la gestión de usuarios (`docs/PLAN_USUARIOS.md`, 2.6) crear o borrar una tarea escribe también
su documento de `taskIndex` en el mismo lote. Unas reglas sin `match /taskIndex/` rechazan el lote
**entero**: nadie podría crear ni borrar tareas. Por eso:

- Las reglas con `taskIndex` se publican **antes** que el código que lo
  escribe (orden estricto, ver más abajo).
- **Para revertir el índice**, primero se revierte el código (`git revert -m 1 <hash-del-merge>`) y se
  espera a que el sitio publicado ya no lo escriba; solo después, si hace falta, se vuelve a las reglas
  anteriores. Los documentos de `taskIndex` que queden no estorban a nadie.
- Antes de publicar una versión anterior de las reglas mientras el código del índice siga publicado,
  comprueba que la tiene:

  ```bash
  grep -q "match /taskIndex/" firestore.rules && echo "Tiene taskIndex" || echo "SIN taskIndex: no la publiques"
  ```

- **Con las reglas estrictas del índice** (PR 6, 2.6 paso 3), crear una tarea **exige** su índice en el
  mismo lote: un código sin índice ya no puede crear tareas. Para revertir el código del índice, primero
  vuelve a las reglas de transición (la versión del historial de la consola anterior a las estrictas, o
  `git show 73056c7:firestore.rules`), compruébalas con `verificar-reglas` y solo después revierte el código.
  Para deshacer solo las estrictas basta con volver a las de transición: el código actual funciona con las
  dos. **No uses la etiqueta `pdn-reglas-2026-10-28`**: apunta a un commit con las reglas anteriores, sin
  `taskIndex`. Para saber cuáles tiene un archivo antes de publicarlo:

  ```bash
  grep -q "hasOwnIndexAfter" firestore.rules && echo "Estrictas" \
    || { grep -q "match /taskIndex/" firestore.rules && echo "De transición" || echo "SIN taskIndex: no la publiques"; }
  ```

#### Permisos por función: el servidor los cumple solo con estas reglas

Desde los permisos por función (`docs/PLAN_USUARIOS.md`, sección 3) las reglas niegan `tasks` y `taskIndex` a
quien tiene el tablero apagado y no dejan cambiar `priority` ni `dueDate` con su función apagada. Mientras
ningún documento de `allowedUsers` tenga `permissions`, se comportan igual que las anteriores, así que
revertirlas es seguro. Después de apagar funciones a alguien, unas reglas sin permisos ya no las cumplen en el
servidor (la pantalla las seguiría ocultando): antes de publicar una versión anterior, comprueba cuál tienes:

```bash
grep -q "function boardOn" firestore.rules && echo "Con permisos" || echo "Sin permisos: el servidor no los cumple"
```

Los permisos se cambian en `usuarios.html` → **Acciones** → **Permisos…** (cada cambio deja una entrada
`set-permissions` en `adminLog`). Para devolver todas las funciones a una persona también basta con borrar su
campo `permissions` en la consola: vuelven los valores iniciales (todo activo).

### Comprobar con el script (`verificar-reglas`)

`npm run admin -- verificar-reglas --ambiente dev|qa|pdn` descarga, con la API de Firebase Rules, las
reglas vigentes del proyecto (el de ese alias en `.firebaserc`) y compara su huella SHA-256 con
`firestore.rules`. Solo lee: no cambia nada en Firebase. Termina con código 0 si coinciden, 1 si no
coinciden (muestra la primera línea distinta) y 2 si no pudo comprobarlo. Si solo cambian espacios al
final de línea, lo indica y cuenta como coincidencia.

Usa tus credenciales de Google, nunca archivos de llave; la preparación (una sola vez) está en
[Script administrativo](#script-administrativo-scriptsadmin).

### Pull Requests que cambian las reglas: orden

El pipeline publica las reglas **antes** que el sitio en QA y en PDN. Según el cambio:

- **"Reglas antes que el código"** (el código nuevo escribe algo que las reglas actuales rechazan, por
  ejemplo un campo nuevo en `hasOnly`): basta un Pull Request. Entre los dos pasos el sitio anterior convive
  con las reglas nuevas, así que las reglas nuevas tienen que aceptar también al código anterior.
- **"Código antes que las reglas"** (las reglas nuevas rechazan algo que el código actual todavía hace, como
  las reglas estrictas del índice): **dos Pull Requests**, el del código primero; el de las reglas solo
  después de comprobar en QA y en PDN lo que haga falta (con el script).
- En la descripción del Pull Request queda una sola casilla, la de Desarrollo:

  ```markdown
  - [ ] Reglas en Desarrollo: versión anterior HH:MM → nueva HH:MM · verificar-reglas ✔
  ```

Si dudas del orden, trátalo como "código antes que las reglas".

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

## Script administrativo (`scripts/admin/`)

Herramienta local del administrador responsable (`docs/PLAN_USUARIOS.md`, 2.11). Es la **única pieza que
usa el Admin SDK** de Firebase, que se salta las reglas, y la **única excepción** a "el administrador no ve
tareas": el respaldo lee el ambiente completo, por eso solo se guarda cifrado. Se ejecuta en tu equipo con
tus credenciales de Google; vive fuera de `src/`, no se empaqueta con el sitio ni se despliega. Cada
comando se prueba primero en Desarrollo.

### Preparación (una sola vez)

1. Node 22 o superior y `npm install` (instala `firebase-admin`, versión exacta, como dependencia de
   desarrollo).
2. Google Cloud CLI (gratis) y tus credenciales, con la cuenta de Google que tiene un rol en el proyecto de
   Firebase (Configuración del proyecto → Usuarios y permisos):

   ```bash
   brew install --cask gcloud-cli
   gcloud auth application-default login
   gcloud auth application-default set-quota-project <proyecto>   # tablero-kanban-dev o el de PDN
   ```

   El proyecto de cuota lo exigen las operaciones de Authentication con credenciales de usuario.

3. **Sin llaves:** no descargues archivos de cuenta de servicio. Si existe la variable
   `GOOGLE_APPLICATION_CREDENTIALS`, el script se niega a correr.
4. macOS puede pedir permiso para que la Terminal use la carpeta Documentos (ahí van los respaldos).

### Cómo se usa

```bash
npm run admin -- <comando> --ambiente dev|qa|pdn --admin <tu correo de LUCAS> [opciones] [--aplicar]
npm run admin    # sin argumentos: la ayuda con cada comando y sus opciones
```

- **`--admin`** es tu correo de LUCAS en ese ambiente. El script comprueba que eres administrador activo
  con `uid` registrado y firma con ese `uid` sus entradas de `adminLog` (2.7).
- **Simulación por defecto.** Sin `--aplicar`, los comandos que escriben solo informan qué harían. Con
  `--aplicar` en QA o en PDN, además, hay que teclear el identificador del proyecto (`tablero-kanban-qa`
  o `tablero-kanban-76c61`); en Desarrollo, no.
- **Nunca imprime contenido de tareas:** solo cantidades e identificadores. Los correos de otras personas
  salen enmascarados (`pe***@e***.com`).
- **Cada ejecución que escribe deja su entrada** en `adminLog` (`backup`, `backfill-index`,
  `purge-leftovers`, `purge-log`, `clean-auth`, `restore`), con `uid` y nunca correos. Si falla a mitad,
  deja otra con `completed: false`. La app no puede editar ni borrar el registro; el script y la consola
  sí (el Admin SDK se salta las reglas, alarma A-20).
- La frase de cifrado y la confirmación de QA y PDN se teclean en la terminal: no se aceptan por argumento ni
  por tubería.
- Termina con código 0 si todo está bien, 1 si encontró diferencias o se negó por una condición de
  seguridad (no escribe nada más) y 2 si hubo un error de uso o de conexión.

| Comando                                                      | Qué hace                                                                                                                                                                                                                                                                                           | Escribe                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `verificar-reglas`                                           | Compara las reglas publicadas con `firestore.rules` (ver arriba)                                                                                                                                                                                                                                   | No                        |
| `respaldar` (sin `--correo`)                                 | Respaldo completo cifrado y verificado del ambiente, sin tocar índices ni crear marcadores. Se hace antes de publicar reglas en PDN (`docs/PLAN_USUARIOS.md`, 2.16)                                                                                                                                | Solo `adminLog`           |
| `respaldar --correo <correo>`                                | Prepara la eliminación de una persona **desactivada** que no es administradora: resuelve su `uid` (en Authentication si su documento no lo tiene), completa su índice, hace el respaldo completo cifrado, lo verifica y crea su marcador en `deletions` en estado `backup-ready` (válido 24 horas) | Sí                        |
| `verificar-indice [--uid <uid>]`                             | Tareas sin índice e índices huérfanos del ambiente (o de un `uid`); termina con 1 si no está completo                                                                                                                                                                                              | No                        |
| `completar-indice [--uid <uid>]`                             | Crea los índices que faltan, corrige el dueño y borra los huérfanos                                                                                                                                                                                                                                | Sí                        |
| `limpiar-usuario --uid <uid>`                                | Borra las tareas e índices que queden de una persona eliminada o con la eliminación confirmada. Se niega si alguien autorizado tiene ese `uid`                                                                                                                                                     | Sí                        |
| `cuentas-huerfanas`                                          | Lista las cuentas de Authentication sin documento en `allowedUsers`; con `--aplicar` borra las que confirmes una por una escribiendo `borrar`                                                                                                                                                      | Sí                        |
| `purgar-registro`                                            | Borra las entradas de `adminLog` de más de 12 meses                                                                                                                                                                                                                                                | Sí                        |
| `limpiar-respaldos`                                          | Borra de tu equipo los respaldos del ambiente de más de 30 días (no se conecta a Firebase ni usa `--admin`)                                                                                                                                                                                        | Sí, solo archivos locales |
| `restaurar --correo <correo> --archivo <ruta> [--uid <uid>]` | Vuelve a crear a una persona eliminada desde un respaldo (ver más abajo)                                                                                                                                                                                                                           | Sí                        |

Los plazos de 12 meses y 30 días son propuestas pendientes de la revisión legal (PBI-2.13); se cambian en
`scripts/admin/retention.js`.

### El respaldo cifrado

- **Dónde:** `~/Documents/lucas-respaldos/<ambiente>/respaldo-<ambiente>-AAAA-MM-DDTHH-MM-SSZ.cifrado`
  (hora UTC), fuera del repositorio; la carpeta con permisos `0700` y el archivo con `0600`. El nombre no
  lleva el correo de nadie. Nunca lo copies dentro del repositorio (`.gitignore` lo ignora por si acaso).
- **Qué contiene:** todas las colecciones del ambiente, con el historial de cada tarea (alarmas A-18 y
  A-47): son datos de todas las personas, no solo de quien se va a eliminar.
- **Cómo se cifra:** AES-256-GCM con una clave derivada con scrypt de una frase de al menos 12
  caracteres, con sal e IV aleatorios en cada archivo; la cabecera va autenticada.
- **La frase:** genérala en el gestor de contraseñas, guárdala solo allí y tecléala (dos veces) cuando el
  script la pida. **Si se pierde, el respaldo no se puede leer.**
- **Verificación:** antes de crear el marcador, el script descifra el archivo escrito y comprueba que la
  huella SHA-256 y el número de documentos coinciden con lo leído de Firestore. La huella queda en el
  marcador (`backupHash`) y en la salida.
- **Conservación:** 30 días (`limpiar-respaldos`). Las copias que salgan de esa carpeta (Time Machine,
  iCloud si sincroniza Documentos, discos externos) no las borra el script: siguen cifradas, pero conservan
  los datos más tiempo; bórralas a mano (A-21).
- **Coste:** el respaldo lee el ambiente completo (una lectura por documento del plan gratuito). Elimina
  de una persona a la vez y fuera de horas de uso (A-24).

### Restaurar a una persona eliminada (PBI-2.12)

`restaurar` vuelve a crear, desde un respaldo, el documento de `allowedUsers` de una persona (desactivado
y sin la marca de eliminación), sus tareas con su historial y sus índices, con la entrada `restore`. No toca
nada más del ambiente. Se niega si el correo ya está autorizado, si queda un marcador de eliminación, si
otra persona tiene ese `uid` o si alguna tarea del respaldo existe con otro dueño. Si falla a mitad, se
repite el mismo comando (el documento se escribe al final, así que la persona no entra con tareas a medias).

Procedimiento, **siempre primero en Desarrollo**:

1. Elige el respaldo hecho antes de la eliminación (su nombre lleva la fecha y la hora UTC).
2. Si la cuenta de Authentication de la persona ya se borró, tiene que volver a existir (crearla o que la
   persona entre una vez con Google) y su `uid` será otro: cópialo de Authentication → Users y pásalo con
   `--uid`. Si la cuenta sigue existiendo, no hace falta.
3. Simula y revisa el número de tareas:

   ```bash
   npm run admin -- restaurar --ambiente dev --admin <tu correo> --correo <su correo> \
     --archivo ~/Documents/lucas-respaldos/dev/<archivo>.cifrado
   ```

4. Repite con `--aplicar` (en PDN, teclea el identificador del proyecto).
5. En la página **Usuarios**, la persona aparece **Inactiva**: **Reactivar** (deja la entrada
   `reactivate`).
6. `npm run admin -- verificar-indice --ambiente dev --admin <tu correo> --uid <su uid>` termina en
   "✔ Índice completo".
7. La persona entra y ve sus tareas con su historial. Anota la restauración en el registro privado.

No se restauran las entradas de `adminLog` (son evidencia, no estado) ni la copia local de su navegador.

### Authentication con tus credenciales (alarma A-19)

`respaldar` (para quien no tiene `uid` registrado), `limpiar-usuario` y `cuentas-huerfanas` consultan
Authentication con tus credenciales de Google. Si no alcanzan: `respaldar` se niega con quien no tiene
`uid` (hay que reactivarla, pedirle que entre una vez y desactivarla de nuevo), `limpiar-usuario` se niega
mientras haya personas autorizadas sin `uid` y la limpieza de cuentas huérfanas se hace a mano en la
consola. El resultado de la prueba en Desarrollo se anota en `docs/PLAN_USUARIOS.md` (A-19).

## Cómo hacer un cambio

`main` se publica sola en **QA** en cada merge y llega a **PDN** cuando apruebas el environment `pdn` en
GitHub (`.github/workflows/deploy.yml`; ver [Despliegue](#despliegue-y-variables-de-firebase)). `main` está
protegida: todo entra por Pull Request.

1. `git checkout main && git pull` y crea una rama con un prefijo permitido: `feature/…`, `fix/…`,
   `docs/…`, `chore/…`, `ambientes-…` o `<número de PBI>-…` (el job `rama` lo comprueba).
2. Desarrolla y prueba en local, contra **Desarrollo**, con commits pequeños.
3. Si cambian las reglas, publícalas **en Desarrollo** desde tu terminal y compruébalas
   (`npx firebase-tools deploy --only firestore:rules --project dev` y
   `npm run admin -- verificar-reglas --ambiente dev`). QA y PDN las publica el pipeline.
4. Abre el Pull Request hacia `main`. Tienen que terminar en verde `rama`, `revisar` y `reglas`, y todas
   las conversaciones resueltas. Copia la lista de `docs/VERIFICACION_MANUAL.md` que aplique.
5. Merge con **Create a merge commit**. En Actions, **Desplegar** publica en QA: reglas, verificación,
   sitio y smoke.
6. Prueba en `https://tablero-kanban-qa.web.app/` (recarga con `Cmd + Shift + R`).
7. En el run, **Review deployments** → `pdn` → **Approve and deploy**. El pipeline publica las reglas de
   PDN, las verifica, publica el sitio, lo comprueba y crea las etiquetas. Si no está bien, **Reject**:
   PDN no cambia.
8. Borra la rama.

Si llega otro merge antes de aprobar, rechaza el run viejo y aprueba el nuevo: solo el último commit de
`main` puede llegar a PDN (aprobar uno viejo termina en rojo sin tocar nada). Una aprobación vale 7 días;
después, **Re-run all jobs** si sigue siendo el último commit.

### Reversión por ambiente

| Qué falló                        | Ambiente   | Cómo se revierte                                                                                                                                                                        |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cualquier cosa, antes de aprobar | QA         | **Revert** del Pull Request fusionado (o `git revert -m 1 <merge>`) en un Pull Request como cualquier otro; rechaza el run pendiente del cambio malo. PDN nunca tuvo el cambio          |
| El sitio, ya en PDN              | QA y PDN   | **Revert** → merge → QA → apruebas → PDN. No se vuelve a ejecutar un despliegue anterior: un run viejo se niega, y publicaría también sus reglas, que pueden ser anteriores a los datos |
| Las reglas, urgente              | PDN        | Consola de PDN → Firestore → Reglas → historial, **comprobando antes el piso** ("Volver a las reglas anteriores"); después, el Revert por el pipeline                                   |
| Las reglas                       | QA         | El Revert por el pipeline (o la consola de QA, como en PDN)                                                                                                                             |
| Cualquier cosa                   | Desarrollo | Desde tu terminal                                                                                                                                                                       |

**Reglas mínimas.** Una reversión nunca puede publicar reglas por debajo de lo que exigen los datos que ya
existen (`history`, subtareas, índice estricto, permisos): `scripts/admin/rules-floor.test.js` hace fallar
`npm test` antes de publicar nada (ver "Piso de reglas" en "Volver a las reglas anteriores").

Nunca `git reset` ni `push --force` sobre `main` (el ruleset "Proteger main" lo impide), y las etiquetas
`pdn-*` no se mueven ni se borran (ruleset "Etiquetas de PDN").

## Archivos nuevos

- **`.js` y `.css`**: van en `src/` y se importan desde el módulo de su página (o se enlazan
  desde el HTML). Vite los incluye en el build y les pone un hash en el nombre, así Safari
  nunca usa una versión anterior de su caché.
- **Imágenes y otros archivos que se publican tal cual**: van en `public/assets/` y se
  enlazan como `/assets/<archivo>`.
- **Una página `.html` nueva**: agrégala también a `build.rolldownOptions.input` de
  `vite.config.js`, a la comprobación de `deploy.yml` y a la lista de páginas de
  `scripts/ci/smoke.sh`.

## Despliegue y variables de Firebase

`deploy.yml` corre en cada push a `main` (`docs/PLAN_AMBIENTES.md`, bloque D):

| Job         | Qué hace                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guardas`   | Se niega si el run no es de `main` o si `main` ya avanzó (entonces publica el run del commit más nuevo)                                                                                                                                                                                                                                     |
| `test`      | `npm test`, incluido el piso de reglas                                                                                                                                                                                                                                                                                                      |
| `build`     | **Un solo build** con las tres configuraciones; comprueba las páginas, los tres `projectId` y que no haya nada del emulador; guarda las huellas SHA-256 y sube el mismo `dist/` para QA y para Pages (7 días)                                                                                                                               |
| `qa`        | Environment `qa`. Comprueba alias, proyecto, cuenta y dirección; entra en Google con Workload Identity (sin claves); publica las reglas en QA, las verifica con `verificar-reglas`, publica Hosting de QA y corre el smoke (`scripts/ci/smoke.sh`: las cuatro páginas, la huella de cada archivo servido, el `projectId` de QA y `noindex`) |
| `pdn`       | Environment `pdn`: **espera tu aprobación**. Se niega si `main` avanzó o si el sitio del run venció (7 días); comprueba alias, proyecto, cuenta y dirección; entra con Workload Identity; anota la versión vigente de las reglas, publica `firestore.rules` en PDN y la verifica                                                            |
| `pages`     | Solo después de `pdn`: publica en GitHub Pages el mismo build que pasó por QA                                                                                                                                                                                                                                                               |
| `smoke-pdn` | Espera (hasta 10 minutos) a que GitHub Pages sirva ese build y comprueba la huella de cada archivo y el `projectId` de PDN                                                                                                                                                                                                                  |
| `etiquetar` | Crea `pdn-<fecha>-<run>` y, si las reglas cambiaron, `pdn-reglas-<fecha>-<run>` con la versión anterior en el mensaje                                                                                                                                                                                                                       |

- Nada llega a PDN sin pasar por QA en el mismo run y sin tu aprobación. Un fallo en QA, un rechazo o una
  aprobación que vence dejan PDN como estaba. Ningún run se cancela a mitad de una publicación: si llegan
  varios merges, cada job deja el suyo en espera.
- Las credenciales de cada ambiente solo se obtienen desde `main` y desde su environment: la condición del
  proveedor de Workload Identity exige este repositorio, `environment:qa` (o `pdn`) y `refs/heads/main`, y
  los environments solo admiten `main`. Lanzar **Desplegar** a mano desde otra rama termina en `guardas`.
  La cuenta de PDN solo tiene roles de reglas (PDN está en GitHub Pages, sin Hosting).
- Los environments `qa` y `pdn` (Settings → Environments) tienen cuatro variables, ninguna secreta:
  `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID` y `SITE_URL`. `pdn` tiene revisor
  obligatorio y no admite saltarse la aprobación. No hay secretos ni claves JSON en el repositorio ni en los
  environments.

La configuración de Firebase del build sale de las **variables del repositorio** en GitHub (Settings →
Secrets and variables → Actions → Variables), con los mismos nombres que `.env.example`.
Para cargarlas desde tu `.env.local`:

```bash
gh variable set -f .env.local
```

Si falta alguna, `vite build` se detiene y no se despliega nada.
