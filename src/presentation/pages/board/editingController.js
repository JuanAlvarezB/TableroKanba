// Edición del texto de una tarea en su tarjeta: empezar, guardar o cancelar, el foco al terminar y lo
// que pasa si otro dispositivo borra o completa la tarea mientras se edita. Parte de la vista del
// tablero (BoardPage.js). La tarjeta en modo edición la crea components/TaskEditor.js.
import { isEditable } from '../../components/TaskCard.js';
import { autoResize, getEditorCard } from '../../components/TaskEditor.js';

/**
 * Qué hacer al guardar lo escrito: avisar porque se completó o quedó vacía, guardar el texto nuevo o
 * nada (el texto no cambió o la tarea ya no existe).
 * @param {import('../../../domain/entities/Task.js').Task | undefined} task
 * @param {string} text Lo escrito, ya sin espacios al principio ni al final.
 * @returns {'completed' | 'empty' | 'save' | 'none'}
 */
export function editOutcome(task, text) {
  if (task && !isEditable(task)) return 'completed';
  if (task && !text) return 'empty';
  if (task && text !== task.text) return 'save';
  return 'none';
}

/**
 * Si la tarea en edición cambió en otro dispositivo de forma que ya no se puede seguir editando.
 * @param {import('../../../domain/entities/Task.js').Task[]} tasks
 * @param {string} id
 * @returns {'deleted' | 'completed' | null}
 */
export function editingConflict(tasks, id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return 'deleted';
  if (!isEditable(task)) return 'completed';
  return null;
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {(message: string) => void} deps.showNotice
 * @param {() => void} deps.render
 * @param {() => void} deps.beforeStart Se llama al empezar a editar (cierra el menú de etiquetas).
 */
export function createEditingController({ store, showNotice, render, beforeStart }) {
  /** @type {import('../../components/TaskEditor.js').Editing | null} */
  let editing = null;

  const tasks = () => store.tasks;

  function focusEditButton(id) {
    const button = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .edit-btn`);
    if (button) button.focus({ preventScroll: true });
  }

  function start(id) {
    if (editing) {
      if (editing.id === id) return;
      commit();
    }
    const task = tasks().find((t) => t.id === id);
    if (!task || !isEditable(task)) return;
    beforeStart();

    editing = { id, original: task.text };
    render();

    const { textarea, element } = editing;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Guarda el texto editado. restoreFocus devuelve el foco al botón de editar (teclado).
  function commit(restoreFocus = false) {
    if (!editing) return;
    const { id, textarea } = editing;
    const text = textarea.value.trim();
    editing = null;

    const outcome = editOutcome(
      tasks().find((t) => t.id === id),
      text,
    );
    if (outcome === 'completed') {
      showNotice('Las tareas completadas no se pueden modificar.');
      render();
    } else if (outcome === 'empty') {
      showNotice('Una tarea no puede quedar vacía: se mantuvo el texto anterior.');
      render();
    } else if (outcome === 'save') {
      store.editText(id, text);
    } else {
      render();
    }
    if (restoreFocus) focusEditButton(id);
  }

  function cancel(restoreFocus = false) {
    if (!editing) return;
    const { id } = editing;
    editing = null;
    render();
    if (restoreFocus) focusEditButton(id);
  }

  const editorHandlers = { onCommit: commit, onCancel: cancel, getEditing: () => editing };

  return {
    start,
    commit,
    cancel,

    get active() {
      return editing !== null;
    },

    // Deja de editar sin guardar ni redibujar si la tarea en edición está entre las que se van a borrar.
    discard(ids) {
      if (editing && ids.includes(editing.id)) editing = null;
    },

    // La tarjeta en modo edición de la tarea, o null si no se está editando esa tarea.
    cardFor(task) {
      return editing && editing.id === task.id ? getEditorCard(task, editing, editorHandlers) : null;
    },

    // Al empezar a dibujar: si otro dispositivo borró o completó la tarea, se deja de editar y se avisa.
    reconcile(all) {
      if (!editing) return;
      const conflict = editingConflict(all, editing.id);
      if (conflict === 'deleted') {
        editing = null;
        showNotice('La tarea que estabas editando se eliminó en otro dispositivo.');
      } else if (conflict === 'completed') {
        editing = null;
        showNotice(
          'La tarea que estabas editando se marcó como completada en otro dispositivo; ya no se puede modificar.',
        );
      }
    },

    // Al vaciar las listas el editor sale del documento y pierde el foco: se guarda antes de dibujar y
    // la función devuelta lo restaura (con la selección del texto) al terminar.
    preserveFocus() {
      const focused =
        editing && editing.element && editing.element.contains(document.activeElement) ? document.activeElement : null;
      const selection = focused === editing?.textarea ? [focused.selectionStart, focused.selectionEnd] : null;
      return () => {
        if (!editing) return;
        autoResize(editing.textarea);
        if (focused) focused.focus({ preventScroll: true });
        if (selection) editing.textarea.setSelectionRange(...selection);
      };
    },
  };
}
