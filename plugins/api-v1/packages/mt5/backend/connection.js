import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError, requireValue } from './support.js';

const proxyKeys = ['ProxyEnable', 'ProxyType', 'ProxyAddress', 'ProxyLogin', 'ProxyPassword'];

// Only network settings may cross into the isolated Tester. Never copy user
// [Experts], [StartUp], [Tester], account overrides, or MCP listener settings.
export function proxySettings(ini = '') {
  const result = {}; let common = false;
  for (const line of ini.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const text = line.trim(), section = /^\[([^\]]+)\]$/.exec(text);
    if (section) { common = section[1].toLowerCase() === 'common'; continue; }
    if (!common || /^[;#]/.test(text)) continue;
    const match = /^([^=]+)=(.*)$/.exec(text);
    const key = match && proxyKeys.find(k => k.toLowerCase() === match[1].trim().toLowerCase());
    if (key) result[key] = match[2].trim();
  }
  return result;
}

export function testerProxyLines(ini) {
  const settings = { ProxyEnable: '0', ...proxySettings(ini) };
  requireValue(['0', '1'].includes(settings.ProxyEnable), 'MT5 代理 ProxyEnable 必须为 0 或 1');
  if (settings.ProxyEnable === '0') return ['ProxyEnable=0'];
  requireValue(['1', '2'].includes(settings.ProxyType), 'MT5 代理需要明确配置 SOCKS5（1）或 HTTP（2）');
  requireValue(/^(?:\[[\da-fA-F:]+\]|[^\s:/\\]+):\d{1,5}$/.test(settings.ProxyAddress ?? '') && Number(settings.ProxyAddress.split(':').at(-1)) > 0 && Number(settings.ProxyAddress.split(':').at(-1)) <= 65535, 'MT5 代理地址必须为 host:port');
  requireValue(Object.values(settings).every(value => !value.includes('\0')), 'MT5 代理配置不能包含 NUL');
  return proxyKeys.filter(key => settings[key] !== undefined).map(key => `${key}=${settings[key]}`);
}

// Retry only this read-only readiness check. A transient network/IPC error
// must not launch an unsynchronized Tester or replay a trading operation.
export async function waitForTradingConnection(client, account, { signal, timeout = 90000, delay = 1000, progress = () => {} } = {}) {
  const deadline = AbortSignal.timeout(timeout);
  const combined = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
  let attempt = 0;
  while (!combined.aborted) {
    try {
      const result = await client.call('get_trading_account_info', {}, combined);
      if (!result.isError) {
        const data = result.structuredContent ?? JSON.parse(result.content?.find(p => p.type === 'text')?.text ?? '{}');
        if (data.terminal?.server_connected === true) {
          requireValue(String(data.account?.login) === String(account.login) && data.account?.server === account.server, '主终端当前账户与回测账户不一致，请先连接已配置的账户', 409, 'mt5_account_mismatch');
          return data;
        }
      }
    } catch (error) {
      if (error.code === 'mt5_account_mismatch') throw error;
      // Native MCP invalidates stale sessions; the next read can initialize again.
    }
    if (combined.aborted) break;
    progress('等待 MT5 券商连接恢复，尚未启动回测');
    try { await sleep(Math.min(delay * 2 ** Math.min(attempt++, 4), 10000), undefined, { signal: combined }); }
    catch { break; }
  }
  signal?.throwIfAborted();
  throw new ApiError(503, 'mt5_connection_unavailable', 'MT5 券商连接在等待期内未恢复；请检查主终端及原生代理配置，恢复后可重新发起回测');
}
