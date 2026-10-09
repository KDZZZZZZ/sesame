import { promises as fs } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { winePrefix } from './platform.js';
import { requireValue } from './support.js';
import { testerProxyLines, waitForTradingConnection } from './connection.js';
import { controlTerminal, launch, winePath } from './process.js';
import { nativeData } from './market.js';
import { setTimeout as sleep } from 'node:timers/promises';

export function terminalConfig(config, enabled) {
  const { login, server, password } = config.account;
  requireValue(/^\d+$/.test(String(login)) && server && [server, password ?? ''].every(v => !/[\r\n\0]/.test(v)), '账户配置无效');
  return ['[Common]', `Login=${login}`, `Server=${server}`, ...(password ? [`Password=${password}`] : []), 'KeepPrivate=1', ...testerProxyLines(config.startup_ini),
    '[Experts]', `Enabled=${enabled ? 1 : 0}`, `AllowLiveTrading=${enabled ? 1 : 0}`, 'AllowDllImport=0', 'Account=1', 'Profile=1', ''].join('\r\n');
}

export function terminalStartupDiagnostic(log, file) {
  const expected = winePath(file).toLowerCase();
  return {
    managedConfigInitialized: log.split(/\r?\n/).some(line => /successfully initialized from start config/i.test(line) && line.toLowerCase().includes(expected)),
    competingStartupObserved: /terminal process already started/i.test(log) || log.split(/\r?\n/).some(line => /cannot load config/i.test(line) && !line.toLowerCase().includes(expected)),
  };
}
async function startupLog(directory, offsets) {
  let text = '';
  for (const name of (await fs.readdir(directory)).filter(name => /^\d{8}\.log$/.test(name)).sort().slice(-2)) {
    const file = join(directory, name), handle = await fs.open(file, 'r');
    try {
      const size = (await handle.stat()).size, from = Math.max(offsets.get(name) ?? 0, size - 65536);
      const bytes = Buffer.alloc(Math.max(0, size - from));
      await handle.read(bytes, 0, bytes.length, from);
      text += bytes.toString('utf16le') + '\n' + bytes.toString('utf8');
    } finally { await handle.close(); }
  }
  return text;
}

async function localPath(path, native) {
  if (process.platform === 'win32') return path;
  requireValue(/^[cC]:\\/.test(path) && !path.split(/[\\/]/).includes('..'), '自动配置需要本机 Wine C 盘终端');
  let current = join(winePrefix(native), 'drive_c');
  // Native chart paths are often uppercased; Linux filesystems are case-sensitive.
  for (const part of path.slice(3).split(/[\\/]/).filter(Boolean)) {
    const name = (await fs.readdir(current)).find(name => name.toLowerCase() === part.toLowerCase());
    requireValue(name, '终端数据目录无法定位', 409); current = join(current, name);
  }
  return current;
}

