import { randomUUID } from 'node:crypto';
import { records } from './records.js';
import { stableJSON } from './contracts.js';
import { updateConfiguration } from './configuration.js';
import { tradingPermissions } from './trading-permissions.js';
import { prepareTerminal } from './terminal.js';
import { verifiedQuoteClock } from './quote-clock-proof.js';
import { ApiError, digest, requireValue } from './support.js';

const pending = new WeakMap();
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sameAccount = (left, right) => left.accountId === right.accountId && left.server === right.server;
const commandId = (id, stage) => `trading-prepare-${digest(`${id}:${stage}`).slice(7, 55)}-${stage}`;
function accountOf(mt5) {
  const { account, version } = mt5.official.config;
  requireValue(account?.login && account.server && Number.isSafeInteger(version), '先配置已有 MT5 账户与服务器', 409, 'PREREQUISITE_REQUIRED');
  return { accountId: String(account.login), server: account.server, revision: String(version) };
}
function validate(args) {
  requireValue(object(args) && Object.keys(args).every(key => ['symbol', 'command_id', 'user_authorized', 'expected_account'].includes(key))
    && typeof args.symbol === 'string' && args.symbol.length <= 128 && args.symbol.trim() === args.symbol && args.symbol.length > 0 && !/[\r\n\0]/.test(args.symbol)
    && typeof args.command_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id)
    && args.user_authorized === true, '交易准备需要准确 symbol、稳定 command_id 及已有用户授权 user_authorized:true');
  if (args.expected_account !== undefined) {
    const account = args.expected_account;
    requireValue(object(account) && Object.keys(account).length === 3 && ['accountId', 'server', 'revision'].every(key => typeof account[key] === 'string' && account[key].length > 0),
      'expected_account 必须含准确 accountId、server、revision');
  }
}
function assertNativeAccount(summary, account) {
  requireValue(object(summary) && String(summary.login) === account.accountId && summary.server === account.server,
    'Python 实际账户与本次准备绑定不一致', 409, 'ACCOUNT_MISMATCH');
  requireValue(summary.trade_allowed === true, '账户交易权限未就绪；不能通过终端算法开关解除券商或登录限制', 403, 'MT5_ACCOUNT_TRADING_DISABLED');
  requireValue(summary.trade_expert === true, '账户程序交易权限未就绪；不能自动修改券商限制', 403, 'MT5_ACCOUNT_EXPERT_DISABLED');
}
function assertNativeTerminal(terminal) {
  requireValue(object(terminal) && terminal.connected === true, 'Python 终端未连接券商', 503, 'SOURCE_UNAVAILABLE');
  requireValue(terminal.tradeapi_disabled === false, '终端禁用了外部 Python 交易 API，需调整该明确设置；算法开关不能替代此权限', 403, 'MT5_PYTHON_TRADING_DISABLED');
  requireValue(terminal.trade_allowed === true, 'Python 回读的终端算法交易权限尚未生效', 403, 'MT5_TERMINAL_TRADING_DISABLED');
}
function safeError(mt5, cause) {
  const error = new ApiError(typeof cause?.status === 'number' ? cause.status : 503,
    mt5.official.redact(typeof cause?.code === 'string' ? cause.code : 'preparation_failed'),
    mt5.official.redact(String(cause?.message ?? '交易准备未完成')));
  if (object(cause?.details)) error.details = JSON.parse(mt5.official.redact(JSON.stringify(cause.details)));
  return error;
}

