// Piso de reglas (docs/PLAN_AMBIENTES.md, F.3 y P-8): firestore.rules nunca puede bajar de lo que exigen los
// datos que ya existen en PDN. Revertir el merge de una función revierte también firestore.rules, y el pipeline
// publicaría unas reglas cuyo hasOnly rechaza las tareas que ya tienen ese campo. Esta prueba vive en su propio
// archivo, que ningún PR de funcionalidad toca: un Revert no la revierte y falla en revisar y en test antes de
// publicar nada.
//
// Subir el piso (un campo nuevo que ya existe en datos de PDN): un PR aparte, cuando la función está estable,
// agrega su marcador. Bajarlo (abandonar una función): un PR que lo quita, explica por qué y limpia antes los
// datos con el script administrativo. README, "Volver a las reglas anteriores".
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RULES = readFileSync(resolve(import.meta.dirname, '..', '..', 'firestore.rules'), 'utf-8');

const FLOOR = [
  { marker: "'ownerId', 'history'", why: 'tareas con historial en PDN (A-41)' },
  { marker: '&& isHistory(data)', why: 'tareas con historial en PDN (A-41)' },
  { marker: "'history', 'subtasks', 'openSubtasks'", why: 'tareas con subtareas en PDN (AT-5)' },
  { marker: '&& isSubtasks(data)', why: 'tareas con subtareas en PDN (AT-5)' },
  { marker: 'match /taskIndex/', why: 'índice de tareas (PLAN_USUARIOS 2.6)' },
  { marker: 'hasOwnIndexAfter', why: 'índice estricto (PLAN_USUARIOS 2.6)' },
  { marker: 'function boardOn', why: 'permisos por función guardados en allowedUsers' },
];

describe('piso de firestore.rules', () => {
  it.each(FLOOR)('conserva $marker ($why)', ({ marker, why }) => {
    expect(
      RULES.includes(marker),
      `firestore.rules no tiene "${marker}" (${why}). Publicarlas rechazaría tareas que ya existen en PDN: ` +
        'README, "Volver a las reglas anteriores".',
    ).toBe(true);
  });
});
