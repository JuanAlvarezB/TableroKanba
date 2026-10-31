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
- [ ] Un miembro con todos sus permisos ve la tarjeta del tablero y no la de usuarios; el administrador ve
      las dos (detalle en 7.7).

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
      inicio). Se comprueba con `usuarios.html` (7.2).
- [ ] El mensaje del login antes de autenticarse sigue siendo genérico ("Correo o contraseña incorrectos.").
- [ ] Con dos cuentas, el administrador no ve las tareas del miembro en ningún lugar.
- [ ] Las reglas publicadas coinciden con `firestore.rules`: `npm run admin -- verificar-reglas
      --ambiente <dev|pdn>` termina en "✔ Coinciden" (o, sin el script, comparando en la consola).

### 7.1 Gestión de usuarios: reglas de transición e índice de tareas

Diseño en `docs/PLAN_USUARIOS.md`, sección 2 (2.6 y 2.9). Todavía no hay página de usuarios: se
comprueba que las personas actuales siguen trabajando y que el índice se escribe. Los documentos se
revisan en la consola de Firebase (Firestore), solo con tareas de prueba propias. Desde el PR 6 rigen las
reglas estrictas del índice (7.5).

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

### 7.2 Página de gestión de usuarios (`usuarios.html`)

Diseño en `docs/PLAN_USUARIOS.md`, sección 2 (2.3, 2.4 y 2.10). Se necesitan la cuenta del administrador
y una segunda cuenta de prueba propia (sin datos de personas reales en Desarrollo). Eliminar a una
persona se verifica en 7.4.

Acceso:
- [ ] Una cuenta de miembro que escribe `usuarios.html` va al inicio sin ver nada de la página (ni
      siquiera un instante: solo la pantalla de carga).
- [ ] Sin conexión, el administrador que abre `usuarios.html` va al inicio (sin red no hay privilegios).
- [ ] La tarjeta "Gestión de usuarios" del inicio solo aparece al administrador; un miembro no la ve.
- [ ] La página se ve como el inicio (cabecera, marca, menú de cuenta) y "Volver al inicio" funciona.
- [ ] El aviso sobre Authentication se ve y su enlace abre la consola de Authentication del ambiente
      correcto (Desarrollo en local, PDN en `juanalvarezb.github.io`) en otra pestaña.

Lista:
- [ ] Se ven correo, nombre, rol y estado de cada persona, y "Nunca ha entrado" en quien no tiene `uid`;
      nunca tareas, historial ni `uid`.
- [ ] La fila propia dice "Tú" y no tiene botón de acciones.
- [ ] Los filtros (Todos, Activos, Inactivos, En eliminación, Administradores) y la búsqueda por nombre
      o correo (sin importar tildes ni mayúsculas) funcionan, y el contador de personas cambia.
- [ ] Con la página abierta en dos navegadores con la misma cuenta, un cambio en uno aparece en el otro
      sin recargar.

Autorizar un correo:
- [ ] Autorizar un correo con mayúsculas o espacios: aparece en la lista en minúsculas, como miembro
      activo y "Nunca ha entrado"; el aviso recuerda crear su cuenta en Authentication.
- [ ] En la consola, el documento nuevo solo tiene `name`, `role`, `active` y `lastChange`, y en
      `adminLog` hay una entrada `authorize` con ese ID, `actorUid` del administrador, `targetUid` vacío
      (null), la hora del servidor y ningún correo ni nombre.
- [ ] Un correo ya autorizado se rechaza con "Ese correo ya está autorizado." y su documento no cambia.
- [ ] Correo mal escrito, nombre vacío o de más de 100 caracteres: el mensaje aparece en el diálogo y
      el foco va al campo que hay que corregir.
- [ ] Elegir "Administrador" muestra la advertencia; sin marcar la casilla no se autoriza.
- [ ] Con correo y contraseña: tras crear su cuenta en Authentication, la persona entra; con Google entra
      sola.

Desactivar y reactivar (con la segunda cuenta conectada en otro navegador):
- [ ] Desactivar pide confirmación con el foco en Cancelar; al aceptar, "Acceso desactivado." y la fila
      pasa a Inactivo.
- [ ] La persona desactivada, al volver a su pestaña o al intentar guardar, sale al login con el aviso
      de cuenta desactivada, sin pantallas a medias.
- [ ] Reactivar: "Acceso reactivado." y la persona vuelve a entrar con todas sus tareas.
- [ ] Desactivar a otra persona administradora muestra la advertencia de que pierde también ese rol.

