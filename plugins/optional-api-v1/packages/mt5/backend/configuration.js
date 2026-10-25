import { records } from './records.js';
import { resolve } from 'node:path';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { ApiError, digest, now, requireValue } from './support.js';
import { stableJSON } from './contracts.js';
import { connectionURL } from './official.js';

const object = properties => Type.Object(properties, { additionalProperties: false, minProperties: 1 });
const text = maxLength => Type.String({ maxLength, pattern: '^[^\\r\\n\\u0000]*$' });
const credential = (maxLength, description) => Type.String({ ...text(maxLength), writeOnly: true, description });
const server = object({ url: Type.Optional(text(2048)), enabled: Type.Optional(Type.Boolean()),
  token: Type.Optional(credential(8192, '用户提供的 MCP API Key 原文；省略保留现有值，空字符串清除。保存后立即生效，回执不返回密钥。')) });
export const changesSchema = Type.Union([
  object({ import_native: Type.Literal(true) }),
  object({ allow_trading: Type.Optional(Type.Boolean()), allow_host_operations: Type.Optional(Type.Boolean()),
    servers: Type.Optional(object({ terminal: Type.Optional(server), metaeditor: Type.Optional(server), marketdata: Type.Optional(server) })),
    account: Type.Optional(object({ login: Type.Optional(Type.String({ pattern: '^(|[1-9][0-9]{0,19})$' })), server: Type.Optional(text(200)),
      password: Type.Optional(credential(1024, '用户提供的券商账户密码；省略保留现有值，空字符串清除。账户改变时需明确提供对应密码。')) })),
    tester_agent: Type.Optional(object({ address: Type.Optional(text(15)), port: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
      password: Type.Optional(credential(1024, '用户提供的 MetaTester 代理密码；省略保留现有值，空字符串清除。')) })),
  }),
]);
export const commandSchema = Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' });
export const importProperties = { command_id: commandSchema, source_message_id: Type.String({ pattern: '^msg_[A-Za-z0-9_-]{1,100}$' }), expected_version: Type.Integer({ minimum: 1 }) };
const publicChange = ({ fingerprint, ...record }) => record;

function publicChanges(changes) {
  const result = structuredClone(changes);
  for (const server of Object.values(result.servers ?? {})) if (Object.hasOwn(server, 'token')) server.token = '[redacted]';
  for (const account of [result.account, result.tester_agent]) if (account && Object.hasOwn(account, 'password')) account.password = '[redacted]';
  return result;
}
function configurationError(mt5, changes, cause) {
  let message = mt5.official.redact(String(cause.message ?? 'MT5 配置未完成，请读取当前设置后重试。'));
  // A rejected new credential is not yet in official.config, so redact the
  // submitted values as well as the already saved credentials before rethrowing.
  const secrets = [...Object.values(changes.servers ?? {}).map(server => server.token), changes.account?.password, changes.tester_agent?.password];
  for (const secret of secrets.filter(value => typeof value === 'string' && value.length)) {
    message = message.replaceAll(JSON.stringify(secret).slice(1, -1), '[redacted]').replaceAll(secret, '[redacted]');
  }
  return new ApiError(cause.status ?? 422, cause.code ?? 'configuration_failed', message);
}