/** Configure only an idle, precisely identified terminal; never force-kill or place a trade. */
export async function prepareTerminal(mt5, progress = () => {}, { restart = false, deployment = null, inputs = null } = {}, { control = controlTerminal, start = launch, wait = waitForTradingConnection, resolveNativePath = localPath } = {}) {
  const official = mt5.official, config = structuredClone(official.config);
  const { info, scope } = await mt5.market.connected();
  requireValue(info.terminal.mcp_trade_allowed === true, '原生 MCP 交易授权尚未就绪，自动准备未完成', 409, 'mcp_trading_not_authorized');
  // `restart` re-reads the program list after a frozen build is staged; the idle checks below still apply.
  if (deployment) {
    requireValue(deployment.status === 'preparing' && deployment.login === scope.login && deployment.server === scope.server
      && /^deploy_[\w-]+$/.test(deployment.id) && /^build_[\w-]+$/.test(deployment.build_id)
      && inputs?.Product_RunId === deployment.id && inputs.Product_EnableLive === true, '受管理挂载配置无效', 409);
  }
  if (info.terminal.experts_trade_allowed === true && !restart && !deployment) return { restarted: false, verified: true };
  requireValue(!mt5.tester.pending.size && !official.jobs.size && !mt5.deployments.list().some(d => d.id !== deployment?.id && ['running', 'attaching', 'preparing', 'unknown'].includes(d.status)), '有终端任务正在运行，暂不重启', 409);
  const client = official.client('terminal');
  const open = nativeData(await client.call('get_trading_open_positions', {}));
  requireValue(Array.isArray(open.positions) && Array.isArray(open.orders) && !open.positions.length && !open.orders.length, '账户仍有持仓或挂单，自动配置暂不重启终端', 409);
  const charts = nativeData(await client.call('list_open_charts', {}));
  requireValue(Array.isArray(charts.charts), '无法核对原生图表', 502);
  // Inspect native chart files as well: older MCP responses may omit attached EA metadata.
  for (const chart of charts.charts) {
    requireValue(!chart.expert && !chart.expert_advisor && !chart.experts?.length && chart.path, '已有 EA 在运行，自动配置暂不重启终端', 409);
    const bytes = await fs.readFile(await resolveNativePath(chart.path, mt5.native));
    requireValue(bytes.length <= 1024 * 1024, '图表配置超出读取限制');
    const text = bytes.toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8');
    requireValue(!/<expert\b|\[expert\]/i.test(text), '已有 EA 在图表中，自动配置暂不启用全局交易', 409);
  }
  const workspace = nativeData(client.workspace).workspace;
  const dataDirectory = await resolveNativePath(win32.dirname(workspace.mql5_folder), mt5.native);
  const portable = resolve(dataDirectory).toLowerCase() === resolve(mt5.native.directory).toLowerCase();
  await control(mt5.native, 'inspect');
  const file = join(mt5.storage.directory, 'mt5', 'managed-terminal.ini');
  let preset = null, startup = '';
  if (deployment) {
    requireValue(/^[^\r\n=\0]+$/.test(deployment.symbol) && /^[A-Z][A-Z0-9]*$/.test(deployment.period), '挂载品种或周期无效');
    for (const [key, value] of Object.entries(inputs)) requireValue(/^[A-Za-z][\w]*$/.test(key) && !/[\r\n\0]/.test(String(value)), '挂载参数无效');
    preset = join(dataDirectory, 'MQL5/Presets', `${deployment.id}.set`);
    await fs.mkdir(join(dataDirectory, 'MQL5/Presets'), { recursive: true });
    await fs.writeFile(preset, Buffer.from('\uFEFF' + Object.entries(inputs).map(([k, v]) => `${k}=${v}`).join('\r\n') + '\r\n', 'utf16le'), { mode: 0o600 });
    // Official StartUp preserves per-EA AllowLiveTrading. MCP chart_add_expert
    // in build 6230 attaches with MQL_TRADE_ALLOWED=false even when the terminal
    // is enabled. This opens one new, non-persistent chart, never a user's chart.
    startup = ['[StartUp]', `Expert=MT5Agent\\${deployment.build_id}`, `ExpertParameters=${deployment.id}.set`, `Symbol=${deployment.symbol}`, `Period=${deployment.period}`, ''].join('\r\n');
  }
  await fs.writeFile(file, terminalConfig(config, true) + startup, { mode: 0o600 }); await fs.chmod(file, 0o600);
  const resetClient = () => { official.clients.get('terminal')?.close(); official.clients.delete('terminal'); return official.client('terminal'); };
  requireValue(!mt5.terminalPreparing, '已有终端准备正在执行', 409, 'terminal_preparing');
  mt5.terminalPreparationEpoch = (mt5.terminalPreparationEpoch ?? 0) + 1;
  mt5.terminalPreparing = true;
  let closed = false;
  const logDirectory = join(dataDirectory, 'logs'), logOffsets = new Map();
  try { for (const name of await fs.readdir(logDirectory)) if (/^\d{8}\.log$/.test(name)) logOffsets.set(name, (await fs.stat(join(logDirectory, name))).size); } catch {}
  try {
    progress('restarting');
    await control(mt5.native, 'close'); closed = true;
    resetClient();
    await start({ ...mt5.native, commonFolder: workspace.common_folder }, 'start_terminal', { portable, use_startup_config: true }, file, {});
    progress('reconnecting');
    const ready = await wait(official.client('terminal'), scope, { timeout: 90000 });
    if (ready.terminal.experts_trade_allowed !== true || ready.terminal.mcp_trade_allowed !== true) {
      let evidence = null;
      try { evidence = terminalStartupDiagnostic(await startupLog(logDirectory, logOffsets), file); } catch {}
      const reason = evidence?.competingStartupObserved ? '；原生日志发现竞争启动或另一配置启动，请关闭其它 Sesame 自动连接实例后重新授权准备' : '；请核对原生启动配置和账户/综合配置切换保护';
      requireValue(false, '终端已重连，但算法交易配置未生效' + reason, 409, 'native_config_not_applied');
    }
    if (deployment) {
      let chartId;
      for (let attempt = 0; attempt < 40; attempt++) {
        const events = await mt5.deployments.readTrace(deployment);
        chartId = events.find(e => e.node_id === 'platform.permissions')?.value?.chart_id;
        if (chartId) break;
        await sleep(250);
      }
      const current = nativeData(await official.client('terminal').call('list_open_charts', {}));
      requireValue(/^\d+$/.test(chartId ?? '') && current.charts?.some(c => c.chart_id === chartId && c.symbol === deployment.symbol && c.period === deployment.period), '原生挂载图表尚未唯一确认，请核对终端', 409);
      return { restarted: true, verified: true, chart_id: chartId };
    }
    return { restarted: true, verified: true };
  } catch (error) {
    // A failed configuration must leave the account reconnectable with trading disabled.
    if (closed && !deployment) {
      progress('restoring');
      try {
        try { await control(mt5.native, 'close'); } catch (closeError) {
          // Do not start a second instance if an existing process refused to close.
          if (!closeError.message.includes('found 0')) throw closeError;
        }
        await fs.writeFile(file, terminalConfig(config, false), { mode: 0o600 });
        resetClient(); await start(mt5.native, 'start_terminal', { portable, use_startup_config: true }, file, {});
        await wait(official.client('terminal'), scope, { timeout: 90000 });
      } catch (restoreError) { error.message += `；恢复连接尚未完成：${official.redact(restoreError.message)}`; }
    }
    throw error;
  } finally {
    try {
      await fs.rm(file, { force: true });
      if (preset) await fs.rm(preset, { force: true });
    } finally { mt5.terminalPreparing = false; }
  }
}
