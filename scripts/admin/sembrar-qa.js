// Comando sembrar-qa (docs/PLAN_AMBIENTES.md, E.4 y P-16): deja en el tablero de una persona de QA un conjunto
// fijo de tareas de ejemplo para verificar cada despliegue antes de aprobar PDN. Solo QA: se niega en
// Desarrollo y en PDN. Repetible: los identificadores salen del uid, así que volver a sembrar devuelve esas
// tareas a su estado inicial sin duplicarlas ni tocar ninguna otra. Las tareas se arman con las funciones
// del dominio y se guardan como las guarda la app (toDocument), aunque el Admin SDK se salte las reglas.
import { countOpenSubtasks, createTask, datesForStatus } from '../../src/domain/entities/Task.js';
import { historyEventsFor } from '../../src/domain/rules/history.js';
import { normalizeEmail } from '../../src/domain/rules/permissions.js';
import { toDocument } from '../../src/data/repositories/FirestoreTaskRepository.js';
import { maskEmail } from './accounts.js';
import { Refusal, commitWithLog, confirmWrite, requireAdmin, simulated } from './context.js';

// Literal, no solo el alias: aunque .firebaserc apuntara qa a otro proyecto, no se siembra nada.
export const QA_PROJECT_ID = 'tablero-kanban-qa';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Tarea de ejemplo: su estado final y cuándo pasó cada cosa, en milisegundos antes de la ejecución.
 * @typedef {object} SeedSpec
 * @property {string} text
 * @property {number} created Hace cuánto se creó.
 * @property {number} [started] Hace cuánto pasó a En curso.
 * @property {number} [completed] Hace cuánto se completó.
 * @property {'urgent' | 'high' | 'low'} [priority]
 * @property {number} [dueInDays] Fecha límite: días desde hoy (negativo, ya venció).
 * @property {string[]} [subtasks] Subtareas, en orden.
 * @property {number} [doneSubtasks] Cuántas de las primeras están terminadas.
 */

/** @type {SeedSpec[]} */
export const SEED_SPECS = [
  { text: 'Ejemplo: urgente', created: 2 * HOUR, priority: 'urgent' },
  { text: 'Ejemplo: prioritaria', created: 3 * HOUR, priority: 'high' },
  { text: 'Ejemplo: puede esperar', created: 4 * HOUR, priority: 'low' },
  { text: 'Ejemplo: sin etiqueta ni fecha', created: 5 * HOUR },
  { text: 'Ejemplo: vencida', created: 6 * DAY, dueInDays: -2 },
  { text: 'Ejemplo: vence hoy', created: DAY, started: 2 * HOUR, dueInDays: 0, priority: 'urgent' },
  { text: 'Ejemplo: próxima a vencer', created: DAY, dueInDays: 1 },
  { text: 'Ejemplo: detenida en Pendiente', created: 5 * DAY },
  { text: 'Ejemplo: detenida en En curso', created: 7 * DAY, started: 5 * DAY, priority: 'high' },
  {
    text: 'Ejemplo: completada con subtareas',
    created: 3 * DAY,
    started: 2 * DAY,
    completed: HOUR,
    subtasks: ['Preparar', 'Revisar'],
    doneSubtasks: 2,
  },
  {
    text: 'Ejemplo: subtareas pendientes',
    created: 2 * DAY,
    started: DAY,
    subtasks: ['Medir la pared', 'Comprar la pintura', 'Pintar'],
    doneSubtasks: 1,
  },
  {
    text: 'Ejemplo: subtareas terminadas, lista para completar',
    created: 2 * DAY,
    started: DAY,
    subtasks: ['Escribir el borrador', 'Enviarlo'],
    doneSubtasks: 2,
  },
];

/** Identificador fijo de la tarea n (1…12) de esa persona: qa-ejemplo-<uid corto>-01. */
export function seedId(uid, n) {
  return `qa-ejemplo-${uid.slice(0, 8)}-${String(n).padStart(2, '0')}`;
}

