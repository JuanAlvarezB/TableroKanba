# Verificación manual de LUCAS

Lista de flujos críticos que se repasa al cerrar cada fase de `PLAN_ARQUITECTURA.md`, primero en
Desarrollo (local) y después en PDN. Copia la lista en la descripción del PR y marca cada punto.

Antes de empezar: abre la consola del navegador y confirma que no aparece ningún error en rojo
al cargar cada página.

Excepción conocida (Safari): `Fetch API cannot load https://firestore.googleapis.com/…/Listen/channel?…
due to access control checks`. Es el canal de tiempo real de Firestore al cerrarse y reabrirse; Safari
lo muestra como error, pero no es un error de LUCAS. No cuenta como falla si el tablero sigue en
"Sincronizado" y un cambio llega a otro navegador. Cualquier otro error en rojo sí cuenta.

## 1. Ambiente

- [ ] En local, el tablero muestra la insignia **DESARROLLO** y el título empieza por `[DEV]`.
- [ ] En `juanalvarezb.github.io` no aparece la insignia (usa PDN).
- [ ] Las tareas de Desarrollo nunca aparecen en PDN, ni al revés.

## 2. Inicio de sesión (`login.html`)

- [ ] Entrar con correo y contraseña correctos lleva al inicio (`index.html`).
- [ ] Una contraseña incorrecta muestra "Correo o contraseña incorrectos." sin revelar si el correo existe.
- [ ] Entrar con Google funciona; cerrar la ventana de Google no muestra error.
- [ ] Una cuenta que no está en `allowedUsers` ve el aviso "Tu cuenta no tiene acceso a LUCAS…" y no entra.
- [ ] Una cuenta con `active: false` ve el aviso "Tu acceso a LUCAS fue desactivado…" y no entra.
- [ ] El botón de mostrar u ocultar la contraseña funciona.
- [ ] "Olvidé mi contraseña" envía el correo y vuelve a la vista de inicio de sesión.
- [ ] Verificación de correo: se puede reenviar, el botón respeta la espera, y "Ya verifiqué" continúa.
- [ ] Abrir `index.html` o `tablero.html` sin sesión redirige a `login.html`.

## 3. Inicio (`index.html`)

- [ ] Se ven el nombre y el avatar del usuario (foto de Google o iniciales).
- [ ] El acceso al tablero abre `tablero.html`.

## 4. Cuenta (inicio y tablero)

- [ ] "Cambiar contraseña" funciona y muestra el aviso de confirmación.
- [ ] "Cerrar sesión" pide confirmación; al aceptar vuelve a `login.html` y borra la copia local.

## 5. Tablero (`tablero.html`)

Tareas:
- [ ] Crear una tarea: aparece en Pendiente y se anuncia.
- [ ] Editar el texto (botón editar, Enter guarda, Escape cancela).
- [ ] Mover con los botones atrás y adelante entre Pendiente, En curso y Completada.
- [ ] Arrastrar y soltar dentro de una columna y entre columnas.
- [ ] Borrar una tarea.
- [ ] "Limpiar completadas" borra solo las completadas.
- [ ] El historial de la tarjeta muestra las fechas de creada, iniciada y completada.

Prioridad y vencimientos:
- [ ] Poner, cambiar y quitar la etiqueta (Urgente, Prioritaria, Puede esperar, Sin etiqueta), también con teclado.
- [ ] Cada columna se ordena por etiqueta y respeta el orden manual dentro de cada grupo.
- [ ] Los contadores por etiqueta aparecen en el encabezado de la columna.
- [ ] Filtros: Todas, Urgentes, Prioritarias, Puede esperar, Sin etiqueta, Próximas a vencer.
- [ ] Poner fecha límite: "Vence en N días" cuando faltan 2 días hábiles o menos, "Venció hace N días" después.

Alertas y recordatorios:
- [ ] El aviso de tareas detenidas aparece, el botón "ver" las resalta y se puede descartar.
- [ ] Recordatorio de lunes a viernes a las 10:00 y a las 15:00, una sola vez por franja.

