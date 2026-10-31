// @vitest-environment happy-dom
// Confirmación de borrado en el tablero (docs/PLAN_SUBTAREAS.md, 1.8): la página real (tablero.html) con el
// store real y una copia local falsa, sin Firebase.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_FEATURES } from '../../../domain/rules/features.js';
import { createBoardStore } from '../../state/boardStore.js';
import { setFeatures } from '../../state/features.js';
import { createBoardPage } from './BoardPage.js';

const PAGE = readFileSync(resolve(import.meta.dirname, '../../../../tablero.html'), 'utf-8');
const BODY = PAGE.slice(PAGE.indexOf('>', PAGE.indexOf('<body')) + 1, PAGE.indexOf('<script type="module"'));

const NOW = Date.now();
const task = (id, text, status, order) => ({
  id,
  text,
  status,
  order,
  createdAt: NOW - 3600e3,
  startedAt: status === 'pending' ? null : NOW - 1800e3,
  completedAt: status === 'completed' ? NOW - 600e3 : null,
  priority: null,
  dueDate: null,
  history: null,
});

function openBoard(seed) {
  document.body.innerHTML = BODY;
  setFeatures(ALL_FEATURES);
  const store = createBoardStore({ now: () => NOW });
  createBoardPage({ store, reminders: { lastShown: () => 'visto', markShown() {} } });
  store.loadLocal({
    tasksKey: 'tareas',
    load: () => structuredClone(seed),
    save: () => true,
    isMigrated: () => true,
    markMigrated() {},
    isIndexComplete: () => true,
    markIndexComplete() {},
  });
  return store;
}

const dialog = () => document.querySelector('dialog.board-confirm');
const dialogText = () => dialog().querySelector('.dialog-text').textContent;
const [cancelButton, confirmButton] = [0, 1].map((i) => () => dialog().querySelectorAll('.dialog-actions button')[i]);
const card = (id) => document.querySelector(`.card[data-id="${id}"]`);
const deleteButton = (id) => card(id).querySelector('.delete-btn');
const clearButton = () => document.getElementById('clear-completed');
const notice = () => document.getElementById('board-notice').textContent;
const ids = (store) => store.tasks.map((t) => t.id);
const settle = () => Promise.resolve();