Promover y degradar:
- [ ] "Dar rol de administrador" muestra la advertencia de que no verá tareas de nadie; al aceptar, la
      fila dice Administrador. La persona, al recargar o volver a su pestaña, ve la tarjeta de usuarios.
- [ ] "Quitar rol de administrador" la devuelve a Miembro; si tenía `usuarios.html` abierta, vuelve al
      inicio al volver a su pestaña (pasado un minuto) o al intentar un cambio.
- [ ] Una persona inactiva que es administradora ofrece "Quitar rol de administrador" además de
      "Reactivar".
- [ ] Cada cambio deja su entrada en `adminLog` (`deactivate`, `reactivate`, `promote`, `demote`; las de
      rol con `detail` = rol anterior y nuevo) y no se puede editar ni borrar desde la app.

Errores y accesibilidad:
- [ ] Sin conexión, un cambio muestra "Sin conexión. Revisa tu internet e inténtalo de nuevo." dentro del
      diálogo, que sigue abierto.
- [ ] Si otro administrador te quita el rol mientras tienes la página abierta, el siguiente cambio no se
      escribe y vuelves al inicio.
- [ ] Todo se puede hacer con teclado: Tab llega a filtros, búsqueda, "Autorizar correo" y cada botón
      "Acciones"; las flechas recorren el menú, Esc lo cierra y devuelve el foco al botón.
- [ ] En los diálogos, Esc o Cancelar cierran y el foco vuelve al botón que los abrió; mientras se
      guarda no se cierran.
- [ ] Con VoiceOver (o NVDA), cada fila se lee con nombre, correo, "Rol: …" y "Estado: …", y los avisos
      ("Correo autorizado.", errores) se anuncian.
- [ ] A 320 px de ancho no hay desplazamiento horizontal y la lista se ve como tarjetas.
- [ ] El administrador no ve tareas ni historial de nadie en esta página.

### 7.3 Script administrativo (`scripts/admin/`)

Diseño en `docs/PLAN_USUARIOS.md`, sección 2 (2.5 y 2.11); uso en el README, "Script administrativo". Todo
**primero en Desarrollo**, con la cuenta del administrador y una cuenta de prueba propia con algunas
tareas (alguna movida de columna, para que tenga historial). En los comandos, `<yo>` es tu correo de LUCAS.
Los resultados se revisan en la consola de Firebase (Firestore y Authentication).

Condiciones de seguridad:
- [ ] `npm run admin` sin argumentos muestra la ayuda; un comando sin `--admin` o con una opción que no usa
      se rechaza sin conectarse.
- [ ] Con `GOOGLE_APPLICATION_CREDENTIALS` definida, el script se niega a correr.
- [ ] `--admin` con el correo de un miembro: "no es un administrador activo" y no escribe nada.
- [ ] Cada comando que escribe, sin `--aplicar`, termina en "Simulación: no se escribió nada" y la consola
      no cambia.
- [ ] En PDN, con `--aplicar`, pide el identificador del proyecto; con uno distinto no escribe nada.
- [ ] Ninguna salida muestra el texto de una tarea ni el correo completo de otra persona.
- [ ] Cada ejecución con `--aplicar` que escribe en Firestore deja su entrada en `adminLog` con tu `uid`
      como `actorUid` y sin correos ni nombres.

Índice:
- [ ] `verificar-indice` informa cantidades e identificadores; si hay faltantes, `completar-indice
      --aplicar` (entrada `backfill-index`) y `verificar-indice` vuelve a terminar en "✔ Índice completo".

Respaldo (`respaldar`):
- [ ] Con una persona activa o administradora se niega con el motivo.
- [ ] Con la cuenta de prueba desactivada: pide la frase dos veces (no se ve al teclearla) y crea el
      archivo en `~/Documents/lucas-respaldos/dev/`; `ls -l` muestra `-rw-------` y la carpeta `drwx------`.
- [ ] El archivo no se puede leer como texto (`grep` con el texto de una tarea no lo encuentra) y con otra
      frase `restaurar` dice "la frase no es correcta".
- [ ] `deletions/<uid>` queda en `backup-ready` con `taskCount` = sus tareas, `backupAt` y `backupHash` igual
      a la huella que imprimió; en `adminLog`, la entrada `backup` en el mismo momento.
- [ ] En la página Usuarios, sin recargar, su fila muestra «Respaldo listo: n tareas, fecha» (sigue en 7.4);
      si no se va a eliminar, **Cancelar eliminación** borra el marcador.

Authentication con tus credenciales (A-19), anotando el resultado:
- [ ] `cuentas-huerfanas` lista las cuentas sin documento en `allowedUsers` (correo enmascarado), o explica
      que la limpieza es manual.
