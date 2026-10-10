import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { digest, id, now, requireValue, securePath } from './support.js';
import { stableJSON } from './contracts.js';
import { connectionURL } from './official.js';
import { MT5MCP, connectionRefused } from './mcp.js';
import { nativeConnectionSettings } from './native-settings.js';
import { proxySettings, testerProxyLines } from './connection.js';
import { launch } from './process.js';

const busy = ['running', 'attaching', 'preparing', 'unknown'];
const unpack = result => {
  requireValue(!result.isError, 'MT5 拒绝读取账户状态，请检查终端 MCP 的读取权限', 502, 'mt5_read_denied');
  return result.structuredContent ?? JSON.parse(result.content?.find(part => part.type === 'text')?.text ?? '{}');
};
const publicRecord = ({ fingerprint, ...record }) => record;
const unavailable = (code, reason, steps, extra = {}) => ({ server: 'terminal', status: 'unavailable', code, reason, steps, ...extra });

/** Startup for connection only: no scripts, experts, Tester, account switch or trading permission changes. */
export function connectionStartup(config, nativeAccount) {
  const account = config.account ?? {};
  requireValue(!account.login || String(account.login) === String(nativeAccount?.login) && account.server === nativeAccount?.server,
    '当前 MT5 保存的账户与 Sesame 绑定账户不同，请先在 MT5 登录目标账户', 409, 'mt5_account_mismatch');
  const values = ['[Common]', 'KeepPrivate=1'];
  // Reuse the terminal's saved login and proxy. Do not put broker passwords in a new INI.
  if (Object.keys(proxySettings(config.startup_ini)).length) values.push(...testerProxyLines(config.startup_ini));
  values.push('[Experts]', 'Enabled=0', 'AllowLiveTrading=0', 'AllowDllImport=0', 'Account=1', 'Profile=1', '');
  return values.join('\r\n');
}