function recordChange(host, record) {
  records(host).put('configuration_change', record);
  host.events.emit({ topic: 'workspace.mt5.configuration', payload: { id: record.id, status: record.status } });
  return publicChange(record);
}
function previous(host, args) {
  requireValue(host.context.kind === 'main', '仅主 Agent 可以修改 MT5 连接配置', 403);
  const hash = digest(stableJSON(args)), old = records(host).get('configuration_change', args.command_id, true);
  if (old) requireValue(old.fingerprint === hash && old.conversation_id === host.context.sessionId, '配置命令 ID 已用于其他修改', 409, 'idempotency_conflict');
  return { hash, old: old ? publicChange(old) : null };
}
export function readConfiguration(mt5, imports) {
  return { settings: mt5.official.settings(), pendingImports: imports.pending(), environment: { platform: process.platform, terminalInstalled: Boolean(mt5.native), ...mt5.status() }, connection: mt5.storage.get('mt5_connection_status', 'terminal', true) };
}
export function configurationStatus(mt5) {
  const value = mt5.official.settings();
  return { settings: { version: value.version, allow_trading: value.allow_trading, allow_host_operations: value.allow_host_operations,
    servers: Object.fromEntries(['terminal', 'metaeditor', 'marketdata'].map(name => {
      const { url, enabled, authenticated } = value.servers[name]; return [name, { url, enabled, authenticated }];
    })),
    account: { login: value.account.login, server: value.account.server, password_configured: value.account.password_configured },
    tester_agent: { address: value.tester_agent.address, port: value.tester_agent.port, password_configured: value.tester_agent.password_configured },
  } };
}
export async function startMT5Terminal(host, mt5, args, signal) {
  requireValue(host.context.kind === 'main', '只有主 Agent 可以启动 MT5 终端', 403, 'FORBIDDEN');
  requireValue(Value.Check(object({ command_id: commandSchema }), args), '启动终端只需要稳定 command_id，不接受路径、账户或启动 INI');
  const native = mt5.native;
  // Preserve the selected terminal's data mode. Never inject another account,
  // profile or a saved arbitrary INI just to open the application.
  const portable = Boolean(native?.directory && native?.dataDirectory && resolve(native.directory) === resolve(native.dataDirectory));
  return mt5.official.call({ command_id: args.command_id, server: 'launcher', tool: 'start_terminal', arguments: { portable } }, host.context.sessionId, signal);
}
export async function updateConfiguration(host, mt5, args) {
  requireValue(Value.Check(object({ command_id: commandSchema, expected_version: Type.Integer({ minimum: 1 }), changes: changesSchema }), args), 'MT5 配置参数无效；连接 token、账户 password 和 tester_agent.password 使用声明的字段');
  for (const [name, config] of Object.entries(args.changes.servers ?? {})) if (config.url !== undefined) connectionURL(name, config.url);
  const { hash, old } = previous(host, args); if (old) return old;
  return records(host).exclusive(async () => {
    const repeated = previous(host, args).old; if (repeated) return repeated;
    const record = { id: args.command_id, conversation_id: host.context.sessionId, fingerprint: hash, target: 'mt5', changes: publicChanges(args.changes), status: 'running', created_at: now() };
    recordChange(host, record);
    try { const result = await mt5.official.configure({ expected_version: args.expected_version, ...args.changes }); mt5.monitor?.settingsChanged(); return recordChange(host, { ...record, status: 'applied', result, completed_at: now() }); }
    catch (cause) {
      const error = configurationError(mt5, args.changes, cause);
      recordChange(host, { ...record, status: 'failed', error: { code: error.code, message: error.message }, completed_at: now() }); throw error;
    }
  });
}
export async function importConfiguration(host, mt5, imports, args) {
  requireValue(Value.Check(object(importProperties), args), '需要有效配置引用、操作 ID 和版本');
  const { hash, old } = previous(host, args); if (old) return old;
  return records(host).exclusive(async () => {
    const repeated = previous(host, args).old; if (repeated) return repeated;
    requireValue(mt5.official.settings().version === args.expected_version, 'MT5 配置已更新，请重新读取', 409, 'version_conflict');
    const pending = await imports.read(args.source_message_id, host.context.sessionId);
    if (pending.binding) requireValue(pending.binding.login === mt5.official.config.account.login && pending.binding.server === mt5.official.config.account.server,
      '账户绑定已改变，此密码引用不能用于其他账户；请确认目标并重新提供账户配置。', 409, 'mt5_account_binding_changed');
    const record = { id: args.command_id, conversation_id: host.context.sessionId, fingerprint: hash, target: 'mt5', changes: { source_message_id: args.source_message_id }, status: 'running', created_at: now() };
    recordChange(host, record);
    let result;
    try { result = await mt5.official.configure({ expected_version: args.expected_version, servers: pending.servers, ...(pending.account ? { account: pending.account } : {}) }); }
    catch (cause) {
      const safe = { code: cause.code ?? 'mt5_import_failed', message: 'MT5 配置导入未完成，请重新读取连接设置后重试。' };
      recordChange(host, { ...record, status: 'failed', error: safe, completed_at: now() }); throw new ApiError(cause.status ?? 422, safe.code, safe.message);
    }
    const receipt = recordChange(host, { ...record, status: 'applied', result, completed_at: now() });
    try { imports.remove(args.source_message_id); } catch { /* The successful update remains recorded; the private reference expires. */ }
    mt5.monitor?.settingsChanged(); return receipt;
  });
}