- [ ] `respaldar` con una persona sin `uid` en su documento pero con cuenta en Authentication: registra su
      `uid` antes del respaldo (o se niega explicando A-19).
- [ ] `cuentas-huerfanas --aplicar` sobre una cuenta de prueba sin autorizar: pide escribir `borrar`, la
      borra y deja `clean-auth`; Enter la salta.

Limpieza y purgas:
- [ ] `limpiar-usuario` con el `uid` de una persona autorizada se niega.
- [ ] `purgar-registro` y `limpiar-respaldos` informan la cantidad vencida (en Desarrollo lo normal es 0).

Ensayo de restauración (PBI-2.12), después de eliminar la cuenta de prueba con la página (7.4) y antes de
reautorizar su correo (`restaurar` se niega si el correo ya está autorizado):
- [ ] Anotar antes su `uid` (en su documento de `allowedUsers`) y el archivo del respaldo que hizo `respaldar`.
- [ ] Tras la eliminación, `verificar-indice --uid <uid>` informa 0 tareas y 0 índices.
- [ ] `restaurar` (simulación) informa sus tareas; con `--aplicar` vuelve a crear su documento desactivado,
      sus tareas y sus índices, con la entrada `restore`.
- [ ] En la página Usuarios aparece Inactiva; al reactivarla, la cuenta de prueba entra y ve todas sus
      tareas en su columna, con su historial.
- [ ] `verificar-indice --uid <uid>` termina en "✔ Índice completo".

En PDN, después del merge:
- [ ] `verificar-indice` y, si hay faltantes, `completar-indice --aplicar` hasta "✔ Índice completo" (requisito
      del PR 6).

### 7.4 Eliminar a una persona (`usuarios.html` y script)

Diseño en `docs/PLAN_USUARIOS.md`, sección 2 (2.4, flujo 5, y 2.5). Todo **primero en Desarrollo**, con la
cuenta del administrador y una cuenta de prueba propia (nunca la de una persona real) con **unas 30 tareas**
(algunas movidas de columna, para que tengan historial): así el borrado son varios trozos de 8 y se puede
interrumpir. En los comandos, `<yo>` es tu correo de LUCAS y `<correo>` el de la cuenta de prueba. Antes de
empezar, anota su `uid` (en su documento de `allowedUsers`).

Condiciones:
- [ ] Con la cuenta de prueba activa, su menú no ofrece **Eliminar…**; tampoco el de una persona inactiva que
      es administradora (hay que quitarle antes el rol). La fila propia sigue sin acciones.
- [ ] Desactivada, el menú ofrece **Reactivar** y **Eliminar…**.

Respaldo:
- [ ] **Eliminar…** sin respaldo abre «Primero, el respaldo» con el comando exacto (`--ambiente dev`, tu
      correo en `--admin` y el suyo en `--correo`); el foco está en **Entendido**.
- [ ] Ejecutar ese comando en la terminal (primero sin `--aplicar`). Sin recargar la página, la fila muestra
      «Respaldo listo: n tareas, fecha» con n = sus tareas, y el menú ofrece **Cancelar eliminación** y
      **Eliminar definitivamente…**.
- [ ] **Cancelar eliminación** pide confirmación y avisa «Eliminación cancelada.»; en la consola desaparece
      `deletions/<uid>` y `adminLog` tiene una entrada `delete-cancel`. Repetir `respaldar --aplicar`.
- [ ] (Opcional) En la consola, cambiar `backupAt` del marcador a un valor de hace más de 24 horas: la fila
      dice «Respaldo de más de 24 horas» y **Eliminar…** pide repetir el respaldo. Repetirlo.

Confirmaciones:
- [ ] **Eliminar definitivamente…** muestra las consecuencias (tareas, historial, permisos y autorización; la
      cuenta de Authentication no se borra), la fecha del respaldo y el número de tareas, con el foco en
      **Cancelar**. Cancelar no escribe nada.
- [ ] **Continuar** pide escribir el correo: el botón **Eliminar definitivamente** sigue deshabilitado hasta
      que coincide (sin importar mayúsculas ni espacios alrededor) y un texto distinto muestra «El correo
      escrito no coincide.».

Borrado, interrupción y reanudación (TK-2.9.4):
- [ ] En las herramientas del navegador (F12 → Network) elegir una conexión lenta («Slow 4G» o «3G») para que
      el borrado dure unos segundos.
- [ ] **Eliminar definitivamente**: el diálogo pasa a «Eliminando…» y avanza «Borrando tareas: 8 de n», «16
      de n»…; Esc y el clic fuera no lo cierran.
