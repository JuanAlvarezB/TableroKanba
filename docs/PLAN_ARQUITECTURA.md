# Plan de reestructuración de LUCAS: arquitectura limpia

Estado: **en ejecución**. Fases 0 a 2 hechas (pendiente verificar en PDN); fases 3 a 7 sin empezar.
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

- [ ] Extraer las reglas puras a `domain/rules/` con sus pruebas.
- [ ] Crear las entidades `Task` y `Session`.
- [ ] Definir los contratos en `domain/repositories/`.
  - Esta carpeta no aparece en `arquitecturaLimpia.md` y se propone añadirla. Ahí van los contratos; `data/` los implementa. Así el dominio no depende de Firebase.
- [ ] Crear los casos de uso. Reciben el repositorio por parámetro (inyección de dependencias), lo que permite probarlos con un repositorio falso en memoria.

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

- [ ] Implementar los repositorios según los contratos de la fase 3.
- [ ] `handleSyncError` pasa a ser un error del repositorio, y la interfaz decide qué mensaje mostrar.
- [ ] `ERROR_MESSAGES` de Firebase se traduce a errores del dominio, y los textos en español van en `shared/constants/messages.js`.

### Fase 5: Presentación y estado

- [ ] **Un estado central**: `presentation/state/boardStore.js`, con `getState`, `dispatch` y `subscribe`. Los casos de uso actualizan el store y la vista se suscribe y vuelve a dibujar sola. Así se corta el acoplamiento de `addTask → render` y `render()` deja de ser un nodo de 25 conexiones.
- [ ] **Componentes**, cada uno con su JS y su CSS: `TaskCard`, `Column`, `TaskEditor`, `LabelMenu`, `OverdueBanner`, `ReminderToast`, `FilterBar`, `AccountMenu` (hoy `cuenta.js`) y `ConfirmDialog`.
- [ ] **Páginas**: `HomePage`, `LoginPage` y `BoardPage`.
- [ ] **Un punto de entrada por página.** `arquitecturaLimpia.md` propone un solo `main.js`, pero el proyecto es multipágina. Se sugiere `src/pages/*/main.js` como composition root de cada página: ahí se conectan los repositorios, los casos de uso y la interfaz.
- [ ] **Guardias de sesión**: `requireSession()` pasa a `presentation/guards/` y lo usan Home y Board.

### Fase 6: Estilos

- [ ] Sacar los colores, tipografías y espacios de `DESIGN.md` y de los 4 CSS a `styles/variables.css` como tokens.
- [ ] Crear `styles/reset.css` y un `styles/base.css` común. Hoy `lucas.css` cumple a medias ese papel.
- [ ] Repartir `style.css` entre los componentes de la fase 5 y borrar las reglas duplicadas entre `login.css`, `inicio.css` y `lucas.css`.

### Fase 7: Cierre

- [ ] Borrar los archivos antiguos de la raíz (`script.js`, `auth.js`, etc.) y `reglas_antiguas.txt` si ya no aporta.
- [ ] Actualizar `README.md` con la nueva estructura, `npm run dev/build/test` y los ambientes.
- [ ] Ejecutar `graphify update .` y comprobar que el grafo refleja comunidades por capa y que ningún nodo concentra tantas conexiones como `render()`.

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
