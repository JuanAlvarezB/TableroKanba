// Mensajes breves que se ocultan solos (avisos del tablero y anuncios de cambios).

const MESSAGE_DURATION = 3000;

export function createFlasher() {
  const timeouts = new Map();
  // Muestra el mensaje en el elemento indicado y lo oculta pasados MESSAGE_DURATION ms.
  return function flash(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
    clearTimeout(timeouts.get(element));
    timeouts.set(
      element,
      setTimeout(() => element.classList.add('hidden'), MESSAGE_DURATION),
    );
  };
}
