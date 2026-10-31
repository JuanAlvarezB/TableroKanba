import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { UsageError, explainError, parseCommand, projectIdFor, usage } from './cli.js';
import { Refusal } from './context.js';
import { connect } from './firebase.js';
import { compareRules, fingerprint } from './rules.js';
import { createTerminal } from './terminal.js';
import { publishedSource, verifyRules } from './verificar-reglas.js';

const RULES = "rules_version = '2';\nservice cloud.firestore {\n  match /x/{id} { allow read: if false; }\n}\n";

describe('huella y comparación de reglas', () => {
  it('la huella es el SHA-256 del texto', () => {
    expect(fingerprint('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('el mismo texto coincide byte a byte', () => {
    expect(compareRules(RULES, RULES)).toMatchObject({ status: 'identical', firstDifference: null });
  });

  it('solo espacios al final o saltos de línea de Windows: mismas reglas', () => {
    const edited = RULES.replace(/\n/g, '  \r\n') + '\n\n';
    const result = compareRules(RULES, edited);
    expect(result.status).toBe('whitespace');
    expect(result.localHash).not.toBe(result.publishedHash);
  });

  it('una regla distinta no coincide e indica la primera línea diferente', () => {
    const published = RULES.replace('if false', 'if true');
    expect(compareRules(RULES, published)).toMatchObject({
      status: 'different',
      firstDifference: {
        line: 3,
        local: '  match /x/{id} { allow read: if false; }',
        published: expect.stringContaining('if true'),
      },
    });
  });

  it('una línea de más en lo publicado también se detecta', () => {
    const result = compareRules(RULES, `${RULES}// añadida en la consola\n`);
    expect(result.status).toBe('different');
    expect(result.firstDifference).toMatchObject({ line: 5, local: null, published: '// añadida en la consola' });
  });

  it('un cambio de sangría al principio de la línea sí cuenta como diferente', () => {
    expect(compareRules(RULES, RULES.replace('  match', 'match')).status).toBe('different');
  });
});

describe('verificar-reglas con el servicio de reglas simulado', () => {
  const ruleset = (content, extra = []) => ({
    name: 'abc-123',
    createTime: '2026-10-24T17:12:00.000Z',
    source: [{ name: 'firestore.rules', content }, ...extra],
  });
  const run = async (published) => {
    const lines = [];
    const code = await verifyRules({
      securityRules: { getFirestoreRuleset: async () => published },
      localRules: RULES,
      label: 'dev (proyecto-demo)',
      log: (line) => lines.push(line),
    });
    return { code, output: lines.join('\n') };
  };

  it('si coinciden termina con 0 e informa las huellas', async () => {
    const { code, output } = await run(ruleset(RULES));
    expect(code).toBe(0);
    expect(output).toContain('✔ Coinciden');
    expect(output).toContain(`sha256 ${fingerprint(RULES)}`);
    expect(output).toContain('abc-123');
  });

  it('si no coinciden termina con 1 y muestra la primera diferencia', async () => {
    const { code, output } = await run(ruleset(RULES.replace('if false', 'if true')));
    expect(code).toBe(1);
    expect(output).toContain('✘ NO coinciden');
    expect(output).toContain('línea 3');
  });

  it('rechaza un conjunto de reglas con varios archivos o ninguno', () => {
    expect(() => publishedSource(ruleset(RULES, [{ name: 'otro.rules', content: '' }]))).toThrow('2 archivos');
    expect(() => publishedSource({ source: [] })).toThrow('0 archivos');
  });
});

describe('argumentos y ambiente', () => {
  const commands = {
    'verificar-reglas': {},
    respaldar: { required: ['admin', 'correo'], writes: true },
    'verificar-indice': { required: ['admin'], optional: ['uid'] },
  };

  it('lee el comando y el ambiente; sin --aplicar, simula', () => {
    expect(parseCommand(['verificar-reglas', '--ambiente', 'pdn'], commands)).toEqual({
      command: 'verificar-reglas',
      ambiente: 'pdn',
      aplicar: false,
    });
  });

  it('lee las opciones del comando, sin espacios alrededor, y --aplicar', () => {
    const argv = ['respaldar', '--ambiente', 'dev', '--admin', ' admin@ejemplo.test ', '--correo', 'p@ejemplo.test'];
    expect(parseCommand([...argv, '--aplicar'], commands)).toEqual({
      command: 'respaldar',
      ambiente: 'dev',
      aplicar: true,
      admin: 'admin@ejemplo.test',
      correo: 'p@ejemplo.test',
    });
    expect(
      parseCommand(['verificar-indice', '--ambiente', 'dev', '--admin', 'a@ejemplo.test'], commands),
    ).not.toHaveProperty('uid');
  });

  it.each([
    [[], 'Falta el comando'],
    [['borrar-todo', '--ambiente', 'dev'], 'Comando desconocido'],
    [['toString', '--ambiente', 'dev'], 'Comando desconocido'],
    [['verificar-reglas'], '--ambiente dev o --ambiente pdn'],
    [['verificar-reglas', '--ambiente', 'qa'], '--ambiente dev o --ambiente pdn'],
    [['verificar-reglas', '--ambiente', 'dev', 'extra'], 'Sobran argumentos'],
    [['verificar-reglas', '--ambiente', 'dev', '--aplicar'], 'aplicar'],
    [['verificar-indice', '--ambiente', 'dev', '--admin', 'a@ejemplo.test', '--aplicar'], 'no admite --aplicar'],
    [['respaldar', '--ambiente', 'dev', '--admin', 'a@ejemplo.test'], 'Falta --correo'],
    [['respaldar', '--ambiente', 'dev', '--admin', 'a@ejemplo.test', '--correo', '  '], 'Falta --correo'],
    [['verificar-indice', '--ambiente', 'dev', '--admin', 'a@ejemplo.test', '--correo', 'x'], 'no usa --correo'],
    [['respaldar', '--ambiente', 'dev', '--frase', 'secreta'], 'frase'],
  ])('%j es un uso incorrecto', (argv, message) => {
    expect(() => parseCommand(argv, commands)).toThrow(UsageError);
    expect(() => parseCommand(argv, commands)).toThrow(message);
  });

  it('toma el proyecto del alias de .firebaserc', () => {
    const firebaserc = { projects: { dev: 'proyecto-dev', pdn: 'proyecto-pdn' } };
    expect(projectIdFor('dev', firebaserc)).toBe('proyecto-dev');
    expect(() => projectIdFor('pdn', { projects: {} })).toThrow(UsageError);
  });

  it('se niega a usar un archivo de llave', () => {
    expect(() => connect('proyecto-dev', { GOOGLE_APPLICATION_CREDENTIALS: '/ruta/llave.json' })).toThrow(
      'no usa archivos de llave',
    );
  });

  it.each([
    [new Error('Could not load the default credentials.'), 'gcloud auth application-default login'],
    [new Error('requires a quota project, which is not set'), 'set-quota-project proyecto-dev'],
    [
      Object.assign(new Error('Caller does not have permission'), { code: 'security-rules/permission-denied' }),
      'no tiene permiso',
    ],
    [Object.assign(new Error('x'), { code: 'security-rules/not-found' }), 'no tiene reglas'],
    [new Error('algo raro'), 'algo raro'],
  ])('explica el error %#', (error, message) => {
    expect(explainError(error, 'proyecto-dev')).toContain(message);
  });

  it('nombra la operación que falló, y "no encontrado" solo habla de reglas al leerlas', () => {
    const denied = Object.assign(new Error('x'), { code: 'auth/insufficient-permission' });
    expect(explainError(denied, 'proyecto-dev', 'consultar Authentication')).toBe(
      'Tu cuenta de Google no tiene permiso para consultar Authentication en proyecto-dev (necesita un rol en ese proyecto).',
    );
    const missing = Object.assign(new Error('NOT_FOUND: no existe'), { code: 5 });
    expect(explainError(missing, 'proyecto-dev', 'ejecutar respaldar')).toBe(
      'No se pudo ejecutar respaldar en proyecto-dev: NOT_FOUND: no existe',
    );
  });

  it('la ayuda lista cada comando con sus opciones', () => {
    const text = usage(commands);
    expect(text).toContain('respaldar --admin <tu correo> --correo <correo> [--aplicar]');
    expect(text).toContain('verificar-indice --admin <tu correo> [--uid <uid>]');
  });
});

describe('terminal', () => {
  // Terminal simulada: lo que se teclea entra por input; lo que se ve en pantalla queda en shown.
  function fakeTty({ isTTY = true } = {}) {
    const input = Object.assign(new PassThrough(), { isTTY, rawModes: [] });
    input.setRawMode = (mode) => input.rawModes.push(mode);
    const screen = { shown: '', write: (text) => (screen.shown += text) };
    return { input, screen, terminal: createTerminal(input, screen) };
  }

  it('la frase no se ve al teclearla; borrar y Enter funcionan, y las flechas se ignoran', async () => {
    const { input, screen, terminal } = fakeTty();
    const answer = terminal.askHidden('Frase: ');
    input.write('secreta1x\u007f2');
    input.write('\u001b[A');
    input.write('3\r');
    expect(await answer).toBe('secreta123');
    expect(screen.shown).toBe('Frase: \n');
    expect(input.rawModes).toEqual([true, false]);
  });

  it('una respuesta visible se muestra al teclearla', async () => {
    const { input, screen, terminal } = fakeTty();
    const answer = terminal.ask('Proyecto: ');
    input.write('demo\r');
    expect(await answer).toBe('demo');
    expect(screen.shown).toBe('Proyecto: demo\n');
  });

  it('Ctrl+C cancela sin respuesta', async () => {
    const { input, terminal } = fakeTty();
    const answer = terminal.askHidden('Frase: ');
    input.write('abc\u0003');
    await expect(answer).rejects.toThrow(Refusal);
  });

  it('no acepta respuestas por tubería: hay que teclearlas', async () => {
    const { terminal, screen } = fakeTty({ isTTY: false });
    await expect(terminal.askHidden('Frase: ')).rejects.toThrow('se teclea en la terminal');
    expect(screen.shown).toBe('');
  });
});
