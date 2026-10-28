// Lista de personas autorizadas de la página de usuarios: tabla en escritorio y tarjetas en celular
// (ver usuarios.css). Cada fila muestra nombre, correo, rol y estado, nunca tareas ni uid, y sus
// acciones en un menú operable con teclado. La fila propia aparece como "Tú" y sin acciones.

const ROLE_LABELS = { admin: 'Administrador', member: 'Miembro' };

// Estado con icono y texto: nunca solo con color.
const LIFECYCLE_LABELS = {
  active: ['●', 'Activo'],
  inactive: ['○', 'Inactivo'],
  deleting: ['⚠', 'En eliminación'],
};

export const ACTION_LABELS = {
  deactivate: 'Desactivar',
  reactivate: 'Reactivar',
  promote: 'Dar rol de administrador',
  demote: 'Quitar rol de administrador',
};

/**
 * Acciones de una fila según su estado. La eliminación llega con su propio flujo (PR 4b).
 * @param {import('../state/usersStore.js').UserRow} row
 * @returns {(keyof typeof ACTION_LABELS)[]}
 */
export function actionsFor({ user, lifecycle, self }) {
  if (self || lifecycle === 'deleting') return [];
  if (lifecycle === 'inactive') return user.role === 'admin' ? ['reactivate', 'demote'] : ['reactivate'];
  return user.role === 'admin' ? ['demote', 'deactivate'] : ['promote', 'deactivate'];
}

export const displayedName = (user) => user.name || user.email;

function initials(name) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return letters || '?';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Etiqueta con un prefijo solo para el lector de pantalla ("Rol: Miembro"), porque la cabecera de
// columnas es visual.
function tag(kind, label, prefix, icon) {
  const node = element('span', `tag ${kind}`);
  node.append(element('span', 'visually-hidden', `${prefix}: `));
  if (icon) {
    const mark = element('span', 'tag-icon', icon);
    mark.setAttribute('aria-hidden', 'true');
    node.append(mark);
  }
  node.append(label);
  return node;
}

/**
 * @param {HTMLElement} container Lista (ul) donde van las filas.
 * @param {{ onAction: (action: string, user: import('../../domain/entities/User.js').AllowedUser, opener: HTMLElement) => void }} handlers
 */
export function createUserList(container, { onAction }) {
  let openMenu = null;

  function closeMenu({ focusToggle = false } = {}) {
    if (!openMenu) return;
    const { menu, toggle } = openMenu;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    openMenu = null;
    if (focusToggle) toggle.focus();
  }

  function openMenuFor(menu, toggle, focusLast = false) {
    closeMenu();
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    openMenu = { menu, toggle };
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    (focusLast ? items.at(-1) : items[0]).focus();
  }

  // Menú de acciones: flechas, Inicio y Fin recorren las opciones; Esc lo cierra y devuelve el foco
  // al botón; Tab lo cierra.
  function createMenu(row, actions) {
    const { user } = row;
    const cell = element('div', 'row-actions');
    const menuId = `acciones-${user.email.replace(/[^a-z0-9]/gi, '-')}`;

    const toggle = element('button', 'pill-btn row-toggle');
    toggle.type = 'button';
    toggle.append('Acciones');
    const caret = element('span', 'caret', '▾');
    caret.setAttribute('aria-hidden', 'true');
    toggle.append(' ', caret);
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', menuId);
    toggle.setAttribute('aria-label', `Acciones para ${displayedName(user)}`);
    toggle.dataset.focusKey = user.email;

    const menu = element('div', 'row-menu');
    menu.id = menuId;
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Acciones para ${displayedName(user)}`);

    actions.forEach((action) => {
      const item = element('button', action === 'deactivate' ? 'danger' : '', ACTION_LABELS[action]);
      item.type = 'button';
      item.tabIndex = -1;
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', () => {
        closeMenu();
        onAction(action, user, toggle);
      });
      menu.append(item);
    });

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu?.menu === menu) closeMenu();
      else openMenuFor(menu, toggle);
    });
    toggle.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenuFor(menu, toggle, event.key === 'ArrowUp');
      }
    });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      const moves = {
        ArrowDown: (index + 1) % items.length,
        ArrowUp: (index - 1 + items.length) % items.length,
        Home: 0,
        End: items.length - 1,
      };
      if (event.key in moves) {
        event.preventDefault();
        items[moves[event.key]].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu({ focusToggle: true });
      } else if (event.key === 'Tab') {
        closeMenu();
      }
    });

    cell.append(toggle, menu);
    return cell;
  }

  function createRow(row) {
    const { user, lifecycle, self } = row;
    const item = element('li', 'user-row');

    const person = element('div', 'person');
    const avatar = element('span', 'avatar', initials(displayedName(user)));
    avatar.setAttribute('aria-hidden', 'true');
    const text = element('div', 'person-text');
    const name = element('div', 'person-name', displayedName(user));
    if (self) name.append(' ', element('span', 'you', 'Tú'));
    text.append(name, element('div', 'person-email', user.email));
    person.append(avatar, text);

    const role = element('div', 'user-role');
    role.append(tag(user.role, ROLE_LABELS[user.role], 'Rol'));

    const state = element('div', 'user-state');
    const [icon, label] = LIFECYCLE_LABELS[lifecycle];
    state.append(tag(lifecycle, label, 'Estado', icon));
    if (!user.uid) state.append(element('span', 'state-note', 'Nunca ha entrado'));

    const actions = actionsFor(row);
    let cell;
    if (self) {
      cell = element('div', 'row-actions row-note');
      cell.append(element('span', 'self-note', 'No puedes cambiar tu propio rol ni estado.'));
    } else if (actions.length === 0) {
      cell = element('div', 'row-actions row-note');
      cell.append(element('span', 'self-note', 'Sin acciones mientras está en eliminación.'));
    } else {
      cell = createMenu(row, actions);
    }

    item.append(person, role, state, cell);
    return item;
  }

  document.addEventListener('click', (event) => {
    if (openMenu && !openMenu.menu.contains(event.target)) closeMenu();
  });

  return {
    /**
     * Vuelve a dibujar las filas. Si el foco estaba en el botón de acciones de una persona, vuelve
     * al de la fila nueva, para no perderlo cuando la lista cambia en vivo.
     * @param {import('../state/usersStore.js').UserRow[]} rows
     */
    render(rows) {
      const focusKey = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      closeMenu();
      container.replaceChildren(...rows.map(createRow));
      if (focusKey) this.focusActions(focusKey);
    },

    // Pone el foco en el botón de acciones de esa persona, si sigue en la lista.
    focusActions(email) {
      const toggle = [...container.querySelectorAll('[data-focus-key]')].find(
        (node) => node.dataset.focusKey === email,
      );
      toggle?.focus();
    },
  };
}