- [ ] Interrumpir a mitad: cerrar la pestaña (el navegador pregunta si quieres salir; acepta) en cuanto se
      vea «8 de n».
- [ ] Volver a abrir `usuarios.html`: la fila está «En eliminación», con la nota «Eliminación sin terminar»
      y solo **Reanudar eliminación**. En la consola, su documento tiene `deleting` (`at` y `doneLogId`), el
      marcador está en `state: deleting` con `confirmedAt` y quedan tareas e índices suyos.
- [ ] **Reanudar eliminación**: el avance sigue desde lo ya borrado (no desde 0) y termina con «Se eliminaron
      los datos de la persona. Recuerda borrar su cuenta en Authentication.» y el enlace a Authentication. Al
      cerrar, la fila ya no está y el foco queda en la búsqueda.

Comprobación en la consola (criterios 1 y 4 de PBI-2.9):
- [ ] No existen `allowedUsers/<correo>` ni `deletions/<uid>`.
- [ ] Firestore → `tasks` filtrado por `ownerId == <uid>`: ningún documento; igual en `taskIndex`.
      `npm run admin -- verificar-indice --ambiente dev --admin <yo> --uid <uid>` informa 0 tareas y 0 índices.
- [ ] Tus propias tareas y las de las demás personas siguen ahí.
- [ ] `adminLog` tiene `backup`, `delete-start` (con `detail.taskCount`) y `delete-done` (su ID es el
      `doneLogId` que tenía el documento), todas con tu `uid` como `actorUid`, el `uid` de prueba como
      `targetUid` y ningún correo ni nombre.

Datos que sobran (opcional):
- [ ] Repetir con otra cuenta de prueba y, después de `respaldar`, crear en la consola una tarea y su
      documento de `taskIndex` con su `ownerId`. Al confirmar, el diálogo dice «Quedan datos de la persona.
      Ejecuta el script de limpieza antes de terminar.» con el comando de `limpiar-usuario` y no borra nada.
      Ejecutarlo con su `uid` y `--aplicar`; **Reanudar eliminación** termina.

Quien nunca entró (criterio 5):
- [ ] Autorizar un correo de prueba que no vaya a entrar, desactivarlo y ejecutar `respaldar`: crea
      `deletions/<correo>` con `taskCount: 0`. Eliminarlo con las dos confirmaciones: el progreso termina sin
      tareas, desaparecen su documento y `deletions/<correo>`, y la entrada `delete-done` tiene `targetUid`
      vacío (null).

Reautorizar el mismo correo (criterio 6; si vas a ensayar la restauración de 7.3, hazla antes):
- [ ] **Autorizar correo** con el correo de la cuenta de prueba eliminada: el documento nuevo solo tiene
      `name`, `role`, `active` y `lastChange` (sin `uid`, `permissions` ni `deleting`).
- [ ] La cuenta de prueba entra (su cuenta de Authentication sigue si no se borró), ve el tablero vacío y su
      `uid` vuelve a aparecer en su documento; ningún dato anterior reaparece, tampoco desde la copia local del
      navegador.

Cuenta de Authentication:
- [ ] Al final, borrar su cuenta en Authentication → Users → ⋮ → Delete account (o con `cuentas-huerfanas`).

Accesibilidad:
- [ ] Todo el asistente se hace con teclado; Esc cierra los pasos de respaldo y confirmación, y el foco vuelve
      al botón **Acciones** de la fila.
- [ ] Con VoiceOver (o NVDA) se anuncian el título de cada paso, «Borrando tareas: …» y el resultado.
- [ ] A 320 px de ancho, el comando del respaldo se lee completo sin desplazamiento horizontal de la página.

### 7.5 Reglas estrictas del índice (PR 6)

Diseño en `docs/PLAN_USUARIOS.md`, 2.6 (paso 3 de la transición) y 2.9: crear o borrar una tarea exige su
documento de `taskIndex` en el mismo lote. Dos cuentas: la del administrador y una de prueba propia (miembro,
nunca la de una persona real). En los comandos, `<yo>` es tu correo de LUCAS. Los documentos se revisan en la
consola de Firebase (Firestore), solo con tareas de prueba propias.

Antes de publicar, en cada ambiente:
- [ ] `npm run admin -- verificar-indice --ambiente <dev|pdn> --admin <yo>` termina en "✔ Índice completo: 0
      tareas sin índice y 0 índices huérfanos".