describe('confirmar antes de eliminar una tarea', () => {
  let store;
  beforeEach(() => {
    store = openBoard([
      task('a', 'Comprar pan', 'pending', 0),
      task('b', 'Llamar a la imprenta', 'pending', 1),
      task('c', 'Revisar correo', 'pending', 2),
      task('d', 'Preparar informe', 'in-progress', 3),
    ]);
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('D-1 el botón abre el diálogo que nombra la tarea y no borra nada', () => {
    deleteButton('b').click();
    expect(dialog().open).toBe(true);
    expect(dialog().querySelector('.dialog-title').textContent).toBe('¿Borrar esta tarea?');
    expect(dialogText()).toBe('«Llamar a la imprenta» se borrará con su historial.');
    expect(confirmButton().textContent).toBe('🗑️ Borrar tarea');
    expect(document.activeElement).toBe(cancelButton());
    expect(ids(store)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('D-2 cancelar no borra y el foco vuelve a su 🗑️, aunque la tarjeta se haya vuelto a dibujar', () => {
    deleteButton('b').focus();
    deleteButton('b').click();
    store.editText('d', 'Preparar informe final');
    cancelButton().click();
    expect(ids(store)).toEqual(['a', 'b', 'c', 'd']);
    expect(document.activeElement).toBe(deleteButton('b'));
  });

  it('D-3 confirmar borra una sola vez, avisa y pasa el foco a la tarjeta siguiente', () => {
    deleteButton('b').click();
    confirmButton().click();
    confirmButton().click();
    expect(ids(store)).toEqual(['a', 'c', 'd']);
    expect(dialog().open).toBe(false);
    expect(notice()).toBe('Se borró la tarea «Llamar a la imprenta».');
    expect(document.activeElement.closest('.card').dataset.id).toBe('c');
    expect(document.querySelector('[data-count="pending"]').textContent).toBe('2');
  });

  it('D-3 si era la última de su columna, el foco va al título de la columna', () => {
    deleteButton('d').click();
    confirmButton().click();
    expect(document.activeElement).toBe(document.querySelector('.column[data-status="in-progress"] h2'));
  });

  it('D-4 un texto largo aparece recortado a 80 caracteres', () => {
    store.editText('a', 'x'.repeat(120));
    deleteButton('a').click();
    expect(dialogText()).toBe(`«${'x'.repeat(79)}…» se borrará con su historial.`);
  });

  it('D-8 si otro dispositivo cambia su texto, el diálogo se actualiza', async () => {
    deleteButton('a').click();
    store.editText('a', 'Comprar pan integral');
    await settle();
    expect(dialog().open).toBe(true);
    expect(dialogText()).toBe('«Comprar pan integral» se borrará con su historial.');
  });

  it('D-8 si otro dispositivo la borra, el diálogo se cierra con un aviso', async () => {
    deleteButton('a').click();
    store.delete('a');
    await settle();
    expect(dialog().open).toBe(false);
    expect(notice()).toBe('La tarea ya no existe: se borró en otro dispositivo.');
    expect(document.activeElement.closest('.card').dataset.id).toBe('b');
  });

  it('D-8 si otro dispositivo la mueve, sigue abierto y confirmar la borra donde esté', async () => {
    deleteButton('a').click();
    store.move('a', 'in-progress');
    await settle();
    expect(dialog().open).toBe(true);
    confirmButton().click();
    expect(ids(store)).toEqual(['b', 'c', 'd']);
  });
});

describe('confirmar antes de borrar las completadas', () => {
  let store;
  beforeEach(() => {
    store = openBoard([
      task('a', 'Comprar pan', 'pending', 0),
      task('d', 'Preparar informe', 'in-progress', 1),
      task('e', 'Pagar arriendo', 'completed', 2),
      task('f', 'Enviar cotización', 'completed', 3),
    ]);
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('D-5 sin completadas el botón está deshabilitado y no abre el diálogo', () => {
    store.clearCompleted();
    expect(clearButton().disabled).toBe(true);
    clearButton().click();
    expect(dialog().open).toBe(false);
  });

  it('D-6 el diálogo dice cuántas se borrarán, igual que la columna', () => {
    clearButton().click();
    expect(dialog().querySelector('.dialog-title').textContent).toBe('¿Borrar las tareas completadas?');
    expect(dialogText()).toBe(
      'Se borrarán 2 tareas completadas con su historial. Las tareas pendientes y en curso no cambian.',
    );
    expect(document.querySelector('[data-count="completed"]').textContent).toBe('2');
    expect(confirmButton().textContent).toBe('🗑️ Borrar las completadas');
  });

  it('D-6 con una sola, en singular', () => {
    store.delete('f');
    clearButton().click();
    expect(dialogText()).toBe(
      'Se borrará 1 tarea completada con su historial. Las tareas pendientes y en curso no cambian.',
    );
  });

  it('D-7 cancelar no cambia nada', () => {
    clearButton().click();
    cancelButton().click();
    expect(ids(store)).toEqual(['a', 'd', 'e', 'f']);
    expect(document.activeElement).toBe(clearButton());
  });

  it('D-7 confirmar borra solo las completadas, una vez, avisa y lleva el foco al título de la columna', () => {
    clearButton().click();
    confirmButton().click();
    confirmButton().click();
    expect(ids(store)).toEqual(['a', 'd']);
    expect(notice()).toBe('Se borraron 2 tareas completadas.');
    expect(clearButton().disabled).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.column[data-status="completed"] h2'));
  });

  it('D-8 la cantidad sigue al tablero mientras está abierto y se borra lo que dice', async () => {
    clearButton().click();
    store.move('d', 'completed');
    await settle();
    expect(dialogText()).toMatch(/^Se borrarán 3 tareas completadas/);
    confirmButton().click();
    expect(ids(store)).toEqual(['a']);
    expect(notice()).toBe('Se borraron 3 tareas completadas.');
  });

  it('D-8 si ya no quedan completadas, el diálogo se cierra con un aviso', async () => {
    clearButton().click();
    store.clearCompleted();
    await settle();
    expect(dialog().open).toBe(false);
    expect(notice()).toBe('Ya no hay tareas completadas: se borraron o se movieron en otro dispositivo.');
  });
});