/** Probe first, persist only working credentials, and pin the original account throughout. */
export async function ensureMT5Connection(mt5, { start_if_needed = true } = {}, signal, {
  startTerminal = launch, timeoutMs = 30000, probeTimeoutMs = 5000, pollIntervalMs = 1000, exclusive = action => action(), probeAccount, readNativeSettings = nativeConnectionSettings,
} = {}) {
  if (mt5.terminalPreparing) return unavailable('terminal_preparing', '终端正由受管理准备操作恢复连接，不另行启动', []);
  const preparationEpoch = mt5.terminalPreparationEpoch ?? 0;
  const assertLifecycle = () => requireValue(!mt5.terminalPreparing && (mt5.terminalPreparationEpoch ?? 0) === preparationEpoch, '终端准备生命周期已改变，本次连接探测不再启动或修改终端', 409, 'terminal_preparing');
  const official = mt5.official, original = structuredClone(official.config), steps = [];
  signal?.throwIfAborted();
  if (official.jobs.size) return unavailable('mt5_busy', 'MT5 调用正在执行，请完成后再恢复连接', steps);
  const selected = original.servers.terminal;
  if (!selected.enabled) return unavailable('connection_disabled', '交易终端连接已关闭；先读取 mt5_settings，只有用户要求恢复此连接时，才由 mt5_update_configuration 启用后再 mt5_connect', steps);
  const blocked = official.access('terminal', 'get_trading_account_info', null).blocked_reason;
  if (blocked) return unavailable('mt5_permission_denied', blocked, steps);
  let nativeSettings;
  try { nativeSettings = await readNativeSettings(mt5.native); }
  catch { steps.push({ step: 'discover', status: 'failed', reason: '本机配置无法安全读取；保留已保存的连接设置' }); }
  const nativeServer = nativeSettings?.servers?.terminal;
  steps.push({ step: 'discover', status: mt5.native ? 'ready' : 'not_found' });
  const candidates = [];
  const add = (source, config) => {
    if (!config?.enabled || !config.token) return;
    const url = connectionURL('terminal', config.url);
    if (!candidates.some(candidate => candidate.url === url && candidate.token === config.token)) candidates.push({ ...config, url, source });
  };
  add('saved', selected);
  // A selected custom endpoint is intentional. Do not switch to another terminal silently.
  let sameEndpoint = false;
  try { sameEndpoint = Boolean(nativeServer && connectionURL('terminal', nativeServer.url) === connectionURL('terminal', selected.url)); }
  catch { steps.push({ step: 'discover', status: 'failed', reason: '忽略不支持的本机 MCP 地址，保留已选终端' }); }
  if (sameEndpoint) add('native', nativeServer);
  if (!candidates.length) return unavailable(mt5.native ? 'mcp_not_configured' : 'mt5_not_installed',
    mt5.native ? '本机可读配置没有可用 MCP 凭据；先检查 mt5_settings 的待导入引用。仍缺失时请用户从 MT5「工具 → 选项 → MCP」复制当前连接导出发给 Sesame，再由 mt5_import_configuration 导入并验证' : '未找到唯一的 MT5 安装；先用 mt5_dependencies inspect 与本机文件/进程查找已有安装，保存准确终端路径；确认未安装后再准备依赖', steps);

  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
  let lastError, proof, chosen, started = false, startupFile;
  const probe = async candidate => {
    if (probeAccount) return probeAccount(candidate, combined);
    const client = new MT5MCP({ ...candidate, server: 'terminal' });
    try {
      const info = unpack(await client.call('get_trading_account_info', {}, AbortSignal.any([combined, AbortSignal.timeout(probeTimeoutMs)])));
      requireValue(typeof info.terminal?.server_connected === 'boolean', 'MT5 没有返回明确的券商连接状态', 502, 'mt5_invalid_account');
      return info;
    } finally { client.close(); }
  };
  try {
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      try { proof = await probe(candidate); chosen = candidate; break; }
      catch (error) {
        lastError = error;
        steps.push({ step: 'authenticate', source: candidate.source, status: 'failed', reason: error.upstreamStatus === 401 ? '凭据被原生 MT5 拒绝（401）' : '尚未建立原生连接' });
      }
    }
    const refused = connectionRefused(lastError);
    if (!proof && refused && start_if_needed && mt5.native && nativeServer?.enabled && sameEndpoint) {
      combined.throwIfAborted();
      await exclusive(async () => {
        assertLifecycle();
        // A failed earlier probe is not proof the terminal is still absent.
        for (const candidate of candidates) {
          try { proof = await probe(candidate); chosen = candidate; break; } catch (error) { lastError = error; }
        }
        assertLifecycle(); combined.throwIfAborted();
        if (proof) return;
        requireValue(connectionRefused(lastError), '终端已响应或状态不明，不重复启动', 409, 'mt5_busy');
        requireValue(official.config.version === original.version, '连接设置已改变，请重新连接', 409, 'version_conflict');
        requireValue(!mt5.tester.pending.size && !official.jobs.size && !mt5.deployments.list().some(item => busy.includes(item.status)), '有终端任务正在运行，连接恢复暂不启动终端', 409, 'mt5_busy');
        startupFile = join(official.directory, `${id('connect')}.ini`);
        await fs.writeFile(startupFile, connectionStartup(original, nativeSettings.account), { mode: 0o600 });
        await fs.chmod(startupFile, 0o600); securePath(startupFile);
        combined.throwIfAborted(); assertLifecycle();
        await startTerminal(mt5.native, 'start_terminal', { portable: resolve(mt5.native.dataDirectory) === resolve(mt5.native.directory), use_startup_config: true }, startupFile, {}, combined);
        started = true;
      });
      if (started) steps.push({ step: 'start_terminal', status: 'requested', reason: '复用终端保存的账户，以算法交易关闭的配置启动；启动请求不代表已连接' });
      while (!combined.aborted && !proof) {
        await sleep(pollIntervalMs, undefined, { signal: combined });
        for (const candidate of candidates) {
          try { proof = await probe(candidate); chosen = candidate; break; } catch (error) { lastError = error; }
        }
        if (lastError?.upstreamStatus === 401 && !proof) break;
      }
    }
    if (!proof) {
      signal?.throwIfAborted();
      const code = lastError?.upstreamStatus === 401 ? 'mcp_auth_failed' : refused && !started ? 'terminal_not_running' : 'mcp_unreachable';
      return unavailable(code, code === 'mcp_auth_failed'
        ? 'MT5 拒绝当前 MCP 密钥；本机候选凭据未通过认证。先检查 mt5_settings 的待导入引用；仍缺失时请用户从 MT5「工具 → 选项 → MCP」复制当前连接导出发给 Sesame，再由 mt5_import_configuration 导入并验证'
        : code === 'terminal_not_running' ? '交易终端 MCP 尚未启动；先按 connection/dependencies 指南核对所选安装与已有进程并恢复该服务，不另开一个终端代替发现' : 'MT5 MCP 暂不可用，请检查原生 MCP 服务与本机连接', steps, { started });
    }
    steps.push({ step: 'authenticate', source: chosen.source, status: 'verified' });
    // Connecting to MCP is not proof of a broker connection. Allow saved-login recovery a short bounded wait.
    while (!proof.terminal.server_connected && !combined.aborted) {
      await sleep(pollIntervalMs, undefined, { signal: combined });
      proof = await probe(chosen);
    }
    if (!proof.terminal.server_connected) return unavailable('broker_offline', 'MCP 已连接，但 MT5 尚未连上券商；请核对终端中保存的登录、服务器和网络', steps, { started, mcp_connected: true });
    const actual = { login: String(proof.account?.login ?? ''), server: proof.account?.server ?? '' };
    requireValue(/^[1-9][0-9]{0,19}$/.test(actual.login) && typeof actual.server === 'string' && actual.server.length > 0 && actual.server.length <= 200 && !/[\r\n\0]/.test(actual.server), 'MT5 未返回有效账户身份', 502, 'mt5_invalid_account');
    if (original.account.login && actual.login !== original.account.login || original.account.server && actual.server !== original.account.server) {
      return unavailable('mt5_account_mismatch', 'MT5 当前账户与 Sesame 绑定账户不同；请在 MT5 登录绑定账户，或由用户修改账户绑定', steps, { started, mcp_connected: true, account: actual });
    }
    return await exclusive(async () => {
      combined.throwIfAborted();
      assertLifecycle();
      requireValue(official.config.version === original.version, '连接设置已改变，请重新连接', 409, 'version_conflict');
      requireValue(!official.jobs.size, 'MT5 调用正在执行，请完成后再恢复连接', 409, 'mt5_busy');
      const changes = {};
      if (chosen.token !== selected.token || chosen.url !== selected.url) changes.servers = { terminal: { token: chosen.token, url: chosen.url } };
      if (!original.account.login || !original.account.server) changes.account = actual;
      if (Object.keys(changes).length) await official.configure({ expected_version: original.version, ...changes });
      else { official.clients.get('terminal')?.close(); official.clients.delete('terminal'); }
      steps.push({ step: 'verify_account', status: 'verified' });
      return { server: 'terminal', status: 'connected', code: null, reason: null, account: actual, mcp_connected: true, broker_connected: true, settings_version: official.config.version, started, steps };
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (proof && !proof.terminal.server_connected && deadline.aborted) return unavailable('broker_offline', 'MCP 已连接，但等待期间券商连接未恢复；请核对 MT5 保存的登录和网络', steps, { started, mcp_connected: true });
    let reason = official.redact(error.message);
    for (const { token } of candidates) reason = reason.replaceAll(token, '[redacted]');
    return unavailable(typeof error.code === 'string' ? error.code : 'mcp_unreachable', reason, steps, { started });
  } finally {
    if (startupFile) await fs.rm(startupFile, { force: true });
  }
}

/** Main-agent entry, with the same configuration lock and durable audit as other settings changes. */
export async function connectMT5(host, mt5, args, signal) {
  const conversationId = host.scope.conversationId;
  if (conversationId) requireValue(host.scope.kind === 'main', '只有主 Agent 可以恢复 MT5 连接', 403);
  requireValue(args && Object.keys(args).every(key => ['command_id', 'start_if_needed'].includes(key)) && typeof args.command_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id)
    && (args.start_if_needed === undefined || typeof args.start_if_needed === 'boolean'), '连接请求需要唯一 command_id，可选 start_if_needed 布尔值');
  const fingerprint = digest(stableJSON({ ...args, conversationId }));
  const previous = host.storage.get('configuration_change', args.command_id, true);
  if (previous) {
    requireValue(previous.fingerprint === fingerprint && previous.conversation_id === conversationId, '连接命令 ID 已用于其他请求', 409, 'idempotency_conflict');
    return publicRecord(previous);
  }
  return host.configuration.exclusive(async () => {
    const record = { id: args.command_id, fingerprint, conversation_id: conversationId, target: 'mt5', changes: { connect: true, start_if_needed: args.start_if_needed ?? true }, status: 'running', created_at: now() };
    host.storage.put('configuration_change', record);
    const finish = changes => {
      const value = { ...record, ...changes, completed_at: now() };
      host.storage.transaction(() => {
        host.storage.put('configuration_change', value);
        host.events.emit('configuration.updated', { id: record.id, target: 'mt5', status: value.status });
      });
      return publicRecord(value);
    };
    try {
      const result = await ensureMT5Connection(mt5, args, signal);
      return finish({ status: result.status === 'connected' ? 'applied' : 'failed', result });
    } catch (error) {
      finish({ status: signal?.aborted ? 'canceled' : 'failed', error: { code: error.code ?? 'connection_failed', message: mt5.official.redact(error.message) } });
      throw error;
    }
  }, conversationId);
}
