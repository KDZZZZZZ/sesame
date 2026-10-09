import { spawn, execFileSync } from 'node:child_process';
import { installation, compilerDependencies } from '../backend/native.js';
import { wineCommand, wineEnvironment, terminalInvocation } from '../backend/platform.js';

const native = installation();
const command = process.argv[2] ?? 'doctor';
if (!['doctor', 'terminal', 'editor'].includes(command)) throw new Error('Usage: node scripts/mt5.mjs doctor|terminal|editor');
if (command === 'doctor') {
  let wine = null;
  if (process.platform !== 'win32') {
    try { wine = execFileSync(wineCommand(), ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch {}
  }
  const compiler = compilerDependencies();
  console.log(JSON.stringify({ installed: Boolean(native), compiler, wine, directory: native?.directory ?? null, terminal: native?.terminal ?? null, editor: native?.editor ?? null }, null, 2));
  if (!native || !compiler || (process.platform !== 'win32' && !wine)) process.exitCode = 1;
} else {
  if (!native) throw new Error('MT5 未安装；可用 MT5AGENT_MT5_DIR 指定安装目录。');
  const args = [command === 'terminal' ? native.terminal : native.editor, ...process.argv.slice(3)];
  const env = wineEnvironment(native.directory);
  const { program, args: flags } = terminalInvocation(args[0], args.slice(1), env);
  const child = spawn(program, flags, { stdio: 'inherit', env });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