- [ ] Anotar la hora de la versión vigente de las reglas (README, "Publicar reglas paso a paso").
- [ ] Solo en PDN: `npm run admin -- respaldar --ambiente pdn --admin <yo>` (sin `--correo`) primero sin
      `--aplicar` (anota el total de documentos) y después con `--aplicar`: termina en "✔ Respaldo cifrado y
      verificado" con ese mismo total, el archivo queda en `~/Documents/lucas-respaldos/pdn/` y `adminLog`
      tiene una entrada `backup` con `targetUid: null` y `detail.scope: 'environment'`. La frase, en el gestor
      de contraseñas.
- [ ] Solo en PDN: número de tareas por columna del administrador anotado.

En Desarrollo, con las reglas publicadas (antes de publicar en PDN):
- [ ] `verificar-reglas --ambiente dev` termina en "✔ Coinciden".
- [ ] Con la cuenta de prueba, crear una tarea: aparece su documento en `taskIndex` con el mismo ID y solo
      `ownerId`, y la consola del navegador no muestra `permission-denied`.
- [ ] Editar el texto, mover, poner prioridad y fecha límite funciona y no cambia su documento de `taskIndex`.
- [ ] Borrar una tarea: desaparecen su documento de `tasks` y el de `taskIndex`.
- [ ] Límite real de llamadas por lote (A-23): con 10 o más tareas completadas, **Limpiar completadas** las
      borra todas, con sus índices (lotes de 8: el primero lleno), sin `permission-denied` en la consola.
- [ ] Sin conexión: crear una tarea y borrar otra; al volver, el tablero queda en "Sincronizado" y en la
      consola cada tarea y su índice llegaron o se fueron juntos.
- [ ] Cerrar sesión y volver a entrar (se borra la marca `lucas-indice-…`): no aparece el aviso "No se pudo
      completar el índice de tareas" en la consola.
- [ ] Con las dos cuentas, el administrador sigue sin ver las tareas de la cuenta de prueba.
- [ ] Eliminar la cuenta de prueba de punta a punta (7.4) con estas reglas: termina sin errores y
      `verificar-indice --ambiente dev --admin <yo> --uid <uid>` informa 0 tareas y 0 índices (2.17, criterio 1).
- [ ] `verificar-indice --ambiente dev --admin <yo>` sigue en "✔ Índice completo".

En PDN, con las reglas publicadas antes del merge, y otra vez después del merge:
- [ ] `verificar-reglas --ambiente pdn` termina en "✔ Coinciden".
- [ ] Crear y borrar una tarea de prueba propia: su índice aparece y desaparece con ella.
- [ ] Las mismas tareas por columna que antes de publicar.
- [ ] `verificar-indice --ambiente pdn --admin <yo>` sigue en "✔ Índice completo".
- [ ] Etiqueta `pdn-reglas-AAAA-MM-DD` con la hora de la versión anterior (las de transición) en el mensaje.

### 7.6 Permisos por función: reglas (PR 7)

Diseño en `docs/PLAN_USUARIOS.md`, 3.4: sin el tablero no se leen ni escriben `tasks` ni `taskIndex`, y con
`priorities` o `dueDates` apagadas no se cambia su campo. Todavía no hay interfaz (PR 8) ni panel (PR 9): los
permisos se ponen a mano en la consola de Firebase (Firestore → `allowedUsers` → el documento → campo
`permissions`, de tipo **map**, con valores **boolean**), solo en la cuenta de prueba propia y solo en
Desarrollo. Dos cuentas: la del administrador y la de prueba (miembro, nunca la de una persona real).

Antes de publicar, en cada ambiente:
- [ ] Anotar la hora de la versión vigente de las reglas (README, "Publicar reglas paso a paso").
- [ ] Ningún documento de `allowedUsers` tiene el campo `permissions` (así nadie pierde acceso al publicar).
- [ ] Solo en PDN: número de tareas por columna del administrador anotado.

En Desarrollo, con las reglas publicadas (antes de publicar en PDN):
- [ ] `verificar-reglas --ambiente dev` termina en "✔ Coinciden".
- [ ] Con la cuenta de prueba, sin `permissions`: ve sus tareas, crea, edita, mueve, pone prioridad y fecha
      límite y borra, sin `permission-denied` en la consola del navegador.
- [ ] Ponerle `permissions` = `{ board: false }` y recargar el tablero: no cargan sus tareas del servidor, aparece
      el aviso "El servidor rechazó el cambio (reglas de seguridad de Firestore)…" y la consola muestra
      `permission-denied`. Era lo esperado hasta el PR 8; desde el PR 8, la tarjeta no aparece y
      `tablero.html` lleva al inicio con su aviso (7.7).
