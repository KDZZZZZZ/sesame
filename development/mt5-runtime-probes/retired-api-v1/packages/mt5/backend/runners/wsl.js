import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runWorker } from '@sesame/plugin-sdk/transport/worker-client';

const worker = fileURLToPath(new URL('./compiler-process.js', import.meta.url));
const distro = config => config?.instance || process.env.MT5AGENT_WSL_DISTRO || 'MT5Agent';
const nodePath = config => config?.node || process.env.MT5AGENT_WSL_NODE || '/usr/bin/node';
const wslPath = path => {
  const match = /^([A-Za-z]):\\(.*)$/.exec(path);
  if (!match) throw new Error(`WSL 只支持盘符路径：${path}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
};

let cachedProbe;
let cachedKey;
export function probeWSL(config = {}) {
  if (process.platform !== 'win32') return { available: false, compiler: false, reason: 'WSL runner 仅用于 Windows' };
  if (!config?.instance && !process.env.MT5AGENT_WSL_DISTRO) return { available: false, compiler: false, reason: '尚未选择已安装的 WSL 编译发行版；先读取按需依赖 skill' };
  const key = JSON.stringify([distro(config), nodePath(config), config, worker]);
  if (cachedProbe && cachedKey === key) return cachedProbe;
  cachedKey = key;
  try {
    const stdout = execFileSync('wsl.exe', ['--distribution', distro(config), '--exec', nodePath(config), config?.worker || wslPath(worker), 'probe'], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: 'pipe' });
    cachedProbe = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  } catch (error) {
    cachedProbe = { available: false, compiler: false, reason: (error.stderr?.toString() || error.message).replace(/\0/g, '').trim().split(/\r?\n/).at(-1) || 'WSL 不可用' };
  }
  return cachedProbe;
}

export const runWSL = (action, payload, options, config = {}) => runWorker('wsl.exe', ['--distribution', distro(config), '--exec', nodePath(config), config?.worker || wslPath(worker), action], payload, options);
