// @vitest-environment happy-dom
// Diálogo de subtareas (docs/PLAN_SUBTAREAS.md, 2.5 a 2.7 y 2.10) con el store real, la confirmación del
// tablero real y una copia local falsa, sin Firebase.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOARD_MESSAGES } from '../../shared/constants/messages.js';
import { createBoardStore } from '../state/boardStore.js';
import { createBoardConfirm } from './BoardConfirm.js';
import { createSubtaskDialog } from './SubtaskDialog.js';

const TEXT = BOARD_MESSAGES.subtasks;
const NOW = 1_790_000_000_000;
const step = (id, done = false, text = `Paso ${id}`) => ({ id, text, done });
const task = (id, fields = {}) => ({
  id,
  text: `Tarea ${id}`,
  status: 'in-progress',
  order: 0,
  createdAt: NOW - 2000,
  startedAt: NOW - 1000,
  completedAt: null,
  priority: null,
  dueDate: null,
  history: [],
  subtasks: [],
  openSubtasks: 0,
  ...fields,
});

let store;
let notices;
let dialog;
let opener;

function setup(seed) {
  document.body.innerHTML = '<button id="opener">☑</button>';
  opener = document.getElementById('opener');
  let ids = 0;
  store = createBoardStore({ now: () => NOW, newEventId: () => `n${++ids}` });
  store.loadLocal({
    tasksKey: 'tareas',
    load: () => structuredClone(seed),
    save: () => true,
    isMigrated: () => true,
    markMigrated() {},
    isIndexComplete: () => true,
    markIndexComplete() {},
  });
  notices = [];
  const showNotice = (message) => notices.push(message);
  const confirmAction = createBoardConfirm({ store, showNotice });
  dialog = createSubtaskDialog({ store, confirmAction, showNotice });
}

afterEach(() => {
  document.body.innerHTML = '';
});

const subtaskDialog = () => document.querySelector('dialog.subtasks-dialog');
const confirmDialog = () => document.querySelector('dialog.board-confirm');
const $ = (selector) => subtaskDialog().querySelector(selector);
const key = (focusKey) => subtaskDialog().querySelector(`[data-focus-key="${focusKey}"]`);
const rows = () => [...subtaskDialog().querySelectorAll('.subtask-check span')].map((span) => span.textContent);
const live = () => $('[aria-live]').textContent;
const message = () => ($('.subtasks-message').hidden ? '' : $('.subtasks-message').textContent);
const subtasksOf = (id) => store.tasks.find((t) => t.id === id).subtasks;
const settle = () => Promise.resolve();
const press = (element, keyName, options = {}) =>
  element.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...options }));
const check = (focusKey) => {
  const box = key(focusKey);
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};
const confirmButtons = () => [...confirmDialog().querySelectorAll('.dialog-actions button')];
const add = (text) => {
  $('.subtasks-add input').value = text;
  $('.subtasks-add').dispatchEvent(new Event('submit', { cancelable: true }));
};

describe('diálogo de subtareas: sin subtareas', () => {
  beforeEach(() => {
    setup([task('a')]);
    dialog.open('a', opener);
  });

  it('abre con el título de la tarea, el foco en "Nueva subtarea" y sin "Completar tarea"', () => {
    expect(subtaskDialog().open).toBe(true);
    expect($('.dialog-title').textContent).toBe('Tarea a');
    expect($('.subtasks-status').textContent).toBe('En curso · Sin subtareas');
    expect($('.subtasks-empty').hidden).toBe(false);
    expect(document.activeElement).toBe($('.subtasks-add input'));
    expect($('.subtasks-footer .primary').hidden).toBe(true);
  });

  it('Enter agrega, limpia el campo, mantiene el foco y lo anuncia', () => {
    add('  Llamar al proveedor ');
    expect(subtasksOf('a')).toEqual([step('n1', false, 'Llamar al proveedor')]);
    expect(rows()).toEqual(['Llamar al proveedor']);
    expect($('.subtasks-add input').value).toBe('');
    expect(document.activeElement).toBe($('.subtasks-add input'));
    expect(live()).toBe('Subtarea agregada: «Llamar al proveedor».');
    expect($('.subtasks-count').textContent).toBe('1 de 20');
  });

  it('no agrega una vacía y explica por qué', () => {
    add('   ');
    expect(subtasksOf('a')).toEqual([]);
    expect(message()).toBe(TEXT.reasons.empty);
  });
});