- [ ] Con la cuenta de prueba así, el administrador sigue trabajando con su tablero sin cambios.
- [ ] Cambiar a `{ priorities: false }` y recargar: las tareas cargan; mover y editar el texto funcionan; poner,
      cambiar o quitar una prioridad muestra el aviso de reglas y la etiqueta vuelve a la anterior. La fecha
      límite sigue funcionando.
- [ ] Cambiar a `{ dueDates: false }`: lo mismo con la fecha límite; la prioridad sigue funcionando.
- [ ] Cambiar a `{ board: false, priorities: true }`: no cargan las tareas (manda el padre).
- [ ] Borrar el campo `permissions` y recargar: todo vuelve a funcionar y las tareas, prioridades, fechas e
      historial siguen como estaban.
- [ ] Con el administrador, `permissions` = `{ board: false }` en su propio documento (desde la consola) no le
      quita nada: sigue con su tablero, prioridades y fechas. Borrar el campo al terminar.
- [ ] Al terminar, ningún documento de `allowedUsers` de Desarrollo tiene `permissions`.

En PDN, con las reglas publicadas antes del merge, y otra vez después del merge:
- [ ] `verificar-reglas --ambiente pdn` termina en "✔ Coinciden".
- [ ] Crear, editar, poner prioridad y fecha, y borrar una tarea de prueba propia, sin `permission-denied`.
- [ ] Las mismas tareas por columna que antes de publicar.
- [ ] Etiqueta `pdn-reglas-AAAA-MM-DD` con la hora de la versión anterior (las estrictas del índice) en el
      mensaje. Si ya existe una etiqueta con esa fecha (la de las estrictas es `pdn-reglas-2026-10-31`), añade
      `-permisos` al nombre.

### 7.7 Permisos por función: interfaz (PR 8)

Diseño en `docs/PLAN_USUARIOS.md`, 3.4 y 3.5: el inicio muestra solo las funciones habilitadas, `tablero.html`
exige el permiso `board` y dentro del tablero se ocultan las hijas apagadas. No cambia `firestore.rules` (las
reglas del PR 7 ya están publicadas). Todavía no hay panel (PR 9): los permisos se ponen a mano en la consola
de Firebase (Firestore → `allowedUsers` → el documento → campo `permissions`, de tipo **map**, con valores
**boolean**), solo en la cuenta de prueba propia y solo en Desarrollo. Dos cuentas: la del administrador (A) y
la de prueba (B, miembro, nunca la de una persona real). Tras cada cambio en la consola, recargar la página de
B salvo que el punto diga otra cosa. Antes de empezar, B tiene tareas con prioridad, con fecha límite,
alguna detenida (más de 3 días en Pendiente) y con historial.

Acceso por interfaz (inicio):
- [ ] B sin `permissions`: ve la tarjeta "Tablero de tareas" y no la de "Gestión de usuarios". A ve las dos.
- [ ] B con `{ board: false }`: el inicio no muestra la tarjeta del tablero y dice "No tienes funciones
      habilitadas. Habla con el administrador."
- [ ] Con VoiceOver (o NVDA), el inicio de B lee ese texto; con teclado no hay ningún enlace al tablero.
- [ ] A con `{ board: false }` en su propio documento (desde la consola) sigue viendo las dos tarjetas
      (un administrador tiene siempre todas las funciones). Borrar el campo al terminar.

Acceso por URL escrita a mano y enlaces antiguos:
- [ ] B con `{ board: false }`: escribir `…/tablero.html` en la barra de direcciones lleva al inicio con el
      aviso "El tablero de tareas no está habilitado para tu cuenta. Habla con el administrador." Durante la
      carga no se ve nada del tablero (ni columnas ni tareas) y en la consola no aparece `permission-denied`.
- [ ] Lo mismo desde un marcador guardado antes de apagar el tablero y con el botón "atrás" del navegador.
- [ ] Al recargar el inicio, el aviso ya no aparece (se muestra una sola vez).
- [ ] Con B así, A sigue trabajando en su tablero sin cambios (los demás no se ven afectados).

Con la sesión abierta (PBI-3.6):
- [ ] B con el tablero abierto; ponerle `{ board: false }`, cambiar a otra pestaña más de un minuto y volver:
      B vuelve al inicio con el aviso.
- [ ] Repetir, y en lugar de cambiar de pestaña crear o mover una tarea: ante el rechazo de las reglas, B vuelve
      al inicio con el aviso.
- [ ] B con el tablero abierto; ponerle `{ priorities: false }` y volver a la pestaña tras un minuto: la página
      se recarga sola y ya no se ven las etiquetas.

