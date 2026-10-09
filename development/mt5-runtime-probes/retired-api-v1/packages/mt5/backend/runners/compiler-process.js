import { createInterface } from 'node:readline';
import { linuxCompilerDependencies as compilerDependencies, compileInLima, compileInWSL } from '../frozen-compiler.js';

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
if (process.argv[2] === 'probe') {
  const compiler = compilerDependencies(); send({ available: compiler, compiler });
} else {
  const controller = new AbortController();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let requested = false;
  try {
    const payload = await new Promise((resolve, reject) => {
      input.on('line', line => {
        try {
          if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Compiler request exceeds budget');
          const message = JSON.parse(line);
          if (message.type === 'cancel') controller.abort();
          else if (message.type === 'request' && !requested) { requested = true; resolve(message.payload); }
          else throw new Error('Unknown or duplicate compiler message');
        } catch (error) { controller.abort(); reject(error); }
      });
      input.once('close', () => { controller.abort(); if (!requested) reject(new Error('Compiler request was not received')); });
    });
    const compile = { compile: compileInWSL, 'compile-lima': compileInLima }[process.argv[2]];
    if (!compile) throw new Error('Unsupported MT5 compiler action');
    const value = await compile(payload, controller.signal);
    controller.signal.throwIfAborted(); send({ type: 'result', value });
  } catch (error) { send({ type: controller.signal.aborted ? 'canceled' : 'error', code: error.code, message: error.message }); process.exitCode = 1; }
  finally { input.close(); }
}