Sincronización:
- [ ] El indicador de sincronización cambia de estado al guardar.
- [ ] Con el tablero abierto en dos pestañas, un cambio en una aparece y se resalta en la otra.
- [ ] Sin conexión, el tablero muestra la copia local; al reconectar se sincroniza.
- [ ] Cada usuario solo ve sus propias tareas.

## 6. Despliegue

- [ ] El workflow de GitHub Actions termina en verde.
- [ ] En PDN, después de recargar, el navegador usa la versión nueva (Safari incluido).
- [ ] No hay errores 404 en la pestaña Red.

## 7. Roles y acceso

Diseño en `docs/PLAN_USUARIOS.md`, sección 1. Los cambios de `role` y `active` se hacen en la consola
de Firebase (Firestore → `allowedUsers`) hasta que exista la página de usuarios. Se necesitan dos
cuentas: la del administrador y una de miembro.

- [ ] Documento solo con `name`: la persona entra y trabaja con su tablero sin cambios.
- [ ] Tras el primer acceso, el documento de la persona tiene `uid`; en el segundo acceso no cambia.
- [ ] Marcar `active: false`: con la sesión abierta, al volver a la pestaña o al intentar guardar,
      LUCAS cierra la sesión y muestra el aviso de cuenta desactivada en el login. No quedan pantallas a medias.
- [ ] Marcar `active: false` con la persona sin conexión: puede abrir LUCAS dentro de 7 días con
      su copia local; al recuperar la red es expulsada con el aviso.
- [ ] Volver a `active: true`: la persona entra y ve todas sus tareas.
- [ ] El administrador (con `role: 'admin'`) entra y mantiene su tablero. Sin rol, entra como miembro.
- [ ] Una cuenta de miembro no puede abrir una página de administración escribiendo la URL (va al
      inicio). Se comprueba cuando exista la primera página de administración (sección 2 del plan).
- [ ] El mensaje del login antes de autenticarse sigue siendo genérico ("Correo o contraseña incorrectos.").
- [ ] Con dos cuentas, el administrador no ve las tareas del miembro en ningún lugar.
- [ ] Las reglas publicadas coinciden con `firestore.rules`: `npm run admin -- verificar-reglas
      --ambiente <dev|pdn>` termina en "✔ Coinciden" (o, sin el script, comparando en la consola).

### 7.1 Gestión de usuarios: reglas de transición e índice de tareas

Diseño en `docs/PLAN_USUARIOS.md`, sección 2 (2.6 y 2.9). Todavía no hay página de usuarios: se
comprueba que las personas actuales siguen trabajando y que el índice se escribe. Los documentos se
revisan en la consola de Firebase (Firestore), solo con tareas de prueba propias.

- [ ] Una persona actual (documento solo con `name` o sin `uid`) entra y trabaja con su tablero sin
      cambios: ve sus tareas, crea, edita, mueve y borra.
- [ ] Tras su primer acceso con el código nuevo, cada tarea suya tiene un documento en `taskIndex` con el
      mismo ID y solo `ownerId`; no hay índices de tareas que ya no existen.
- [ ] En el navegador queda la marca `lucas-indice-<ambiente>-<uid>` (DevTools → Application →
      Local Storage) con la hora en que se completó; al volver a entrar, la hora no cambia.
- [ ] Crear una tarea crea su documento en `taskIndex`; borrarla (también con "Limpiar completadas") borra
      los dos.
- [ ] Editar el texto, mover, poner prioridad o fecha no cambia el documento de `taskIndex`.
- [ ] Sin conexión: crear y borrar tareas funciona y, al volver, la tarea y su índice llegan juntos.
- [ ] Con dos cuentas, el administrador sigue sin ver las tareas del miembro en ningún lugar.
- [ ] Una cuenta de miembro no puede escribir en `allowedUsers`, `adminLog` ni `deletions` (no hay
      pantalla para hacerlo; lo cubren las pruebas P-2, P-4, P-7 y P-8 del emulador).