// "2026-11-03": el día local de la ejecución más los días indicados.
function localDate(ms, days) {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Aplica un cambio como lo haría la app: los campos nuevos y sus eventos de historial.
function change(task, changes, at, newId) {
  const events = historyEventsFor(task, changes, { now: at, newId });
  return { ...task, ...changes, history: [...task.history, ...events] };
}

/**
 * Tarea de ejemplo construida paso a paso con el dominio (creación, etiquetas, subtareas y movimientos), con
 * identificadores de evento deterministas para que dos siembras con la misma hora sean idénticas.
 * @param {string} uid
 * @param {number} n Posición (1…12).
 * @param {SeedSpec} spec
 * @param {number} now
 * @returns {import('../../src/domain/entities/Task.js').Task}
 */
export function buildSeedTask(uid, n, spec, now) {
  const id = seedId(uid, n);
  let counter = 0;
  const newId = () => `${id}-e${String((counter += 1)).padStart(2, '0')}`;
  const createdAt = now - spec.created;
  const history = historyEventsFor(null, { text: spec.text }, { now: createdAt, newId });
  let task = createTask({ id, text: spec.text, order: n, now: createdAt, history });

  const labels = {};
  if (spec.priority) labels.priority = spec.priority;
  if (spec.dueInDays !== undefined) labels.dueDate = localDate(now, spec.dueInDays);
  if (Object.keys(labels).length > 0) task = change(task, labels, createdAt, newId);

  const subtasks = (spec.subtasks ?? []).map((text, index) => ({ id: `${id}-s${index + 1}`, text, done: false }));
  task = { ...task, subtasks, openSubtasks: subtasks.length };

  if (spec.started !== undefined) {
    const at = now - spec.started;
    task = change(task, { status: 'in-progress', ...datesForStatus('in-progress', at) }, at, newId);
  }
  if (subtasks.length > 0) {
    // Una hora antes de completarla o, si sigue abierta, de la ejecución: siempre después de pasar a En curso.
    const at = now - (spec.completed ?? 0) - HOUR;
    const done = subtasks.map((subtask, index) => ({ ...subtask, done: index < (spec.doneSubtasks ?? 0) }));
    task = { ...change(task, { subtasks: done }, at, newId), openSubtasks: countOpenSubtasks(done) };
  }
  if (spec.completed !== undefined) {
    const at = now - spec.completed;
    task = change(task, { status: 'completed', ...datesForStatus('completed', at) }, at, newId);
  }
  return task;
}

/** Las 12 tareas de ejemplo de esa persona. */
export function buildSeedTasks(uid, now) {
  return SEED_SPECS.map((spec, index) => buildSeedTask(uid, index + 1, spec, now));
}

/** Escrituras: cada tarea (como la guarda la app) y su índice, en el mismo lote. */
export function seedOps(uid, now) {
  return buildSeedTasks(uid, now).flatMap((task) => [
    { type: 'set', collection: 'tasks', id: task.id, data: toDocument(task, uid) },
    { type: 'set', collection: 'taskIndex', id: task.id, data: { ownerId: uid } },
  ]);
}

/**
 * Solo QA, comprobado dos veces: el ambiente pedido y el proyecto al que apunta su alias.
 * @param {import('./context.js').CommandContext} context
 */
export function assertQa({ options, projectId }) {
  if (options.ambiente !== 'qa' || projectId !== QA_PROJECT_ID) {
    throw new Refusal(`sembrar-qa solo escribe en QA (${QA_PROJECT_ID}); recibido ${options.ambiente} (${projectId}).`);
  }
}

// La persona de --correo: autorizada, activa y con uid (ya entró una vez en QA).
async function requireTarget(store, email) {
  const id = normalizeEmail(email);
  const data = await store.get('allowedUsers', id);
  if (!data) throw new Refusal(`${maskEmail(id)} no está en allowedUsers de QA: autorízala primero.`);
  if (data.active === false) throw new Refusal(`${maskEmail(id)} está desactivada en QA.`);
  if (typeof data.uid !== 'string' || data.uid === '') {
    throw new Refusal(`${maskEmail(id)} no tiene uid todavía: tiene que entrar una vez en QA.`);
  }
  return { id, uid: data.uid };
}

/** @param {import('./context.js').CommandContext} context */
export async function seedQa(context) {
  assertQa(context);
  const { options, store, log, now } = context;
  const admin = await requireAdmin(store, options.admin);
  const target = await requireTarget(store, options.correo);

  const ops = seedOps(target.uid, now());
  const ids = ops.filter((op) => op.collection === 'tasks').map((op) => op.id);
  const existing = await store.ownersOf('tasks', ids);
  if (existing.some(({ ownerId }) => ownerId !== target.uid)) {
    throw new Refusal('Alguna tarea de ejemplo ya existe con otro dueño: no se escribió nada.');
  }
  log(`Persona: ${maskEmail(target.id)} · ${ids.length} tareas de ejemplo.`);
  log(`Por escribir: crear ${ids.length - existing.length} · devolver a su estado inicial ${existing.length}.`);
  log('Las demás tareas de la persona no cambian.');
  if (!options.aplicar) return simulated(log);

  await confirmWrite(context);
  await commitWithLog(
    store,
    ops,
    { action: 'seed-qa', actorUid: admin.uid, targetUid: target.uid, detail: { tasks: ids.length } },
    log,
  );
  log(`✔ Sembradas ${ids.length} tareas de ejemplo. Recarga tablero-kanban-qa.web.app para verlas.`);
  return 0;
}
