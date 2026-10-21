import { records } from './records.js';
import { stableJSON } from './contracts.js';
import { ApiError, digest, now, requireValue } from './support.js';
import { prepareTerminal } from './terminal.js';

const publicRecord = ({ fingerprint: _fingerprint, ...record }) => record;
const boolean = value => typeof value === 'boolean' ? value : null;
const identity = config => ({ login: String(config.account?.login ?? ''), server: config.account?.server ?? '' });
const sameAccount = (left, right) => left.login === right.login && left.server === right.server;

function validateInput(args) {
  requireValue(args && typeof args === 'object' && !Array.isArray(args), '需要明确的交易权限操作');
  const keys = Object.keys(args);
  if (args.action === 'read') {
    requireValue(keys.length === 1 && keys[0] === 'action', '读取交易权限只接受 action:"read"');
    return;
  }
  requireValue(args.action === 'enable' && keys.length === 3
    && keys.every(key => ['action', 'command_id', 'expected_version'].includes(key))
    && typeof args.command_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id)
    && Number.isSafeInteger(args.expected_version) && args.expected_version >= 1,
  '启用交易权限需要稳定 command_id 和当前 expected_version');
}

function assertBinding(mt5, binding) {
  requireValue(mt5.official.config.version === binding.version, 'MT5 配置已变化，请重新读取权限', 409, 'version_conflict');
  requireValue(sameAccount(identity(mt5.official.config), binding.account), 'MT5 配置账户已变化，请重新核对权限', 409, 'mt5_account_mismatch');
}

async function observe(mt5, binding) {
  assertBinding(mt5, binding);
  const { scope, info } = await mt5.market.connected();
  assertBinding(mt5, binding);
  const account = { login: String(info.account?.login ?? ''), server: info.account?.server ?? '' };
  requireValue(binding.account.login && binding.account.server
    && sameAccount(account, binding.account) && sameAccount(scope, binding.account),
  '终端账户与本次权限操作的绑定不一致', 409, 'mt5_account_mismatch');
  return {
    checked_at: now(), configuration_version: binding.version,
    account: { ...account, type: typeof info.account?.type === 'string' ? info.account.type : null, read_only: boolean(info.account?.read_only) },
    application: { allow_trading: boolean(mt5.official.config.allow_trading) },
    terminal: { connected: boolean(info.terminal?.server_connected), experts_trade_allowed: boolean(info.terminal?.experts_trade_allowed), mcp_trade_allowed: boolean(info.terminal?.mcp_trade_allowed) },
  };
}

function assertPrerequisites(observation) {
  requireValue(observation.application.allow_trading === true, 'Sesame 的原生交易操作权限未开启，请按已有用户授权通过 mt5_update_configuration 调整后核验', 403, 'mt5_permission_denied');
  requireValue(observation.terminal.connected === true, '终端尚未连接券商，不能准备交易权限', 503, 'mt5_offline');
  requireValue(observation.account.read_only === false, '当前账户为只读或未返回明确读写权限；终端算法开关不能解除券商或登录限制', 403, 'mt5_account_read_only');
  requireValue(observation.terminal.mcp_trade_allowed === true, '原生 MCP 交易授权尚未就绪；算法交易准备不能修改 MCP 授权', 409, 'mcp_trading_not_authorized');
}

function safeError(mt5, cause) {
  return new ApiError(typeof cause?.status === 'number' ? cause.status : 503,
    mt5.official.redact(typeof cause?.code === 'string' ? cause.code : cause?.name === 'AbortError' ? 'operation_canceled' : 'trading_permissions_failed'),
    mt5.official.redact(String(cause?.message ?? 'MT5 交易权限准备未完成')));
}

/** Explicit permission preparation only; it never submits or replays an order. */
export async function tradingPermissions(host, mt5, args, signal, { prepare = prepareTerminal } = {}) {
  requireValue(host.context.kind === 'main' && typeof host.context.sessionId === 'string' && host.context.sessionId,
    '只有主 Agent 可以读取或准备 MT5 交易权限', 403, 'FORBIDDEN');
  validateInput(args);
  signal?.throwIfAborted();
  if (args.action === 'read') {
    try {
      const result = await observe(mt5, { version: mt5.official.config.version, account: identity(mt5.official.config) });
      signal?.throwIfAborted();
      return result;
    } catch (error) { throw safeError(mt5, error); }
  }

  const store = records(host), conversationId = host.context.sessionId;
  const fingerprint = digest(stableJSON({ capability: 'mt5_trading_permissions', ...args }));
  const previous = () => {
    const old = store.get('configuration_change', args.command_id, true);
    if (!old) return null;
    requireValue(old.fingerprint === fingerprint && old.conversation_id === conversationId,
      '交易权限命令 ID 已用于其他操作或会话', 409, 'idempotency_conflict');
    return publicRecord(old);
  };
  const old = previous();
  if (old) return old;
  return store.exclusive(async () => {
    const repeated = previous();
    if (repeated) return repeated;
    signal?.throwIfAborted();
    let record = {
      id: args.command_id, fingerprint, conversation_id: conversationId, target: 'mt5',
      changes: { trading_permissions: 'enable' }, status: 'running', created_at: now(),
      result: { before: null, after: null, restarted: false, verified: false },
    };
    const save = changes => {
      record = store.put('configuration_change', { ...record, ...changes });
      host.events.emit({ topic: 'workspace.mt5.configuration', payload: { id: record.id, target: 'mt5', status: record.status } });
      return publicRecord(record);
    };
    save({});
    try {
      const binding = { version: args.expected_version, account: identity(mt5.official.config) };
      assertBinding(mt5, binding);
      requireValue(mt5.official.config.allow_trading === true, 'Sesame 的原生交易操作权限未开启', 403, 'mt5_permission_denied');
      record.result.before = await observe(mt5, binding);
      assertPrerequisites(record.result.before);
      save({});
      signal?.throwIfAborted();
      assertBinding(mt5, binding);
      if (record.result.before.terminal.experts_trade_allowed !== true) {
        // Once started, the existing helper owns restart, restoration and cleanup.
        // Cancellation must not strand the terminal halfway through that lifecycle.
        record.result.restarted = null;
        save({});
        const prepared = await prepare(mt5, stage => { save({ stage }); });
        record.result.restarted = typeof prepared?.restarted === 'boolean' ? prepared.restarted : null;
        save({});
        record.result.after = await observe(mt5, binding);
        requireValue(prepared?.verified === true, '终端准备没有返回已核验结果', 409, 'native_config_not_applied');
      } else {
        record.result.after = await observe(mt5, binding);
      }
      assertPrerequisites(record.result.after);
      requireValue(record.result.after.account.type === record.result.before.account.type,
        '权限准备期间账户类型已变化，请重新核对', 409, 'mt5_account_mismatch');
      requireValue(record.result.after.terminal.experts_trade_allowed === true,
        '终端已返回，但算法交易权限尚未生效', 409, 'native_config_not_applied');
      record.result.verified = true;
      return save({ status: 'applied', completed_at: now() });
    } catch (cause) {
      const error = safeError(mt5, cause);
      record.result.verified = false;
      save({ status: 'failed', error: { code: error.code, message: error.message }, completed_at: now() });
      throw error;
    }
  });
}
