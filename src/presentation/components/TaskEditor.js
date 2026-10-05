// Tarjeta en modo edición. Se crea una vez y se reutiliza entre redibujados para no perder lo
// escrito cuando llegan cambios de otro dispositivo.

export function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * Edición en curso: { id, original, element, textarea, note }.
 * @typedef {{ id: string, original: string, element?: HTMLLIElement, textarea?: HTMLTextAreaElement,
 *   note?: HTMLParagraphElement }} Editing
 */

/**
 * Devuelve la tarjeta en modo edición: se crea la primera vez y después se reutiliza, solo
 * actualizando columna y texto si otro dispositivo los cambió.
 * @param {import('../../domain/entities/Task.js').Task} task
 * @param {Editing} editing
 * @param {{ onCommit: (restoreFocus: boolean) => void, onCancel: (restoreFocus: boolean) => void,
 *   getEditing: () => Editing | null }} handlers
 */
export function getEditorCard(task, editing, handlers) {
  if (!editing.element) editing.element = createEditor(task, editing, handlers);
  const { element, textarea, note } = editing;
  element.className = `card editing ${task.status}`;
  element.dataset.priority = task.priority ?? '';

  if (task.text !== editing.original) {
    if (textarea.value === editing.original) {
      // Sin cambios locales todavía: se adopta el texto nuevo sin molestar.
      textarea.value = task.text;
    } else {
      note.textContent = 'Otro dispositivo cambió esta tarea mientras la editabas. Si guardas, se usará tu versión.';
      note.classList.remove('hidden');
    }
    editing.original = task.text;
  }
  return element;
}

function createEditor(task, editing, { onCommit, onCancel, getEditing }) {
  const li = document.createElement('li');
  li.dataset.id = task.id;

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-input';
  textarea.value = task.text;
  textarea.rows = 1;
  textarea.maxLength = 500;
  textarea.setAttribute('aria-label', 'Texto de la tarea');
  textarea.addEventListener('input', () => autoResize(textarea));
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      onCommit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel(true);
    }
  });

  const note = document.createElement('p');
  note.className = 'edit-note hidden';
  note.setAttribute('role', 'status');

  const bar = document.createElement('div');
  bar.className = 'edit-bar';

  const hint = document.createElement('span');
  hint.className = 'edit-hint';
  hint.textContent = 'Enter guarda · Esc cancela';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'edit-cancel';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', () => onCancel(true));

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'edit-save';
  saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', () => onCommit(true));

  // Al pulsar los botones con ratón el foco se queda en el texto, así el clic decide la acción.
  [cancelBtn, saveBtn].forEach((btn) => btn.addEventListener('mousedown', (e) => e.preventDefault()));

  // Hacer clic fuera de la tarjeta guarda los cambios. Se espera un instante porque al
  // redibujar el tablero el editor pierde el foco y lo recupera enseguida, y al cambiar de
  // ventana el foco sigue en el texto: en ninguno de esos casos hay que guardar.
  li.addEventListener('focusout', () => {
    setTimeout(() => {
      const current = getEditing();
      if (current && current.element === li && !li.contains(document.activeElement)) onCommit(false);
    });
  });

  bar.append(hint, cancelBtn, saveBtn);
  li.append(textarea, note, bar);
  Object.assign(editing, { textarea, note });
  return li;
}
