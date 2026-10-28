// Script administrativo local de LUCAS (docs/PLAN_USUARIOS.md, 2.11). Vive fuera de src/: no se
// empaqueta con el sitio ni se despliega. Es la única pieza que usa el Admin SDK, con las credenciales de
// Google de quien lo ejecuta y sin llaves. Uso: npm run admin -- <comando> --ambiente dev|pdn [opciones]
//
// Comandos (los que escriben solo simulan sin --aplicar; en PDN piden además el identificador del proyecto):
//   verificar-reglas   Compara las reglas de Firestore publicadas con firestore.rules (solo lee).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { BackupError } from './backup.js';
import { UsageError, explainError, parseCommand, projectIdFor, usage } from './cli.js';
import { Refusal } from './context.js';
import { connect } from './firebase.js';
import { createStore } from './store.js';
import { createTerminal } from './terminal.js';
import { verifyRules } from './verificar-reglas.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

// Fuera del repositorio (2.11): una subcarpeta por ambiente.
const BACKUP_DIR = join(homedir(), 'Documents', 'lucas-respaldos');

/** @type {Record<string, import('./cli.js').CommandSpec & { run?: Function, local?: boolean }>} */
const COMMANDS = {
  'verificar-reglas': {},
};

async function main(argv) {
  let options;
  let projectId;
  try {
    options = parseCommand(argv, COMMANDS);
    projectId = projectIdFor(options.ambiente, JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf-8')));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n${usage(COMMANDS)}`);
    return 2;
  }

  const { run, writes, local } = COMMANDS[options.command];
  const label = `${options.ambiente} (${projectId})`;
  const log = (line) => console.log(line);
  try {
    if (!run) {
      return await verifyRules({
        securityRules: getSecurityRules(connect(projectId)),
        localRules: readFileSync(resolve(ROOT, 'firestore.rules'), 'utf-8'),
        label,
        log,
      });
    }
    const mode = options.aplicar ? 'APLICAR: escribe' : 'simulación: no escribe nada';
    log(`Ambiente: ${label}${writes ? ` · ${mode}` : ''}`);
    return await run({
      options,
      projectId,
      store: local ? null : createStore(connect(projectId)),
      terminal: createTerminal(),
      log,
      now: Date.now,
      backupDir: BACKUP_DIR,
    });
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(`✘ ${error.message}`);
      return 1;
    }
    if (error instanceof BackupError) {
      console.error(`✘ ${error.message}`);
      return 2;
    }
    console.error(`✘ ${explainError(error, projectId, run ? `ejecutar ${options.command}` : undefined)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