/** Technical preparation only. No order, login, business sizing or quote-clock adjustment. */
export async function tradingPrepare(host, mt5, args, signal, { now = Date.now, prepare = prepareTerminal } = {}) {
  requireValue(host.context.kind === 'main' && typeof host.context.sessionId === 'string' && host.context.sessionId,
    '只有主 Agent 可以准备 MT5 交易连接', 403, 'FORBIDDEN');
  validate(args); signal?.throwIfAborted();
  const store = records(host), fingerprint = digest(stableJSON({ ...args, owner: host.context.sessionId }));
  const old = store.get('mt5_trading_preparations', args.command_id, true);
  requireValue(!old || old.fingerprint === fingerprint, '交易准备命令 ID 已用于其他输入或会话', 409, 'idempotency_conflict');
  const active = pending.get(mt5);
  if (active) {
    requireValue(active.id === args.command_id && active.fingerprint === fingerprint,
      '已有另一项 MT5 交易准备正在执行', 409, 'mt5_busy');
    const result = await active.promise; signal?.throwIfAborted(); return structuredClone(result);
  }
  const account = accountOf(mt5);
  if (!old && args.expected_account) requireValue(sameAccount(account, args.expected_account) && account.revision === args.expected_account.revision,
    '交易准备的预期账户或配置已变化', 409, 'ACCOUNT_MISMATCH');
  let record = old ?? { id: args.command_id, fingerprint, account, status: 'preparing', createdAt: now(),
    preparation: { applicationPermissionChanged: false, algorithmPermissionChanged: false, restarted: false, initialized: false } };
  const assertCurrent = () => {
    const current = accountOf(mt5);
    requireValue(sameAccount(current, record.account) && current.revision === record.account.revision,
      'MT5 账户或配置在准备期间已变化', 409, 'CONNECTION_CHANGED');
    signal?.throwIfAborted();
  };
  assertCurrent();
  const save = changes => { record = store.put('mt5_trading_preparations', { ...record, ...changes }); };
  async function readEnvelope(tool, input, id = `trading-prepare-read-${randomUUID()}`) {
    assertCurrent();
    const receipt = await mt5.official.call({ server: 'python', tool, arguments: input, command_id: id }, host.context.sessionId, signal);
    assertCurrent();
    const value = receipt?.result?.result;
    if (receipt?.status !== 'returned' || receipt.result?.error || value === null || value === undefined || value === false) {
      const lastError = receipt?.result?.last_error;
      const nativeCode = Array.isArray(lastError) ? lastError[0] : receipt?.result?.error ?? null;
      const message = mt5.official.redact(String(Array.isArray(lastError) ? lastError[1] : receipt?.result?.message ?? receipt?.error ?? 'No confirmed native result').slice(0, 1500));
      const error = new ApiError(503, nativeCode === -10004 ? 'MT5_PYTHON_UNAVAILABLE' : 'SOURCE_UNAVAILABLE', `MT5 Python ${tool} failed${nativeCode === null ? '' : ` [${nativeCode}]`}: ${message}`);
      error.details = { transport: 'python', method: tool, commandId: receipt?.id ?? id, commandStatus: receipt?.status ?? 'unknown', nativeCode, nativeMessage: message };
      throw error;
    }
    return receipt.result;
  }
  const read = async (...args) => (await readEnvelope(...args)).result;
  async function run() {
    save({ status: 'preparing', stage: 'permissions' });
    try {
      // Complete any restart before queuing Python work: prepareTerminal requires
      // official.jobs to be idle and owns its cleanup even if the caller cancels.
      const permission = await tradingPermissions(host, mt5, { action: 'read' }, signal);
      assertCurrent();
      requireValue(permission.account.read_only === false, '当前账户只读或读写权限未知；不能自动解除券商或登录限制', 403, 'mt5_account_read_only');
      requireValue(permission.terminal.connected === true, '当前终端未连接券商', 503, 'mt5_offline');
      if (mt5.official.config.allow_trading !== true) {
        requireValue(!record.applicationAttempted, '此前应用权限变更未完成或已再次关闭，请核对真实设置后使用新的准备命令', 409, 'mt5_permission_denied');
        save({ applicationAttempted: true });
        const receipt = await updateConfiguration(host, mt5, { command_id: commandId(args.command_id, 'application'), expected_version: Number(record.account.revision), changes: { allow_trading: true } });
        requireValue(receipt.status === 'applied' && receipt.result?.allow_trading === true && Number.isSafeInteger(receipt.result.version), '应用交易权限未确认生效', 409, 'mt5_permission_denied');
        record.account = { ...record.account, revision: String(receipt.result.version) };
        record.preparation.applicationPermissionChanged = true; save({}); assertCurrent();
      }
      if (permission.terminal.experts_trade_allowed !== true) {
        const receipt = await tradingPermissions(host, mt5, { action: 'enable', command_id: commandId(args.command_id, 'algorithm'), expected_version: Number(record.account.revision) }, signal, { prepare });
        record.preparation.restarted = receipt.result?.restarted === true;
        save({}); assertCurrent();
        requireValue(receipt.status === 'applied' && receipt.result?.verified === true, '终端算法交易准备未确认生效；保留原回执，不重复重启', 409, 'native_config_not_applied');
        record.preparation.algorithmPermissionChanged = true; save({});
      }
      const readStartedAt = now(); save({ stage: 'python' });
      let summary, terminal;
      try {
        summary = await read('account_info', {}); assertNativeAccount(summary, record.account);
        terminal = await read('terminal_info', {});
      } catch (error) {
        if (error.details?.nativeCode !== -10004 || record.initializationAttempted) throw error;
        save({ initializationAttempted: true });
        // MT5Python supplies only the selected terminal/data mode and configured
        // account. There is no login call and no guessed process or account.
        requireValue(await read('initialize', {}, commandId(args.command_id, 'initialize')) === true, 'Python 初始化未确认成功', 503, 'MT5_PYTHON_UNAVAILABLE');
        record.preparation.initialized = true; save({});
        summary = await read('account_info', {}); assertNativeAccount(summary, record.account);
        terminal = await read('terminal_info', {});
      }
      assertNativeTerminal(terminal); save({ stage: 'symbol' });
      // Schedule independent reads together; the native worker intentionally
      // serializes SDK calls. Settle every queued read before releasing this run.
      const batch = await Promise.allSettled(['symbol_info', 'positions_get', 'orders_get'].map(tool => read(tool, { symbol: args.symbol })));
      const failed = batch.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
      assertCurrent();
      const [spec, positions, orders] = batch.map(result => result.value);
      requireValue(object(spec) && spec.name === args.symbol, '原生品种规格不匹配', 503, 'SOURCE_DATA_INVALID');
      for (const rows of [positions, orders]) requireValue(Array.isArray(rows) && rows.every(row => object(row) && row.symbol === args.symbol), '原生持仓或挂单缺失，或混入其他品种', 503, 'SOURCE_DATA_INVALID');
      save({ stage: 'quote' });
      const quote = await readEnvelope('symbol_info_tick', { symbol: args.symbol }), tick = quote.result;
      requireValue(object(tick) && Number.isSafeInteger(tick.time_msc) && tick.time_msc > 0 && Number.isFinite(tick.bid) && Number.isFinite(tick.ask), '原生报价没有返回有效毫秒时间与买卖价', 503, 'SOURCE_DATA_INVALID');
      const quote_clock = verifiedQuoteClock(tick, quote.quote_clock, record.account);
      summary = await read('account_info', {}); assertNativeAccount(summary, record.account); assertCurrent();
      const capturedAt = now();
      save({ status: 'ready', stage: 'verified', completedAt: capturedAt });
      return { account: record.account, summary, terminal, spec, positions, orders, tick, quote_clock, readStartedAt, capturedAt,
        preparation: { commandId: args.command_id, status: 'ready', ...record.preparation,
          stages: ['permissions', 'python', 'symbol', 'quote', 'verified'], readScheduling: 'parallel_requests_serial_python_worker' } };
    } catch (cause) {
      const error = signal?.aborted ? signal.reason : safeError(mt5, cause);
      save({ status: 'failed', completedAt: now(), error: { code: error?.code ?? error?.name ?? 'preparation_failed', message: mt5.official.redact(String(error?.message ?? '交易准备未完成')) } });
      throw error;
    }
  }
  const promise = run(); pending.set(mt5, { id: args.command_id, fingerprint, promise });
  try { return await promise; } finally { if (pending.get(mt5)?.promise === promise) pending.delete(mt5); }
}