Funciones hijas dentro del tablero (B):
- [ ] `{ priorities: false }`: sin etiquetas de prioridad, sin borde ni atenuado por prioridad, sin los filtros
      Urgentes, Prioritarias, Puede esperar y Sin etiqueta, sin el contador 🔴 y sin la sección "Prioridad" del
      menú 🏷️ (que se llama "Fecha límite"). Las tareas siguen el orden manual; arrastrar una tarea entre otras
      la deja donde se suelta.
- [ ] `{ dueDates: false }`: sin etiquetas de vencimiento, sin el filtro ⏳ ni su contador y sin la fecha en el
      menú 🏷️ (que se llama "Etiqueta de prioridad").
- [ ] `{ priorities: false, dueDates: false }`: la tarjeta no tiene botón 🏷️; solo queda el filtro "Todas".
- [ ] Con solo `dueDates` activa, abrir el menú 🏷️ con el teclado (Tab y Enter): el foco va al campo de fecha;
      Esc cierra el menú y el foco vuelve al botón.
- [ ] `{ stalledAlerts: false }`: sin la insignia ⏰ de la tarjeta, sin el contador ⏰ de la columna y sin la
      marca de la fecha en la línea de tiempo.
- [ ] `{ reminders: false }`: en un turno de recordatorio (lunes a viernes, desde las 10:00 o las 15:00) no
      aparece el aviso. Para probarlo sin esperar, borrar en la consola del navegador la clave `ultimo-recordatorio`
      de `localStorage` y recargar; con `reminders` activa, el aviso sí aparece.
- [ ] Con `reminders` activa y `priorities` apagada, si solo hay tareas urgentes, el recordatorio no aparece; si
      hay vencidas, aparece sin el grupo de urgentes.
- [ ] `{ history: false }`: la tarjeta no muestra la línea de tiempo ni "Ver historial". Mover y editar una
      tarea; en la consola de Firebase su documento sigue recibiendo eventos en `history`.
- [ ] Con `priorities` y `dueDates` apagadas, crear, editar, mover y borrar tareas no da `permission-denied`.

Apagar no borra y reactivar restaura:
- [ ] Borrar `permissions` (o ponerlo todo en `true`): vuelven igual las etiquetas, las fechas, las alertas y el
      historial completo, incluidos los eventos registrados mientras `history` estaba apagada.
- [ ] `{ board: false, priorities: false, history: true }` y luego `{ board: true, priorities: false, history:
      true }`: al reactivar el padre, `priorities` sigue apagada y `history` encendida.
- [ ] Con `permissions` = `"todo"` (de tipo **string**, dato corrupto): B ve el inicio sin la tarjeta del tablero
      (como las reglas, que le niegan todo el tablero; A-52). Borrar el campo al terminar.

Sin conexión (PBI-3.6):
- [ ] B con `{ history: false }` entra con red (se recuerdan sus permisos). Sin red (modo avión o DevTools →
      Network → Offline), recargar el tablero: abre su copia local sin historial.
- [ ] B con `{ board: false }` entra al inicio con red; sin red, escribir `…/tablero.html`: vuelve al inicio con
      el aviso.
- [ ] Un navegador con la autorización recordada antes de este PR (sin `features`) abre el tablero sin red con
      todas las funciones (valores iniciales); al volver la red se reescribe con los permisos.

Al terminar:
- [ ] Ningún documento de `allowedUsers` de Desarrollo tiene `permissions`.
- [ ] En PDN, después del merge: el inicio y el tablero se ven como antes para el administrador y para un
      miembro (nadie tiene `permissions`), sin errores en la consola.

### 7.8 Panel de permisos (PR 9)

Diseño en `docs/PLAN_USUARIOS.md`, 3.6 y 3.7 (boceto `permisos-usuario.html`): en `usuarios.html`, **Acciones →
Permisos…** abre un diálogo con un interruptor por función y, al guardar, un resumen de los cambios. No cambia
`firestore.rules` (las reglas del PR 7 ya están publicadas). Dos cuentas, como en 7.7: la del administrador (A)
y la de prueba (B, miembro, nunca la de una persona real). Primero en Desarrollo; en PDN, solo los puntos de
«Al terminar». Antes de empezar, B tiene tareas con prioridad, con fecha límite y con historial.

Acceso y solo lectura:
- [ ] En la fila de B, **Acciones** muestra **Permisos…** como primera opción; la fila de A ("Tú") no tiene
      acciones y una persona en eliminación solo ofrece "Reanudar eliminación".
