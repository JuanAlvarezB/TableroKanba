// Diálogo modal accesible compartido por las páginas autenticadas de LUCAS (zona de cuenta y
// gestión de usuarios), con sus botones. Se extrajo de AccountMenu.js sin cambiar su comportamiento.

export function createButton(text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

// Ventana modal accesible: Esc, Cancelar o tocar fuera la cierran, y el foco vuelve al
// control que la abrió. El contenido va en un envoltorio para distinguir el clic en el fondo.
export function createDialog(id, titleText) {
  const dialog = document.createElement('dialog');
  dialog.className = 'lucas-dialog';
  dialog.setAttribute('aria-labelledby', `${id}-title`);

  const body = document.createElement('div');
  body.className = 'dialog-body';
  const title = document.createElement('h2');
  title.id = `${id}-title`;
  title.className = 'dialog-title';
  title.textContent = titleText;
  body.append(title);
  dialog.append(body);

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  let returnFocus = null;
  dialog.addEventListener('close', () => {
    if (returnFocus) returnFocus.focus();
  });

  document.body.append(dialog);
  return {
    dialog,
    body,
    open(opener, focusTarget) {
      returnFocus = opener;
      dialog.showModal();
      focusTarget.focus();
    },
  };
}
