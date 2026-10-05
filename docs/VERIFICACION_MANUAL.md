# Verificación manual de LUCAS

Lista de flujos críticos que se repasa al cerrar cada fase de `PLAN_ARQUITECTURA.md`, primero en
Desarrollo (local) y después en PDN. Copia la lista en la descripción del PR y marca cada punto.

Antes de empezar: abre la consola del navegador y confirma que no aparece ningún error en rojo
al cargar cada página.

## 1. Ambiente

- [ ] En local, el tablero muestra la insignia **DESARROLLO** y el título empieza por `[DEV]`.
- [ ] En `juanalvarezb.github.io` no aparece la insignia (usa PDN).
- [ ] Las tareas de Desarrollo nunca aparecen en PDN, ni al revés.

## 2. Inicio de sesión (`login.html`)

- [ ] Entrar con correo y contraseña correctos lleva al inicio (`index.html`).
- [ ] Una contraseña incorrecta muestra "Correo o contraseña incorrectos." sin revelar si el correo existe.
- [ ] Entrar con Google funciona; cerrar la ventana de Google no muestra error.
- [ ] Una cuenta que no está en `allowedUsers` ve el aviso "Tu cuenta no tiene acceso a LUCAS…" y no entra.
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