- [ ] B (miembro) no ve la tarjeta "Gestión de usuarios" y, si escribe `usuarios.html`, vuelve al inicio sin
      ver nada (7.2): no puede abrir el panel.
- [ ] Con una segunda cuenta administradora (si existe), su panel dice "Los administradores tienen siempre
      todas las funciones. Este panel es de solo lectura.", muestra todo "Activa", deshabilitado, y solo
      tiene el botón Cerrar. Si no hay otra, darle el rol a B, comprobarlo y quitárselo.

Cambiar y guardar:
- [ ] El panel de B muestra el tablero arriba y sus cinco funciones debajo, cada una con "Se aplica en el
      servidor" (tablero, prioridad, fecha límite) o "Solo en la pantalla" (detenidas, recordatorios,
      historial), y su estado en texto ("Activa"/"Apagada"), no solo en color.
- [ ] Apagar el tablero: las cinco funciones quedan deshabilitadas con su valor y aparece "Con el tablero
      apagado, estas funciones tampoco están disponibles. Sus valores se conservan y vuelven al reactivar el
      tablero." La función cambiada dice "Sin guardar".
- [ ] **Descartar** vuelve a lo guardado y deja de haber cambios (Descartar y Guardar cambios… se deshabilitan).
- [ ] **Guardar cambios…** muestra "¿Guardar los cambios?" con una línea por cambio ("Tablero de tareas:
      activada → apagada"); **Volver** regresa a los interruptores sin perder lo elegido; **Guardar** cierra,
      avisa "Permisos actualizados." y el foco vuelve al botón Acciones de B.
- [ ] En la consola de Firebase: el documento de B tiene `permissions` con solo las claves cambiadas y
      `lastChange`; `adminLog` tiene una entrada nueva `set-permissions` con el `uid` de A, el de B y `detail`
      `{ off: […] }` o `{ on: […] }`, sin correos ni nombres.
- [ ] Encender y apagar la misma función antes de guardar no deja nada pendiente (sin escritura ni entrada).
- [ ] Sin conexión (DevTools → Network → Offline), Guardar muestra "Sin conexión. Revisa tu internet e
      inténtalo de nuevo." dentro del diálogo y no lo cierra.

Efecto en B y en los demás (criterios 3.13: 1, 5 y 6):
- [ ] Con el tablero de B apagado desde el panel, B no ve la tarjeta del tablero; `tablero.html` lo lleva al
      inicio con el aviso (como en 7.7). A sigue usando su tablero sin cambios.
- [ ] Apagar `priorities` y `dueDates` a B desde el panel: B ya no ve sus etiquetas ni fechas; A sigue viendo
      las suyas. Volver a encenderlas: las de B vuelven igual.
- [ ] Apagar el tablero con `history` apagada y `reminders` encendida; reactivar el tablero: `history` sigue
      apagada y `reminders` encendida, y las tareas, prioridades, fechas e historial de B vuelven igual.

Accesibilidad (`docs/DESIGN.md`):
- [ ] Solo con teclado: Tab llega al menú de Acciones, flecha abajo y Enter abren Permisos…; el foco empieza
      en el interruptor del tablero; Espacio o Enter lo cambian; Tab salta las funciones deshabilitadas; Esc
      cierra y el foco vuelve a Acciones.
- [ ] Con VoiceOver (o NVDA): cada interruptor se anuncia como "Tablero de tareas, conmutador, activado" (o
      equivalente) con su descripción y si se aplica en el servidor; al apagar el tablero se lee el aviso de
      que las funciones se conservan; el resumen y los errores se leen.
- [ ] A 320 px de ancho: sin desplazamiento horizontal; el interruptor baja debajo del texto y mide al menos
      44 px de alto; el diálogo se desplaza por dentro.

Al terminar:
- [ ] En Desarrollo, borrar el campo `permissions` de B (vuelve a tener todo activo).
- [ ] En PDN, después del merge: A abre el panel de una persona sin cambiar nada (Cerrar) y la página no
      muestra errores en la consola. Ningún documento de PDN tiene `permissions` salvo que se haya decidido
      apagar algo a alguien.

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
- [ ] Con el permiso `history` apagado, el historial no se ve y se sigue registrando (detalle en 7.7).
- [ ] Teclado: Tab llega a "Ver historial (N)"; Enter y Espacio lo despliegan y lo pliegan; el foco no se
      pierde al desplegar.
- [ ] Lector de pantalla (VoiceOver): anuncia el botón con "contraído" o "expandido" y lee cada evento con
      su fecha; la flecha ▸ no se lee.
- [ ] A 320 px de ancho, los eventos largos se parten en varias líneas sin desbordar la tarjeta.
