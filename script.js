const STORAGE_KEY = 'tareas';

// Columnas del tablero, en el orden del flujo de trabajo.
const STATUSES = ['pending', 'in-progress', 'completed'];

// Límite de trabajo en curso (WIP) por columna. Kanban limita lo que está
// "en curso" para terminar tareas antes de empezar otras nuevas.
const WIP_LIMITS = { 'in-progress': 3 };

const taskForm = document.getElementById('task-form');
const taskInput = document.getElementById('task-input');
const taskCount = document.getElementById('task-count');
const allDoneMessage = document.getElementById('all-done-message');
const clearCompletedBtn = document.getElementById('clear-completed');
const boardNotice = document.getElementById('board-notice');
const lists = document.querySelectorAll('.task-list');

let tasks = loadTasks();
let draggedId = null;
let noticeTimeout = null;

function loadTasks() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = stored ? JSON.parse(stored) : [];
  // Migra tareas guardadas con el formato anterior ({ completed: boolean }).
  return parsed.map((t) => ({
    id: t.id,
    text: t.text,
    status: STATUSES.includes(t.status) ? t.status : t.completed ? 'completed' : 'pending',
  }));
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function countByStatus(status) {
  return tasks.filter((t) => t.status === status).length;
}

function isColumnFull(status) {
  const limit = WIP_LIMITS[status];
  return limit !== undefined && countByStatus(status) >= limit;
}

function showNotice(message) {
  boardNotice.textContent = message;
  boardNotice.classList.remove('hidden');
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => boardNotice.classList.add('hidden'), 3000);
}

function addTask(text) {
  tasks.push({ id: Date.now(), text, status: 'pending' });
  saveTasks();
  render();
}

// Mueve una tarea a otra columna; si se indica beforeId, la coloca antes de esa tarea.
function moveTask(id, status, beforeId = null) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  if (task.status !== status && isColumnFull(status)) {
    showNotice(`Límite WIP alcanzado: termina una tarea "En curso" antes de empezar otra (máx. ${WIP_LIMITS[status]}).`);
    return;
  }

  tasks = tasks.filter((t) => t.id !== id);
  task.status = status;

  const beforeIndex = beforeId === null ? -1 : tasks.findIndex((t) => t.id === beforeId);
  if (beforeIndex === -1) {
    tasks.push(task);
  } else {
    tasks.splice(beforeIndex, 0, task);
  }

  saveTasks();
  render();
}

function shiftTask(id, direction) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const nextStatus = STATUSES[STATUSES.indexOf(task.status) + direction];
  if (nextStatus) moveTask(id, nextStatus);
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
}

function clearCompleted() {
  tasks = tasks.filter((t) => t.status !== 'completed');
  saveTasks();
  render();
}

function createCard(task) {
  const li = document.createElement('li');
  li.className = `card ${task.status}`;
  li.draggable = true;
  li.dataset.id = task.id;

  li.addEventListener('dragstart', (event) => {
    draggedId = task.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
    li.classList.add('dragging');
  });

  li.addEventListener('dragend', () => {
    draggedId = null;
    li.classList.remove('dragging');
    lists.forEach((list) => list.classList.remove('drag-over'));
  });

  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const index = STATUSES.indexOf(task.status);

  const backBtn = document.createElement('button');
  backBtn.className = 'move-btn';
  backBtn.textContent = '←';
  backBtn.title = 'Mover a la columna anterior';
  backBtn.disabled = index === 0;
  backBtn.addEventListener('click', () => shiftTask(task.id, -1));

  const forwardBtn = document.createElement('button');
  forwardBtn.className = 'move-btn';
  forwardBtn.textContent = '→';
  forwardBtn.title = 'Mover a la columna siguiente';
  forwardBtn.disabled = index === STATUSES.length - 1;
  forwardBtn.addEventListener('click', () => shiftTask(task.id, 1));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Eliminar tarea';
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  actions.append(backBtn, forwardBtn, deleteBtn);
  li.append(span, actions);
  return li;
}

// Devuelve la tarjeta situada justo debajo del cursor, para insertar antes de ella.
function getCardAfterCursor(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.dragging)')];
  return cards.find((card) => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}

function render() {
  lists.forEach((list) => {
    const status = list.dataset.status;
    list.innerHTML = '';

    const columnTasks = tasks.filter((t) => t.status === status);
    if (columnTasks.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Sin tareas';
      list.appendChild(empty);
    } else {
      columnTasks.forEach((task) => list.appendChild(createCard(task)));
    }

    const counter = document.querySelector(`[data-count="${status}"]`);
    const limit = WIP_LIMITS[status];
    counter.textContent = limit ? `${columnTasks.length}/${limit}` : columnTasks.length;
    list.closest('.column').classList.toggle('full', isColumnFull(status));
  });

  const openCount = tasks.filter((t) => t.status !== 'completed').length;
  taskCount.textContent = `${openCount} tarea${openCount === 1 ? '' : 's'} sin completar`;

  clearCompletedBtn.disabled = countByStatus('completed') === 0;

  const allCompleted = tasks.length > 0 && openCount === 0;
  allDoneMessage.classList.toggle('hidden', !allCompleted);
}

lists.forEach((list) => {
  list.addEventListener('dragover', (event) => {
    // preventDefault es necesario para que el evento drop se dispare.
    event.preventDefault();
    list.classList.add('drag-over');
  });

  list.addEventListener('dragleave', (event) => {
    if (!list.contains(event.relatedTarget)) list.classList.remove('drag-over');
  });

  list.addEventListener('drop', (event) => {
    event.preventDefault();
    list.classList.remove('drag-over');
    if (draggedId === null) return;

    const afterCard = getCardAfterCursor(list, event.clientY);
    const beforeId = afterCard ? Number(afterCard.dataset.id) : null;
    moveTask(draggedId, list.dataset.status, beforeId);
  });
});

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (text) {
    addTask(text);
    taskInput.value = '';
    taskInput.focus();
  }
});

clearCompletedBtn.addEventListener('click', clearCompleted);

render();
