// Diálogo de subtareas de una tarea (docs/PLAN_SUBTAREAS.md, 2.5 a 2.7 y 2.10): la lista con su progreso,
// agregar (Enter), editar, marcar y desmarcar, subir y bajar (también con Alt + flechas), borrar (con
// BoardConfirm) y "Completar tarea". En una tarea completada la lista es de solo lectura salvo desmarcar,
// que pide confirmar y la devuelve a En curso. Sigue los cambios del tablero mientras está abierto, sin
// perder el foco, lo escrito ni la edición en curso. Lo que se hace pasa por el store; los textos están en
// shared/constants/messages.js.
import { SUBTASK_LIMIT, SUBTASK_TEXT_LIMIT, subtaskProgress, subtasksOf } from '../../domain/rules/subtasks.js';
import { BOARD_MESSAGES } from '../../shared/constants/messages.js';
import { shortDateFormat } from '../format/dates.js';
import { COLUMN_NAMES, clipText } from '../format/labels.js';
import { createButton, createDialog } from './Dialog.js';

const ID = 'subtasks-dialog';
const TITLE_LENGTH = 120;
const TEXT = BOARD_MESSAGES.subtasks;

function createIconButton(icon, label, action, focusKey) {
  const button = createButton(icon, 'icon-btn');
  button.setAttribute('aria-label', label);
  button.title = label;
  button.dataset.action = action;
  button.dataset.focusKey = focusKey;
  return button;
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../state/boardStore.js').createBoardStore>} deps.store
 * @param {ReturnType<typeof import('./BoardConfirm.js').createBoardConfirm>} deps.confirmAction
 * @param {(message: string) => void} deps.showNotice Avisos del tablero (se ven al cerrar el diálogo).
 * @returns {{ open: (taskId: string, opener: HTMLElement | null) => void, readonly isOpen: boolean }}
 */
export function createSubtaskDialog({ store, confirmAction, showNotice }) {
  const { dialog, body, open: openDialog } = createDialog(ID, '');
  dialog.classList.add('subtasks-dialog');
  const title = body.querySelector('.dialog-title');

  const status = document.createElement('p');
  status.className = 'subtasks-status';
  const progress = document.createElement('progress');
  progress.className = 'subtasks-progress';
  progress.setAttribute('aria-label', TEXT.progressLabel);

  // Anuncios para el lector de pantalla: progreso, posiciones al reordenar, altas y bajas.
  const live = document.createElement('p');
  live.className = 'visually-hidden';
  live.setAttribute('aria-live', 'polite');

  // Motivo de un rechazo (texto vacío, tope, En curso lleno…).
  const message = document.createElement('p');
  message.className = 'form-error subtasks-message';
  message.setAttribute('role', 'alert');

  const empty = document.createElement('p');
  empty.className = 'subtasks-empty';
  empty.textContent = TEXT.empty;

  const list = document.createElement('ul');
  list.className = 'subtasks-list';
  list.setAttribute('aria-label', TEXT.listLabel);

  const form = document.createElement('form');
  form.className = 'subtasks-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = SUBTASK_TEXT_LIMIT;
  input.autocomplete = 'off';
  input.placeholder = TEXT.newPlaceholder;
  input.setAttribute('aria-label', TEXT.newLabel);
  const addButton = createButton(TEXT.add, 'dialog-btn');
  addButton.type = 'submit';
  form.append(input, addButton);
  const count = document.createElement('p');
  count.className = 'subtasks-count';

  const note = document.createElement('p');
  note.className = 'subtasks-note';
  const hint = document.createElement('p');
  hint.id = `${ID}-hint`;
  hint.className = 'subtasks-hint';

  const doneAt = document.createElement('span');
  doneAt.className = 'subtasks-done-at';
  const closeButton = createButton(TEXT.close, 'dialog-btn', () => dialog.close());
  const completeButton = createButton('', 'dialog-btn primary');
  const completeIcon = document.createElement('span');
  completeIcon.setAttribute('aria-hidden', 'true');
  completeIcon.textContent = '✓';
  completeButton.append(completeIcon, ` ${TEXT.complete}`);
  const footer = document.createElement('div');
  footer.className = 'subtasks-footer';
  footer.append(doneAt, closeButton, completeButton);

  body.append(status, progress, live, message, empty, list, form, count, note, hint, footer);

  /** Estado del diálogo abierto. */
  let taskId = null;
  let opener = null;
  let lastStatus = null;
  // Subtarea en edición, con lo escrito hasta ahora (sobrevive a los redibujos).
  let editing = null;
  // El Escape que cancela una edición no debe cerrar el diálogo.
  let swallowCancel = false;
  // Completar desde el botón del diálogo: no es "otro dispositivo".
  let completingHere = false;

  const findTask = () => store.tasks.find((t) => t.id === taskId);
  const control = (key) => list.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  const subtaskName = (subtask) => clipText(subtask.text);

  function announce(text) {
    live.textContent = text;
  }

  function showMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  // Motivo de un rechazo del store → mensaje dentro del diálogo ('unchanged' no es un error).
  function explain(result) {
    if (result.ok || result.reason === 'unchanged') return;
    if (result.reason === 'wip-limit') showMessage(TEXT.reopenFull(result.limit));
    else showMessage(TEXT.reasons[result.reason] ?? '');
  }

  /* ---------- Dibujar ---------- */

  function createRow(subtask, index, subtasks, readOnly) {
    const li = document.createElement('li');
    li.className = 'subtask-item';
    li.dataset.subtaskId = subtask.id;
    const name = subtaskName(subtask);

    if (editing?.id === subtask.id) {
      li.classList.add('is-editing');
      const field = document.createElement('input');
      field.type = 'text';
      field.className = 'subtask-edit';
      field.maxLength = SUBTASK_TEXT_LIMIT;
      field.value = editing.draft;
      field.setAttribute('aria-label', TEXT.editField);
      field.dataset.focusKey = `edit-field:${subtask.id}`;
      const tools = document.createElement('span');
      tools.className = 'subtask-tools';
      tools.append(
        createIconButton('✔', TEXT.save, 'save', `save:${subtask.id}`),
        createIconButton('✕', TEXT.cancelEdit, 'cancel-edit', `cancel-edit:${subtask.id}`),
      );
      li.append(field, tools);
      return li;
    }

    const label = document.createElement('label');
    label.className = `subtask-check${subtask.done ? ' is-done' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = subtask.done;
    checkbox.dataset.focusKey = `toggle:${subtask.id}`;
    // En una completada solo se desmarca (P-8); una pendiente ahí solo es posible con datos manipulados.
    checkbox.disabled = readOnly && !subtask.done;
    const text = document.createElement('span');
    text.textContent = subtask.text;
    label.append(checkbox, text);
    li.append(label);

    if (!readOnly) {
      const up = createIconButton('↑', TEXT.up(name), 'up', `up:${subtask.id}`);
      const down = createIconButton('↓', TEXT.down(name), 'down', `down:${subtask.id}`);
      // aria-disabled y no disabled: el botón sigue enfocable cuando la subtarea llega a un extremo.
      if (index === 0) up.setAttribute('aria-disabled', 'true');
      if (index === subtasks.length - 1) down.setAttribute('aria-disabled', 'true');
      const tools = document.createElement('span');
      tools.className = 'subtask-tools';
      tools.append(
        createIconButton('✏️', TEXT.edit(name), 'edit', `edit:${subtask.id}`),
        up,
        down,
        createIconButton('🗑️', TEXT.remove(name), 'remove', `remove:${subtask.id}`),
      );
      li.append(tools);
    }
    return li;
  }

  // Vuelve a dibujar con el estado de la tarea. El foco (y la selección de un campo) vuelve al mismo
  // control de la misma subtarea si sigue existiendo.
  function render() {
    const task = findTask();
    if (!task) return;
    const subtasks = subtasksOf(task);
    const { done, total } = subtaskProgress(task);
    const completed = task.status === 'completed';
    if (editing && (completed || !subtasks.some((s) => s.id === editing.id))) editing = null;

    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused?.dataset.focusKey ?? null;
    const selection =
      focused?.tagName === 'INPUT' && focused.type === 'text' ? [focused.selectionStart, focused.selectionEnd] : null;

    title.textContent = clipText(task.text, TITLE_LENGTH);
    status.textContent = TEXT.status(COLUMN_NAMES[task.status], done, total);
    progress.hidden = total === 0;
    progress.max = Math.max(total, 1);
    progress.value = done;
    progress.classList.toggle('is-complete', total > 0 && done === total);

    empty.hidden = total > 0 || completed;
    list.replaceChildren(...subtasks.map((subtask, index) => createRow(subtask, index, subtasks, completed)));
    list.hidden = total === 0;

    form.hidden = completed;
    const full = total >= SUBTASK_LIMIT;
    input.disabled = full;
    addButton.disabled = full;
    count.hidden = completed;
    count.textContent = full ? TEXT.reasons.limit : TEXT.count(total, SUBTASK_LIMIT);

    const pendingOnCompleted = completed && done < total;
    note.textContent = completed ? TEXT.readOnly : total > 0 && done === total ? TEXT.lastNote : '';
    note.hidden = !note.textContent || pendingOnCompleted;
    hint.textContent = !completed && done < total ? TEXT.completeHint(total - done) : '';
    hint.hidden = !hint.textContent;

    completeButton.hidden = completed || total === 0;
    if (done < total) {
      completeButton.setAttribute('aria-disabled', 'true');
      completeButton.setAttribute('aria-describedby', hint.id);
    } else {
      completeButton.removeAttribute('aria-disabled');
      completeButton.removeAttribute('aria-describedby');
    }
    doneAt.textContent =
      completed && task.completedAt ? TEXT.completedAt(shortDateFormat.format(task.completedAt)) : '';

    const restored = focusKey ? control(focusKey) : null;
    if (restored) {
      restored.focus({ preventScroll: true });
      if (selection) restored.setSelectionRange(...selection);
    }
  }

  /* ---------- Acciones ---------- */

  function act(result) {
    if (result.ok) showMessage('');
    else explain(result);
    return result.ok;
  }

  function toggle(subtask, done) {
    const task = findTask();
    if (task.status === 'completed' && !done) {
      askReopen(task, subtask);
      return;
    }
    if (act(store.toggleSubtask(taskId, subtask.id, done))) {
      const { done: finished, total } = subtaskProgress(findTask());
      announce(TEXT.announceProgress(finished, total));
    }
  }

  // Desmarcar en una completada: confirmar y volver a En curso en la misma escritura (D-8).
  function askReopen(task, subtask) {
    const copy = TEXT.reopenConfirm;
    const id = taskId;
    confirmAction({
      title: copy.title,
      text: copy.text(clipText(task.text), subtaskName(subtask)),
      confirmLabel: copy.confirm,
      icon: '↩',
      tone: 'primary',
      opener: control(`toggle:${subtask.id}`),
      onConfirm: () => {
        if (act(store.toggleSubtask(id, subtask.id, false, { reopen: true }))) {
          const { done, total } = subtaskProgress(findTask());
          announce(TEXT.announceProgress(done, total));
        }
      },
      refresh: () => {
        const latest = store.tasks.find((t) => t.id === id);
        const current = latest && subtasksOf(latest).find((s) => s.id === subtask.id);
        return latest?.status === 'completed' && current?.done
          ? { text: copy.text(clipText(latest.text), subtaskName(current)) }
          : null;
      },
      gone: copy.gone,
      focusAfter: () => control(`toggle:${subtask.id}`),
    });
  }

  function startEdit(subtask) {
    editing = { id: subtask.id, draft: subtask.text };
    render();
    const field = control(`edit-field:${subtask.id}`);
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }

  function finishEdit(save) {
    if (!editing) return;
    const { id, draft } = editing;
    editing = null;
    if (save) {
      const result = store.editSubtask(taskId, id, draft);
      if (!result.ok && result.reason === 'empty') showMessage(TEXT.editEmpty);
      else act(result);
    }
    render();
    control(`edit:${id}`)?.focus({ preventScroll: true });
  }

  function reorder(subtask, direction) {
    if (act(store.reorderSubtask(taskId, subtask.id, direction))) {
      const subtasks = subtasksOf(findTask());
      const position = subtasks.findIndex((s) => s.id === subtask.id) + 1;
      announce(TEXT.announceMoved(subtaskName(subtask), position, subtasks.length));
    }
  }

  // Borrar siempre con confirmación (P-10). Al confirmar, el foco pasa a la siguiente, a la anterior o, si
  // la lista queda vacía, al campo de agregar.
  function askRemove(subtask) {
    const copy = TEXT.removeConfirm;
    const id = taskId;
    const ids = subtasksOf(findTask()).map((s) => s.id);
    const index = ids.indexOf(subtask.id);
    const neighbors = [...ids.slice(index + 1), ...ids.slice(0, index).reverse()];
    confirmAction({
      title: copy.title,
      text: copy.text(subtaskName(subtask)),
      warning: BOARD_MESSAGES.irreversible,
      confirmLabel: copy.confirm,
      icon: '🗑️',
      tone: 'danger',
      opener: control(`remove:${subtask.id}`),
      onConfirm: () => {
        if (act(store.removeSubtask(id, subtask.id))) announce(TEXT.announceRemoved(subtaskName(subtask)));
      },
      refresh: () => {
        const latest = store.tasks.find((t) => t.id === id);
        const current = latest && latest.status !== 'completed' && subtasksOf(latest).find((s) => s.id === subtask.id);
        return current ? { text: copy.text(subtaskName(current)) } : null;
      },
      gone: copy.gone,
      focusAfter: (confirmed) => {
        if (!confirmed) return control(`remove:${subtask.id}`);
        for (const other of neighbors) {
          const next = control(`toggle:${other}`);
          if (next) return next;
        }
        return input;
      },
    });
  }

  // "Completar tarea": es la acción explícita (P-7), sin segundo paso. Con pendientes solo lleva el foco a la
  // primera que falta.
  function complete() {
    const task = findTask();
    if (completeButton.getAttribute('aria-disabled') === 'true') {
      const pending = subtasksOf(task).find((s) => !s.done);
      if (pending) control(`toggle:${pending.id}`)?.focus();
      return;
    }
    completingHere = true;
    store.move(taskId, 'completed');
    completingHere = false;
    if (findTask()?.status === 'completed') {
      showNotice(TEXT.completed(clipText(task.text)));
      dialog.close();
    }
  }

  /* ---------- Eventos ---------- */

  list.addEventListener('change', (event) => {
    const checkbox = event.target;
    if (checkbox.type !== 'checkbox') return;
    const subtask = subtasksOf(findTask()).find((s) => s.id === checkbox.closest('li').dataset.subtaskId);
    if (!subtask) return;
    // La casilla vuelve a su estado: lo que manda es la tarea (al confirmar, el redibujo la cambia).
    checkbox.checked = subtask.done;
    toggle(subtask, !subtask.done);
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    const subtask = subtasksOf(findTask()).find((s) => s.id === button.closest('li').dataset.subtaskId);
    if (!subtask) return;
    const { action } = button.dataset;
    if (action === 'edit') startEdit(subtask);
    else if (action === 'save') finishEdit(true);
    else if (action === 'cancel-edit') finishEdit(false);
    else if (action === 'up') reorder(subtask, -1);
    else if (action === 'down') reorder(subtask, 1);
    else if (action === 'remove') askRemove(subtask);
  });

  list.addEventListener('input', (event) => {
    if (editing && event.target.classList.contains('subtask-edit')) editing.draft = event.target.value;
  });

  list.addEventListener('keydown', (event) => {
    const row = event.target.closest('li');
    if (!row) return;
    if (event.target.classList.contains('subtask-edit')) {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        finishEdit(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        swallowCancel = true;
        setTimeout(() => (swallowCancel = false));
        finishEdit(false);
      }
      return;
    }
    // Reordenar sin arrastre: Alt + flecha arriba o abajo con el foco en la fila.
    const editable = findTask()?.status !== 'completed';
    if (editable && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const subtask = subtasksOf(findTask()).find((s) => s.id === row.dataset.subtaskId);
      if (!subtask) return;
      event.preventDefault();
      reorder(subtask, event.key === 'ArrowUp' ? -1 : 1);
    }
    // F2 edita la subtarea de la fila.
    if (editable && event.key === 'F2') {
      const subtask = subtasksOf(findTask()).find((s) => s.id === row.dataset.subtaskId);
      if (subtask) {
        event.preventDefault();
        startEdit(subtask);
      }
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = store.addSubtask(taskId, input.value);
    if (act(result)) {
      input.value = '';
      const added = result.changes.subtasks.at(-1);
      announce(TEXT.announceAdded(subtaskName(added)));
    }
    input.focus({ preventScroll: true });
  });

  completeButton.addEventListener('click', complete);

  // Escape con una subtarea en edición cancela la edición, no cierra el diálogo.
  dialog.addEventListener('cancel', (event) => {
    if (editing || swallowCancel) event.preventDefault();
  });

  // Al cerrar, Dialog.js devuelve el foco a la tarjeta; si el tablero la volvió a dibujar, se busca la
  // nueva y, si la tarea ya no existe, el título de su columna.
  dialog.addEventListener('close', () => {
    const id = taskId;
    const column = lastStatus;
    taskId = null;
    editing = null;
    if (opener?.isConnected) return;
    const card = document.querySelector(`.card[data-id="${CSS.escape(id ?? '')}"]`);
    const target =
      card?.querySelector('.subtasks-btn') ?? document.querySelector(`.column[data-status="${column}"] h2`);
    target?.focus({ preventScroll: true });
  });

  // Cambios del tablero (también los propios): se redibuja. Si la tarea se borró en otro dispositivo, se
  // cierra con un aviso; si se completó allí, se avisa dentro.
  store.on('change', () => {
    if (!dialog.open || taskId === null) return;
    const task = findTask();
    if (!task) {
      showNotice(TEXT.taskGone);
      dialog.close();
      return;
    }
    if (task.status === 'completed' && lastStatus !== 'completed' && !completingHere) {
      showMessage(TEXT.completedElsewhere);
    }
    lastStatus = task.status;
    render();
  });

  return {
    get isOpen() {
      return dialog.open;
    },

    open(id, from) {
      taskId = id;
      opener = from;
      const task = findTask();
      if (!task) return;
      lastStatus = task.status;
      editing = null;
      input.value = '';
      showMessage('');
      announce('');
      render();
      // Foco inicial (2.10): sin subtareas, el campo; con pendientes, la primera; todas terminadas,
      // "Completar tarea"; en una completada, su primera subtarea.
      const subtasks = subtasksOf(task);
      const firstPending = subtasks.find((s) => !s.done);
      let target;
      if (task.status === 'completed') target = subtasks[0] ? control(`toggle:${subtasks[0].id}`) : closeButton;
      else if (subtasks.length === 0) target = input;
      else if (firstPending) target = control(`toggle:${firstPending.id}`);
      else target = completeButton;
      openDialog(from, target ?? closeButton);
    },
  };
}
