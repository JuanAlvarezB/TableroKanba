// Preguntas en la terminal (docs/PLAN_USUARIOS.md, 2.11). La confirmación de PDN y la frase de cifrado se
// teclean en el momento: no llegan por argumento ni por tubería, y la frase no se muestra ni se guarda.
import { Refusal } from './context.js';

const ENTER = new Set(['\r', '\n']);
const CANCEL = new Set(['\u0003', '\u0004']); // Ctrl+C y Ctrl+D
const ERASE = new Set(['\u007f', '\b']);

/**
 * @param {NodeJS.ReadStream} [input]
 * @param {NodeJS.WriteStream} [output] Las preguntas van a stderr para que la salida del informe se
 *   pueda guardar aparte.
 */
export function createTerminal(input = process.stdin, output = process.stderr) {
  // Lee una línea en modo crudo; con echo = false no se ve lo que se teclea.
  function read(question, echo) {
    if (!input.isTTY) {
      return Promise.reject(new Refusal('Esta respuesta se teclea en la terminal; no se puede pasar por tubería.'));
    }
    output.write(question);
    return new Promise((resolve, reject) => {
      let text = '';
      const finish = (settle) => {
        input.off('data', onData);
        input.setRawMode(false);
        input.pause();
        output.write('\n');
        settle();
      };
      const onData = (chunk) => {
        // Flechas y otras teclas especiales llegan como secuencias de escape: se ignoran.
        if (chunk.startsWith('\u001b')) return;
        for (const char of chunk) {
          if (ENTER.has(char)) return finish(() => resolve(text));
          if (CANCEL.has(char)) return finish(() => reject(new Refusal('Cancelado.')));
          if (ERASE.has(char)) {
            if (text && echo) output.write('\b \b');
            text = [...text].slice(0, -1).join('');
          } else if (char >= ' ') {
            text += char;
            if (echo) output.write(char);
          }
        }
      };
      input.setEncoding('utf8');
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
    });
  }

  return {
    /** @param {string} question */
    ask: (question) => read(question, true),
    /** @param {string} question */
    askHidden: (question) => read(question, false),
  };
}