- [ ] Las reglas publicadas coinciden con `firestore.rules` (`verificar-reglas` termina en "✔ Coinciden").
- [ ] Después del merge, en PDN siguen las mismas tareas por columna que antes de publicar.

## 8. Historial de tareas

Diseño en `docs/PLAN_USUARIOS.md`, sección 4. Los eventos guardados se revisan en la consola de Firebase
(Firestore → `tasks` → el documento de la tarea, campo `history`), solo con tareas de prueba propias; desde
el PR 11 también se ven en la tarjeta (8.1).

- [ ] Antes de publicar: respaldo de PDN hecho y número de tareas por columna anotado.
- [ ] Las reglas publicadas conservan `'history'` en `isValidTask` (`verificar-reglas` termina en
      "✔ Coinciden").
- [ ] Una tarea existente que no se toca no cambia: su documento sigue sin `history`.
- [ ] Crear una tarea: su documento tiene `history` con un solo evento `create`.
- [ ] Editar, mover, poner y quitar prioridad y fecha límite: cada cambio añade un evento con `from`
      y `to`; ninguno tiene correo, nombre, uid ni `actorId`.
- [ ] El primer cambio de una tarea existente añade antes sus eventos derivados (`derived: true`).
- [ ] Reordenar dentro de la columna no añade eventos.
- [ ] Con dos dispositivos, los cambios de ambos quedan en `history`.
- [ ] Sin conexión: los cambios se registran y sus eventos suben al reconectar.
- [ ] Borrar la tarea: el documento desaparece con su historial.
- [ ] La línea de tiempo de la tarjeta sigue mostrando las mismas fechas que antes.
- [ ] Después del merge, en PDN siguen las mismas tareas por columna que antes de publicar.

### 8.1 Vista del historial en la tarjeta

Pasos de `docs/PLAN_USUARIOS.md`, 4.7, más la etiqueta de B-4.1 y la accesibilidad (PBI-4.4).

- [ ] Una tarea **existente** muestra su historial derivado, marcado "(según las fechas guardadas)", sin
      haberla tocado (su documento sigue sin `history`).
- [ ] Crear una tarea: el historial tiene "Creada".
- [ ] Editar, mover, poner y quitar prioridad y fecha: cada cambio aparece con su valor anterior y el nuevo
      (por ejemplo "Prioridad: sin etiqueta → Urgente"), del más reciente al más antiguo.
- [ ] "Ver historial (N)" cuenta los eventos que despliega.
- [ ] Reordenar dentro de la columna no añade eventos.
- [ ] Con dos dispositivos, cambios en ambos aparecen en el historial de los dos; un historial desplegado
      sigue desplegado cuando llega un cambio del otro dispositivo.
- [ ] Sin conexión: los cambios se registran y se sincronizan al volver.
- [ ] Borrar la tarea: desaparece con su historial.
- [ ] Otra cuenta y el administrador no ven el historial (consola de Firebase con su sesión).
- [ ] La línea de tiempo resumida sigue mostrando las mismas fechas que antes.
- [ ] B-4.1: una tarea devuelta de En curso a Pendiente dice "En Pendiente desde" (no "Creada") con la
      fecha del regreso; las demás siguen diciendo "Creada".
- [ ] Con el permiso `history` apagado, el historial no se ve y se sigue registrando. **Pendiente:** el
      permiso llega con la sección 3 (PR 8); hasta entonces este punto no aplica.
- [ ] Teclado: Tab llega a "Ver historial (N)"; Enter y Espacio lo despliegan y lo pliegan; el foco no se
      pierde al desplegar.
- [ ] Lector de pantalla (VoiceOver): anuncia el botón con "contraído" o "expandido" y lee cada evento con
      su fecha; la flecha ▸ no se lee.
- [ ] A 320 px de ancho, los eventos largos se parten en varias líneas sin desbordar la tarjeta.
