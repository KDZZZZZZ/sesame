import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runWorker } from '@sesame/plugin-sdk/transport/worker-client';

const worker = fileURLToPath(new URL('./compiler-process.js', import.meta.url));
const distro = () => process.env.MT5AGENT_WSL_DISTRO ?? 'MT5Agent';
const nodePath = () => process.env.MT5AGENT_WSL_NODE ?? '/usr/local/bin/node';
const wslPath = path => {
  const match = /^([A-Za-z]):\\(.*)$/.exec(path);
  if (!match) throw new Error(`WSL 只支持盘符路径：${path}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
};

let cachedProbe;
let cachedKey;
export function probeWSL() {
  if (process.platform !== 'win32') return { available: false, compiler: false, reason: 'WSL runner 仅用于 Windows' };
  const key = `${distro()}\0${nodePath()}\0${worker}`;
  if (cachedProbe && cachedKey === key) return cachedProbe;
  cachedKey = key;
  try {
    const stdout = execFileSync('wsl.exe', ['--distribution', distro(), '--exec', nodePath(), wslPath(worker), 'probe'], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: 'pipe' });
    cachedProbe = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  } catch (error) {
    cachedProbe = { available: false, compiler: false, reason: (error.stderr?.toString() || error.message).replace(/\0/g, '').trim().split(/\r?\n/).at(-1) || 'WSL 不可用' };
  }
  return cachedProbe;
}

export const runWSL = (action, payload, options) => runWorker('wsl.exe', ['--distribution', distro(), '--exec', nodePath(), wslPath(worker), action], payload, options);
