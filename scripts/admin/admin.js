// Script administrativo local de LUCAS (docs/PLAN_USUARIOS.md, 2.11). Vive fuera de src/: no se
// empaqueta con el sitio ni se despliega. Uso: npm run admin -- <comando> --ambiente dev|pdn
//
// Comandos:
//   verificar-reglas  Compara las reglas de Firestore publicadas con firestore.rules (solo lee).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { UsageError, explainError, parseCommand, projectIdFor } from './cli.js';
import { connect } from './firebase.js';
import { verifyRules } from './verificar-reglas.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const COMMANDS = ['verificar-reglas'];
const USAGE = `Uso: npm run admin -- <comando> --ambiente dev|pdn\nComandos: ${COMMANDS.join(', ')}`;

async function main(argv) {
  let options;
  let projectId;
  try {
    options = parseCommand(argv, COMMANDS);
    projectId = projectIdFor(options.ambiente, JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf-8')));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }

  try {
    return await verifyRules({
      securityRules: getSecurityRules(connect(projectId)),
      localRules: readFileSync(resolve(ROOT, 'firestore.rules'), 'utf-8'),
      label: `${options.ambiente} (${projectId})`,
      log: (line) => console.log(line),
    });
  } catch (error) {
    console.error(explainError(error, projectId));
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
