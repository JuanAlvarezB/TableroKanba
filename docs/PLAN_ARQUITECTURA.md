# Plan de reestructuración de LUCAS: arquitectura limpia

Estado: **terminado y publicado en PDN** el 4 de octubre de 2026 (PR #5, merge `9607362`, etiqueta `pdn-arquitectura`).
Fecha: 4 de octubre de 2026.

Fuentes de contexto:
1. El grafo de código de `graphify-out/` (commit `55ccb3c`: 158 nodos, 303 relaciones, 13 comunidades).
2. La estructura objetivo descrita en `arquitecturaLimpia.md`.

---

## 1. Diagnóstico actual

- **Todo el tablero vive en un solo archivo.** `script.js` tiene 1327 líneas y mezcla las reglas de negocio (vencimientos, prioridades, límites WIP), el acceso a datos (Firestore y localStorage) y la interfaz.
- **`render()` concentra demasiado.** Es el nodo con más conexiones del grafo (25) y une 5 comunidades. `connectRemote()` y `createCard()` lo siguen con 12 cada uno.
- **La capa de datos llama directamente a la interfaz.** Por ejemplo, `addTask()` llama a `render()` y a `announceNewTasks()`.
- **No hay empaquetador.** Los archivos se cargan como scripts clásicos que comparten variables globales (`APP_ENV`, `LUCAS_AUTH`, `LUCAS_CUENTA`) y dependen del orden de las etiquetas `<script>`. Firebase se descarga del CDN con `import()`.
- **El deploy fuerza la renovación de caché a mano.** `deploy.yml` copia archivo por archivo y añade `?v=commit` con `sed`.
- **Los estilos están dispersos.** Hay 4 CSS (`style.css` solo tiene 1362 líneas) y no hay variables compartidas.
- **No hay pruebas, linter ni formateador.**
- **Hay mucha documentación en la raíz**: más de 10 archivos `.md` y `.txt` de propuestas y planes.
- **El grafo recomienda dividir** `script.js` y `login.js` por su baja cohesión (0.06 y 0.08).

## 2. Cuidados durante toda la migración

1. **No cambiar las claves de localStorage** (`tareas`, `tareas-dev`, etc.) ni el formato de los documentos de Firestore, para que PDN conserve sus datos.
2. **Mantener la regla de que solo `juanalvarezb.github.io` usa PDN.** Un error de configuración nunca debe escribir datos de prueba en PDN.
3. **Cada fase va en su propio PR a `main`**, se despliega y se verifica antes de empezar la siguiente.
4. **El comportamiento visible no cambia** hasta terminar la fase 5: primero se reestructura y después se añaden funciones.

---

## 3. Fases

### Fase 0: Preparación (sin tocar código de la app)

- [x] Crear `docs/` y mover ahí `PLAN_LOGIN.md`, `PROPUESTAS_*`, `GUIA_AMBIENTES.md`, `DESIGN.md`, `PENDIENTES.txt` y `notificaciones.txt`. Los documentos privados que ya están en `.gitignore` siguen ignorados.
- [x] Escribir una **lista de verificación manual** con los flujos críticos: login con correo y con Google, recuperar contraseña, crear, editar, mover, priorizar y borrar tareas, vencimientos, recordatorios, cerrar sesión y cambiar contraseña. Se repasa al cerrar cada fase.
- [x] Etiquetar el estado actual (por ejemplo `pre-arquitectura`) para poder volver atrás fácilmente.

### Fase 1: Vite sin cambiar la lógica

Esta fase solo cambia cómo se construye y se publica, no cómo funciona la app.

- [x] Añadir `package.json` con `vite` y `firebase` instalado por npm, en lugar del CDN.
- [x] Crear `vite.config.js` en modo **multipágina**, con entradas `index.html`, `login.html` y `tablero.html`, y `base: '/TableroKanba/'`.
- [x] Convertir los scripts clásicos en **módulos ES** (`import`/`export`) sin reescribirlos. `APP_ENV`, `LUCAS_AUTH` y `LUCAS_CUENTA` pasan a ser exportaciones.
- [x] Mover `husky.svg` y los demás recursos a `public/assets/`.
- [x] Crear `.env.example` y `.env.local` con `VITE_FIREBASE_*` por ambiente.
  - La configuración de Firebase es pública por diseño, así que aquí `.env` sirve para ordenar, no para proteger secretos.
  - La protección contra un error de configuración no debe depender solo de `import.meta.env.MODE`: `firebase.config.js` debe seguir comprobando el hostname.
- [x] Reescribir `deploy.yml` con `npm ci`, `npm run build` y publicar `dist/`. Vite añade un hash a los nombres de archivo, así que **sobran el `sed` y las comprobaciones de `?v=`**.
- [x] Verificar en Desarrollo (`npm run dev`).
- [ ] Crear las variables `VITE_FIREBASE_*` en GitHub (`gh variable set -f .env.local`) y verificar en PDN con `docs/VERIFICACION_MANUAL.md`.

### Fase 2: Herramientas de calidad

- [x] **ESLint y Prettier**, con scripts `npm run lint` y `npm run format`.
- [x] **Vitest** para las pruebas unitarias.
- [x] Un workflow nuevo `ci.yml` que, en cada PR, ejecute lint, pruebas y build.
- [ ] Opcional: activar `// @ts-check` con JSDoc para tener tipos sin pasar a TypeScript.

### Fase 3: Extraer el dominio (lo de menos riesgo y más valor)

Las funciones puras de `script.js` pasan a `src/domain/` y se cubren con pruebas **antes** de seguir.

```
src/domain/
├── entities/
│   ├── Task.js          # estados, prioridades, fechas por estado, historial
│   └── Session.js       # uid, email, autorizado
├── rules/               # reglas puras (carpeta adicional propuesta)
│   ├── dueDates.js      # dueInfo, businessDaysUntil, overdueDays, calendarDaysSince
│   ├── priority.js      # PRIORITIES, priorityRank, sortByPriority
│   ├── board.js         # STATUSES, WIP_LIMITS, isColumnFull, countByStatus, nextOrder
│   └── reminders.js     # REMINDER_SLOTS, currentReminderSlot, attentionGroups
├── repositories/        # CONTRATOS (JSDoc): TaskRepository, AuthRepository
└── usecases/
    ├── AddTask.js, UpdateTask.js, MoveTask.js, DeleteTask.js
    ├── SetPriority.js, SetDueDate.js, ClearCompleted.js
    ├── GetOverdueSummary.js, CheckReminder.js
    └── MigrateLocalTasks.js
```

- [x] Extraer las reglas puras a `domain/rules/` con sus pruebas (`dates`, `dueDates`, `stalledTasks`, `priority`, `board`, `reminders`).
- [x] Crear la entidad `Task` (forma, estados, lectura desde localStorage y Firestore, fechas por estado).
- [x] Definir el contrato `TaskRepository` en `domain/repositories/`.
  - Esta carpeta no aparece en `arquitecturaLimpia.md` y se propone añadirla. Ahí van los contratos; `data/` los implementa. Así el dominio no depende de Firebase.
- [x] Crear los casos de uso `AddTask`, `MoveTask`, `SetPriority`, `SetDueDate` y `DeleteTasks` (borrar una y limpiar completadas).
- [x] Conectar `script.js` al dominio y comprobar que el resultado es idéntico al original (183 casos comparados, 0 diferencias).

Cambios respecto al diseño inicial:
- Las reglas y los casos de uso reciben `now` como parámetro, para probarlos con fechas fijas.
- Los textos (emojis, nombres de columnas y prioridades, fechas formateadas) se quedan en la interfaz; el dominio devuelve datos (`dueStatus` → `{ kind, days, due }`, `attentionIds` → ids por grupo).
- Por ahora los casos de uso son funciones puras que devuelven **qué cambia**; `script.js` guarda y dibuja. En la fase 4 recibirán el repositorio.
- Pasan a la fase 4, porque dependen del almacenamiento o de la sesión: la entidad `Session`, el contrato `AuthRepository`, `CheckReminder` y `MigrateLocalTasks`. `GetOverdueSummary` quedó como la regla `attentionIds`.

### Fase 4: Capa de datos

```
src/data/
├── datasources/
│   ├── firebase.init.js        # initializeApp + getAuth + getFirestore (una sola vez)
│   └── localStorage.js         # readStorage/writeStorage seguros (hoy en auth.js)
└── repositories/
    ├── FirestoreTaskRepository.js   # setDoc/updateDoc/batch/onSnapshot (hoy script.js:714-800)
    ├── LocalTaskCache.js            # copia local y modo sin conexión
    ├── FirebaseAuthRepository.js    # login, Google, reset, verify, signOut
    └── AllowedUsersRepository.js    # colección allowedUsers
```

- [x] Fuentes de datos: `firebase.init.js` (carga Firebase una vez) y `browserStorage.js` (localStorage y sessionStorage sin lanzar errores).
- [x] Repositorios: `FirestoreTaskRepository`, `LocalTaskCache`, `ReminderStore`, `FirebaseAuthRepository` y `AllowedUsersRepository`. Fuera de `src/data/` nadie usa ya el SDK de Firebase ni el almacenamiento del navegador.
- [x] Entidad `Session` y contratos `AuthRepository` y `AllowedUsersRepository`.
- [x] Casos de uso `MigrateLocalTasks` (recibe la copia local y el repositorio) y `CheckReminder`.
- [x] `handleSyncError` recibe un `RepositoryError` (`permission-denied`, `not-found`, `unavailable`) y decide el mensaje.
- [x] `ERROR_MESSAGES` pasa a `shared/constants/messages.js`.
- [x] Pruebas de los repositorios con un Firestore y un localStorage falsos (72 pruebas en total).

Cambios respecto al diseño inicial:
- Los casos de uso de la fase 3 siguen siendo puros (deciden qué cambia). La orquestación decidir → guardar → dibujar va al store de la fase 5; meterla ahora en los casos de uso habría que rehacerla allí. Solo `MigrateLocalTasks` recibe repositorios, porque coordinar la copia local con Firestore es justo su trabajo.
- Los errores de autenticación conservan su código de Firebase (`auth/…`): es el vocabulario que `messages.js` traduce y que la interfaz usa para decidir qué campo resaltar.
- Mientras no existan los puntos de entrada de la fase 5, la sesión lleva la conexión con Firebase (`session.firebase`) para que cada página cree sus repositorios.

### Fase 5: Presentación y estado

- [x] **Un estado central**: `presentation/state/boardStore.js`, sin DOM, con eventos (`change`, `notice`, `highlight`, `added`, `edited`, `sync`). Coordina los casos de uso, la copia local y Firestore; la vista se suscribe y vuelve a dibujar. `addTask` ya no llama a `render()`.
- [x] **Componentes**: `TaskCard`, `TaskEditor`, `LabelMenu`, `TaskTags`, `TaskHistory`, `OverdueAlerts` (contadores, resumen y aviso de recordatorio), `FlashMessage` y `AccountMenu` (antes `cuenta.js`).
- [x] **Páginas**: `pages/board` (`BoardPage.js` + `main.js`), `pages/home/main.js` y `pages/login/main.js`.
- [x] **Un punto de entrada por página** (`src/presentation/pages/*/main.js`), que conecta repositorios, store y vista.
- [x] **Guardias de sesión**: `presentation/guards/session.js` (antes `auth.js`), con exportaciones en lugar del objeto global `LUCAS_AUTH`.
- [x] Caso de uso `AuthorizeUser` y repositorio `SessionStore` (claves por persona y última autorización confirmada).
- [x] Pruebas del store, de la autorización y de los textos de vencimiento (98 pruebas en total).

Cambios respecto al diseño inicial:
- El código de la interfaz se movió a componentes **sin reescribir su lógica** (foco, edición que sobrevive a los redibujados, resaltados, arrastre por grupos), para no introducir regresiones. Los componentes reciben el estado de la vista como parámetros.
- El login no tiene `LoginPage.js` aparte: no compone ningún store, así que su `main.js` es la página.
- Los textos de la interfaz (prioridades, columnas, fechas en español) están en `presentation/format/`.

### Fase 6: Estilos

- [x] Los 21 tokens de `DESIGN.md` que login e inicio repetían pasan a `styles/variables.css` (una sola vez). Cada página conserva solo sus tokens propios.
- [x] `style.css` (1.362 líneas) se reparte en `styles/board/` por secciones (variables, base, barra, formulario, avisos, filtros, columnas, tarjetas, etiquetas, editor, pie, decoración, responsive), unidas por `styles/board.css` con `@import` en el mismo orden.
- [x] Verificado compilando antes y después: el CSS del tablero sale **idéntico byte a byte**; en login e inicio las reglas no cambian y los tokens tienen exactamente los mismos valores.

No hecho, a propósito (cambiaría el aspecto, no solo la organización):
- [ ] `reset.css` y `base.css` comunes: el tablero, el login y el inicio tienen bases distintas (el inicio va acotado a `.lucas-home` para no afectar al tablero). Unificarlas mueve reglas en la cascada.
- [ ] Unificar el tablero con el sistema de `DESIGN.md`: hoy el tablero conserva su estilo original (azul, `system-ui`). Es un rediseño, no una reestructuración; conviene decidirlo como una funcionalidad aparte (ya hay propuestas en `docs/PROPUESTAS_REDISENO_LUCAS.md`).
- [ ] Llevar cada sección de CSS junto a su componente (`components/TaskCard.css`…): con Vite, el orden de la cascada pasaría a depender del orden de los `import` de JavaScript.

### Fase 7: Cierre

- [x] Borrar los archivos antiguos de la raíz: ya no queda ningún `.js` ni `.css` suelto; `reglas_antiguas.txt` se borró (reglas obsoletas e inseguras, sustituidas por `firestore.rules`; sigue en el historial de git).
- [x] `README.md` actualizado: estructura por capas, `npm run dev/build/test/lint/format`, ambientes y variables de Firebase.
- [x] Regla de dependencias automatizada: `src/architecture.test.js` falla si una capa importa de otra no permitida (también en tipos JSDoc) o si el dominio usa el navegador. Al crearla encontró y se corrigieron dos referencias de tipos que cruzaban capas.
- [x] `graphify update .`: ninguna dependencia va en sentido contrario. `render()` bajó de 25 a 19 conexiones, pero `createBoardPage()` concentra 40 porque agrupa todas las funciones de la vista del tablero (ver pendientes).

---

## 4. Estructura final propuesta

```
ListaTareasIA/
├── .github/workflows/ (deploy.yml, ci.yml)
├── docs/                      # planes, propuestas, diseño
├── firestore.rules, firebase.json
├── .env.example, vite.config.js, package.json
├── index.html, login.html, tablero.html
├── public/assets/
└── src/
    ├── domain/        (entities, rules, repositories, usecases)
    ├── data/          (datasources, repositories)
    ├── presentation/  (components, pages, state, guards)
    ├── shared/        (utils, constants, config)
    └── styles/        (variables.css, reset.css, base.css)
```

## 5. Orden y esfuerzo aproximado

| Fase | Riesgo | Esfuerzo |
|---|---|---|
| 0 Preparación | Nulo | Bajo |
| 1 Vite y deploy | **Alto** (toca PDN) | Medio |
| 2 Calidad | Nulo | Bajo |
| 3 Dominio y pruebas | Bajo | Medio |
| 4 Datos | Medio | Medio |
| 5 Presentación | Medio-alto | Alto |
| 6 Estilos | Bajo-medio | Medio |
| 7 Cierre | Bajo | Bajo |

## 6. Ideas adicionales

- **Pruebas de `firestore.rules`** con el emulador de Firebase (`@firebase/rules-unit-testing`). Las reglas son la única barrera de seguridad real.
- **Las funciones pendientes de `PENDIENTES.txt` encajan en la nueva estructura** y conviene implementarlas después de la fase 5:
  - el cierre por inactividad sería un caso de uso `TrackInactivity` más un componente `InactivityDialog`;
  - los roles irían en una entidad `User` con `role` y un caso de uso `ManageUsers`.
- **Registrar quién creó o movió cada tarea**: el historial actual (`createHistory`) puede ampliarse en el dominio con `actorId`.
- **Opcional, para más adelante: PWA** con service worker, que da modo sin conexión real y la opción de instalar la app.

## 7. Decisiones pendientes antes de ejecutar

- [x] ¿Se adopta **Vite y npm**? Sí.
- [x] ¿**JavaScript con JSDoc** o pasar a **TypeScript**? JavaScript con JSDoc.

## 8. Balance de la reestructuración

Rama `feature/newLogin` (commits `78ef3a2` a `927cf65`), fusionada en `main` con el PR #5 (`9607362`)
y etiquetada como `pdn-arquitectura`. Las tareas que siguen abiertas están
también en `docs/PENDIENTES.txt` (documento interno, no está en el repositorio), sección 7
"ARQUITECTURA LIMPIA"; allí se marcó además lo que esta reestructuración resolvió de la
sección 5 "RUTA CRÍTICA DE PRUEBAS (CI/CD)".

### 8.1 Lo que se cumplió

| Fase | Resultado | Cómo se verificó |
|---|---|---|
| 0 Preparación | Documentos en `docs/`, lista de verificación manual, etiqueta `pre-arquitectura` | — |
| 1 Vite | Módulos ES, Firebase por npm (12.19.0), variables `VITE_FIREBASE_*`, deploy con `npm run build` | Login, inicio y tablero probados en Desarrollo |
| 2 Calidad | ESLint, Prettier, Vitest y `ci.yml` en cada PR | `npm run lint`, `format:check`, `test`, `build` |
| 3 Dominio | Entidad `Task`, reglas y casos de uso puros en `src/domain/` | 183 casos comparados con la lógica anterior, 0 diferencias |
| 4 Datos | Repositorios para Firestore, Auth y localStorage en `src/data/` | Pruebas con Firestore y localStorage falsos |
| 5 Presentación | Un punto de entrada por página, store sin DOM, componentes, guardia de sesión | Prueba manual completa del tablero, login y cuenta |
| 6 Estilos | Tokens de `DESIGN.md` compartidos; `style.css` dividido por secciones | CSS compilado idéntico (tablero) y mismos valores (login, inicio) |
| 7 Cierre | `reglas_antiguas.txt` borrado, README al día, regla de capas automatizada | `src/architecture.test.js` |

Pruebas automáticas: de 0 a **146** (dominio, datos, store, autorización, textos y arquitectura).

### 8.2 Lo que se mejoró respecto al plan inicial

- **Regla de dependencias automatizada** (`src/architecture.test.js`): no estaba en el plan. Falla si una capa importa de otra no permitida, también en tipos JSDoc, o si el dominio usa el navegador. Al crearla encontró dos referencias de tipos que cruzaban capas.
- **Casos de uso que reciben `now`**: vencimientos, tareas detenidas y recordatorios se prueban con fechas fijas (uno de los requisitos de la sección 5 de `PENDIENTES.txt`).
- **El build se detiene si falta una variable de Firebase**, y `deploy.yml` comprueba que el bundle lleve el proyecto de PDN antes de publicar.
- **Caché de Safari resuelta por Vite** (nombres con hash): sobran el `sed` y las comprobaciones de `?v=`.
- **`npm run dev` en el puerto 8000**, para no chocar con Live Server (puerto 5500).
- **Autorización como caso de uso** (`AuthorizeUser`) y **store del tablero sin DOM**: ambos se prueban en Node, sin navegador.
- **Dos detalles corregidos** por el camino: el filtro "Próximas a vencer" habría recibido el índice como fecha, y un `-0` cuando una tarea vence hoy.
- **`reglas_antiguas.txt` borrado**: permitía a cualquier usuario autenticado leer y borrar todas las tareas.

### 8.3 Lo que quedó pendiente

De la reestructuración:
- [x] **Publicar en PDN**: PR #5 fusionado, `deploy.yml` en verde y PDN verificado: la sesión iniciada se conservó, las 21 tareas reales aparecen (14 / 1 / 6) con "Sincronizado" y sin el distintivo DESARROLLO.
- [ ] **Hacer obligatorio el check `revisar`** (`ci.yml`) en el ruleset "Proteger main", para que no se pueda hacer merge con pruebas fallidas.
- [ ] **Partir `createBoardPage()`** en controladores más pequeños (edición, menú de etiquetas, arrastre, alertas): es el nodo más conectado del grafo (40 conexiones).
- [ ] **Rediseño del tablero** con el sistema de `DESIGN.md` y, con él, `reset.css` y `base.css` comunes (ver fase 6).
- [ ] **`@ts-check` con JSDoc** (opcional desde la fase 2).

De la sección 5 de `PENDIENTES.txt` (pruebas y CI/CD):
- [ ] **Pruebas de `firestore.rules`** con el Firebase Emulator Suite, incluida la prueba negativa de un usuario sin permisos.
- [ ] **Pruebas end-to-end** de la ruta crítica con Playwright.
- [ ] **Que `deploy.yml` no publique si fallan las pruebas**: hoy `ci.yml` las ejecuta en cada PR, pero el despliegue de `main` no las repite.

Funcionalidades de `PENDIENTES.txt` que ya encajan en la nueva estructura:
- [ ] **Cierre de sesión por inactividad** (sección 2): caso de uso `TrackInactivity` + componente de aviso.
- [ ] **Roles y gestión de usuarios** (sección 2): entidad `User` con `role` y caso de uso `ManageUsers`.
- [ ] **Registrar quién creó o movió cada tarea** (sección 2): `actorId` en la entidad `Task`.
- [ ] **Registro de errores en PDN** (sección 6): un `ErrorReporter` en `src/data/` que use el store y la guardia de sesión.
