// @vitest-environment happy-dom
// Pruebas del diálogo de confirmación del tablero (docs/PLAN_SUBTAREAS.md, 1.8) con un DOM simulado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardConfirm } from './BoardConfirm.js';

function fakeStore() {
  const listeners = [];
  return {
    on: (type, listener) => listeners.push(listener),
    change: async () => {
      listeners.forEach((listener) => listener());
      await Promise.resolve();
    },
  };
}

// Escape: el navegador dispara cancel y, si nadie lo impide, cierra el diálogo.
function pressEscape(dialog) {
  if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
}

describe('confirmación del tablero', () => {
  let store;
  let notices;
  let confirmAction;
  let opener;
  let dialog;

  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">🗑️</button><h2 id="fallback" tabindex="-1">Pendiente</h2>';
    opener = document.getElementById('opener');
    store = fakeStore();
    notices = [];
    confirmAction = createBoardConfirm({ store, showNotice: (message) => notices.push(message) });
    dialog = document.querySelector('dialog.board-confirm');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const ask = (fields = {}) => {
    const request = {
      title: '¿Borrar esta tarea?',
      text: '«Comprar pan» se borrará con su historial.',
      warning: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Borrar tarea',
      icon: '🗑️',
      tone: 'danger',
      opener,
      onConfirm: vi.fn(),
      focusAfter: () => document.getElementById('fallback'),
      ...fields,
    };
    opener.focus();
    confirmAction(request);
    return request;
  };
  const buttons = () => [...dialog.querySelectorAll('.dialog-actions button')];
  const cancelButton = () => buttons()[0];
  const confirmButton = () => buttons()[1];

  it('abre con título, mensaje, advertencia y el foco en Cancelar', () => {
    ask();
    expect(dialog.open).toBe(true);
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('¿Borrar esta tarea?');
    const described = dialog
      .getAttribute('aria-describedby')
      .split(' ')
      .map((id) => document.getElementById(id).textContent);
    expect(described).toEqual(['«Comprar pan» se borrará con su historial.', '⚠ Esta acción no se puede deshacer.']);
    expect(document.activeElement).toBe(cancelButton());
    expect(cancelButton().textContent).toBe('Cancelar');
  });

  it('el botón destructivo nombra la acción y su ícono no se lee', () => {
    ask();
    const button = confirmButton();
    expect(button.classList.contains('danger')).toBe(true);
    expect(button.textContent).toBe('🗑️ Borrar tarea');
    expect(button.querySelector('[aria-hidden="true"]').textContent).toBe('🗑️');
    expect(dialog.querySelector('.dialog-warn [aria-hidden="true"]').textContent).toBe('⚠');
  });

  it('sin advertencia, no la muestra ni la nombra en aria-describedby', () => {
    ask({ warning: null, tone: 'primary' });
    expect(dialog.querySelector('.dialog-warn').hidden).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBe('board-confirm-text');
    expect(confirmButton().classList.contains('primary')).toBe(true);
  });

  it('Cancelar, Escape y tocar fuera cierran sin confirmar y devuelven el foco al opener', () => {
    const closers = [
      () => cancelButton().click(),
      () => pressEscape(dialog),
      () => dialog.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    ];
    for (const close of closers) {
      const request = ask();
      close();
      expect(dialog.open).toBe(false);
      expect(request.onConfirm).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(opener);
    }
  });

  it('confirmar llama una sola vez a la acción, también con doble clic, y cierra', () => {
    const request = ask();
    confirmButton().click();
    confirmButton().click();
    expect(request.onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(false);
  });

  it('al confirmar, el foco va al destino indicado', () => {
    ask();
    confirmButton().click();
    expect(document.activeElement).toBe(document.getElementById('fallback'));
  });

  it('si el opener se volvió a dibujar mientras estaba abierto, cancelar lleva el foco al destino', () => {
    ask();
    opener.remove();
    cancelButton().click();
    expect(document.activeElement).toBe(document.getElementById('fallback'));
  });

  it('cada cambio del tablero actualiza el texto', async () => {
    ask({ refresh: () => ({ text: '«Comprar pan integral» se borrará con su historial.' }) });
    await store.change();
    expect(dialog.querySelector('.dialog-text').textContent).toBe(
      '«Comprar pan integral» se borrará con su historial.',
    );
    expect(dialog.open).toBe(true);
  });

  it('si la acción ya no aplica, se cierra sin confirmar y avisa', async () => {
    const request = ask({ refresh: () => null, gone: 'La tarea ya no existe: se borró en otro dispositivo.' });
    opener.remove();
    await store.change();
    expect(dialog.open).toBe(false);
    expect(request.onConfirm).not.toHaveBeenCalled();
    expect(notices).toEqual(['La tarea ya no existe: se borró en otro dispositivo.']);
    expect(document.activeElement).toBe(document.getElementById('fallback'));
  });

  it('con el diálogo cerrado, los cambios del tablero no hacen nada', async () => {
    const refresh = vi.fn(() => null);
    ask({ refresh });
    cancelButton().click();
    await store.change();
    expect(refresh).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it('muestra una lista, un botón sin ícono y otro texto para cerrar', () => {
    ask({
      title: 'Todavía no se puede completar',
      text: '«Informe»: faltan 2 de 4 subtareas:',
      items: ['Revisar cifras', 'Enviar borrador'],
      warning: null,
      confirmLabel: 'Ver subtareas',
      icon: '',
      cancelLabel: 'Cerrar',
      tone: 'primary',
    });
    expect([...dialog.querySelectorAll('.dialog-items li')].map((li) => li.textContent)).toEqual([
      'Revisar cifras',
      'Enviar borrador',
    ]);
    expect(dialog.getAttribute('aria-describedby')).toBe('board-confirm-text board-confirm-items');
    expect(confirmButton().textContent).toBe('Ver subtareas');
    expect(cancelButton().textContent).toBe('Cerrar');
  });

  it('sin lista la oculta, y Cancelar vuelve a su texto', () => {
    ask({ items: ['Uno'], cancelLabel: 'Cerrar' });
    cancelButton().click();
    ask();
    expect(dialog.querySelector('.dialog-items').hidden).toBe(true);
    expect(cancelButton().textContent).toBe('Cancelar');
  });

  it('afterClose se llama con el diálogo ya cerrado, al confirmar y al cancelar', () => {
    const seen = [];
    ask({ afterClose: (confirmed) => seen.push([confirmed, dialog.open]) });
    confirmButton().click();
    ask({ afterClose: (confirmed) => seen.push([confirmed, dialog.open]) });
    cancelButton().click();
    expect(seen).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  it('se puede volver a abrir para otra acción con el botón habilitado', () => {
    ask();
    confirmButton().click();
    const second = ask({ title: '¿Borrar las tareas completadas?', confirmLabel: 'Borrar las completadas' });
    expect(confirmButton().disabled).toBe(false);
    expect(confirmButton().textContent).toBe('🗑️ Borrar las completadas');
    confirmButton().click();
    expect(second.onConfirm).toHaveBeenCalledTimes(1);
  });
});