describe('diálogo de subtareas: a medias', () => {
  beforeEach(() => {
    setup([task('a', { subtasks: [step('s1', true), step('s2'), step('s3')], openSubtasks: 2 }), task('b')]);
    dialog.open('a', opener);
  });

  it('abre con el foco en la primera pendiente, el progreso y "Completar tarea" deshabilitado', () => {
    expect(document.activeElement).toBe(key('toggle:s2'));
    expect($('.subtasks-status').textContent).toBe('En curso · 1 de 3 subtareas terminadas');
    expect($('.subtasks-progress').value).toBe(1);
    expect($('.subtasks-hint').textContent).toBe(TEXT.completeHint(2));
    const complete = $('.subtasks-footer .primary');
    expect(complete.getAttribute('aria-disabled')).toBe('true');
    expect(complete.getAttribute('aria-describedby')).toBe($('.subtasks-hint').id);
  });

  it('"Completar tarea" con pendientes no la completa: lleva a la primera que falta', () => {
    key('toggle:s3').focus();
    $('.subtasks-footer .primary').click();
    expect(store.tasks.find((t) => t.id === 'a').status).toBe('in-progress');
    expect(document.activeElement).toBe(key('toggle:s2'));
  });

  it('marcar actualiza la lista y lo anuncia; terminar la última no completa la tarea', () => {
    check('toggle:s2');
    expect(live()).toBe('2 de 3 subtareas terminadas.');
    check('toggle:s3');
    const a = store.tasks.find((t) => t.id === 'a');
    expect(a).toMatchObject({ status: 'in-progress', openSubtasks: 0 });
    expect($('.subtasks-note').textContent).toBe(TEXT.lastNote);
    expect($('.subtasks-footer .primary').hasAttribute('aria-disabled')).toBe(false);
  });

  it('con todas terminadas, "Completar tarea" la completa, cierra y avisa', () => {
    check('toggle:s2');
    check('toggle:s3');
    $('.subtasks-footer .primary').click();
    expect(store.tasks.find((t) => t.id === 'a').status).toBe('completed');
    expect(subtaskDialog().open).toBe(false);
    expect(notices).toEqual(['«Tarea a» pasó a Completada.']);
  });

  it('editar: Enter guarda y el foco vuelve a ✏️', () => {
    key('edit:s2').click();
    const field = key('edit-field:s2');
    expect(document.activeElement).toBe(field);
    field.value = 'Revisar cifras';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    press(field, 'Enter');
    expect(subtasksOf('a')[1].text).toBe('Revisar cifras');
    expect(document.activeElement).toBe(key('edit:s2'));
  });

  it('editar: Escape cancela sin cerrar el diálogo', () => {
    key('edit:s2').click();
    const field = key('edit-field:s2');
    field.value = 'Otro texto';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    press(field, 'Escape');
    const cancel = new Event('cancel', { cancelable: true });
    subtaskDialog().dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(subtaskDialog().open).toBe(true);
    expect(subtasksOf('a')[1].text).toBe('Paso s2');
    expect(document.activeElement).toBe(key('edit:s2'));
  });

  it('editar: vacía no la borra, mantiene el texto y lo explica', () => {
    key('edit:s2').click();
    key('edit-field:s2').value = '   ';
    key('edit-field:s2').dispatchEvent(new Event('input', { bubbles: true }));
    key('save:s2').click();
    expect(subtasksOf('a')[1].text).toBe('Paso s2');
    expect(message()).toBe(TEXT.editEmpty);
  });

  it('reordenar con los botones y con Alt + flechas, sin perder el foco, y lo anuncia', () => {
    expect(key('up:s1').getAttribute('aria-disabled')).toBe('true');
    expect(key('down:s3').getAttribute('aria-disabled')).toBe('true');
    key('down:s1').focus();
    key('down:s1').click();
    expect(subtasksOf('a').map((s) => s.id)).toEqual(['s2', 's1', 's3']);
    expect(document.activeElement).toBe(key('down:s1'));
    expect(live()).toBe('«Paso s1» quedó en la posición 2 de 3.');
    key('toggle:s3').focus();
    press(key('toggle:s3'), 'ArrowUp', { altKey: true });
    expect(subtasksOf('a').map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    expect(document.activeElement).toBe(key('toggle:s3'));
    key('up:s2').click();
    expect(subtasksOf('a').map((s) => s.id)).toEqual(['s2', 's3', 's1']);
  });

  it('borrar pide confirmación encima; cancelar no cambia nada', () => {
    key('remove:s2').focus();
    key('remove:s2').click();
    expect(confirmDialog().open).toBe(true);
    expect(subtaskDialog().open).toBe(true);
    expect(confirmDialog().querySelector('.dialog-text').textContent).toBe('«Paso s2» se borrará de esta tarea.');
    expect(document.activeElement).toBe(confirmButtons()[0]);
    confirmButtons()[0].click();
    expect(subtasksOf('a')).toHaveLength(3);
    expect(document.activeElement).toBe(key('remove:s2'));
  });

  it('borrar: al confirmar la quita, lo anuncia y el foco pasa a la siguiente', () => {
    key('remove:s2').click();
    confirmButtons()[1].click();
    expect(subtasksOf('a').map((s) => s.id)).toEqual(['s1', 's3']);
    expect(live()).toBe('Subtarea borrada: «Paso s2».');
    expect(document.activeElement).toBe(key('toggle:s3'));
  });

  it('un cambio de otro dispositivo redibuja sin perder el foco ni lo escrito en "Nueva subtarea"', () => {
    $('.subtasks-add input').value = 'A medio escribir';
    key('toggle:s3').focus();
    store.toggleSubtask('a', 's2', true);
    expect(rows()).toHaveLength(3);
    expect(document.activeElement).toBe(key('toggle:s3'));
    expect($('.subtasks-add input').value).toBe('A medio escribir');
  });

  it('una edición en curso sobrevive a un cambio de otro dispositivo', () => {
    key('edit:s3').click();
    key('edit-field:s3').value = 'Sin terminar';
    key('edit-field:s3').dispatchEvent(new Event('input', { bubbles: true }));
    store.toggleSubtask('a', 's2', true);
    expect(key('edit-field:s3').value).toBe('Sin terminar');
    expect(document.activeElement).toBe(key('edit-field:s3'));
  });

  it('abrirlo otra vez estando abierto no falla y deja el foco en la primera pendiente', () => {
    key('toggle:s3').focus();
    dialog.open('a', opener);
    expect(subtaskDialog().open).toBe(true);
    expect(document.activeElement).toBe(key('toggle:s2'));
  });

  it('si otro dispositivo borra la tarea, se cierra con un aviso', () => {
    store.delete('a');
    expect(subtaskDialog().open).toBe(false);
    expect(notices).toEqual([TEXT.taskGone]);
  });

  it('si otro dispositivo la completa, pasa a solo lectura y lo avisa dentro', () => {
    store.toggleSubtask('a', 's2', true);
    store.toggleSubtask('a', 's3', true);
    store.move('a', 'completed');
    expect(subtaskDialog().open).toBe(true);
    expect(message()).toBe(TEXT.completedElsewhere);
    expect($('.subtasks-add').hidden).toBe(true);
    expect(subtaskDialog().querySelector('.subtask-tools')).toBeNull();
  });
});

describe('diálogo de subtareas: tarea completada', () => {
  beforeEach(() => {
    const done = task('a', {
      status: 'completed',
      completedAt: NOW,
      subtasks: [step('s1', true), step('s2', true)],
      openSubtasks: 0,
    });
    setup([done]);
    dialog.open('a', opener);
  });

  it('es de solo lectura: sin agregar, editar, reordenar ni borrar, y con su fecha', () => {
    expect($('.subtasks-add').hidden).toBe(true);
    expect(subtaskDialog().querySelector('.subtask-tools')).toBeNull();
    expect($('.subtasks-note').textContent).toBe(TEXT.readOnly);
    expect($('.subtasks-done-at').textContent).toMatch(/^Completada el /);
    expect($('.subtasks-footer .primary').hidden).toBe(true);
    expect(document.activeElement).toBe(key('toggle:s1'));
  });

  it('desmarcar pide confirmar; cancelar la deja completada y marcada', () => {
    check('toggle:s1');
    expect(confirmDialog().open).toBe(true);
    expect(confirmDialog().querySelector('.dialog-text').textContent).toBe(
      '«Tarea a» está completada. Si marcas «Paso s1» como pendiente, la tarea vuelve a En curso.',
    );
    expect(key('toggle:s1').checked).toBe(true);
    confirmButtons()[0].click();
    expect(store.tasks[0].status).toBe('completed');
    expect(key('toggle:s1').checked).toBe(true);
  });

  it('al confirmar vuelve a En curso con la subtarea pendiente, y la lista se puede cambiar', async () => {
    check('toggle:s1');
    confirmButtons()[1].click();
    await settle();
    expect(store.tasks[0]).toMatchObject({ status: 'in-progress', openSubtasks: 1, completedAt: null });
    expect(subtasksOf('a')[0].done).toBe(false);
    expect($('.subtasks-add').hidden).toBe(false);
    expect(message()).toBe('');
    expect(document.activeElement).toBe(key('toggle:s1'));
  });
});

describe('diálogo de subtareas: tope', () => {
  it('con 20 subtareas no deja agregar y lo dice', () => {
    const many = Array.from({ length: 20 }, (_, i) => step(`s${i}`));
    setup([task('a', { subtasks: many, openSubtasks: 20 })]);
    dialog.open('a', opener);
    expect($('.subtasks-add input').disabled).toBe(true);
    expect($('.subtasks-count').textContent).toBe(TEXT.reasons.limit);
  });
});
