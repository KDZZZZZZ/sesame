import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { ApiError, digest, now, requireValue } from './support.js';
import { stableJSON } from './contracts.js';
import { connectionURL } from './official.js';

const object = properties => Type.Object(properties, { additionalProperties: false, minProperties: 1 });
const text = maxLength => Type.String({ maxLength, pattern: '^[^\\r\\n\\u0000]*$' });
const server = object({ url: Type.Optional(text(2048)), enabled: Type.Optional(Type.Boolean()) });
export const changesSchema = Type.Union([
  object({ import_native: Type.Literal(true) }),
  object({ allow_trading: Type.Optional(Type.Boolean()), allow_host_operations: Type.Optional(Type.Boolean()),
    servers: Type.Optional(object({ terminal: Type.Optional(server), metaeditor: Type.Optional(server), marketdata: Type.Optional(server) })),
    account: Type.Optional(object({ login: Type.Optional(Type.String({ pattern: '^(|[1-9][0-9]{0,19})$' })), server: Type.Optional(text(200)) })),
    tester_agent: Type.Optional(object({ address: Type.Optional(text(15)), port: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })) })),
  }),
]);
export const commandSchema = Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' });
export const importProperties = { command_id: commandSchema, source_message_id: Type.String({ pattern: '^msg_[A-Za-z0-9_-]{1,100}$' }), expected_version: Type.Integer({ minimum: 1 }) };
const publicChange = ({ fingerprint, ...record }) => record;

function recordChange(host, record) {
  host.storage.put('configuration_change', record);
  host.events.emit('configuration.updated', { id: record.id, status: record.status });
  return publicChange(record);
}
function previous(host, args) {
  requireValue(host.scope.kind === 'main', '仅主 Agent 可以修改 MT5 连接配置', 403);
  const hash = digest(stableJSON(args)), old = host.storage.get('configuration_change', args.command_id, true);
  if (old) requireValue(old.fingerprint === hash && old.conversation_id === host.scope.conversationId, '配置命令 ID 已用于其他修改', 409, 'idempotency_conflict');
  return { hash, old: old ? publicChange(old) : null };
}
export function readConfiguration(mt5, imports) {
  return { settings: mt5.official.settings(), pendingImports: imports.pending(), environment: { platform: process.platform, terminalInstalled: Boolean(mt5.native), ...mt5.status() }, connection: mt5.storage.get('mt5_connection_status', 'terminal', true) };
}
export async function updateConfiguration(host, mt5, args) {
  requireValue(Value.Check(object({ command_id: commandSchema, expected_version: Type.Integer({ minimum: 1 }), changes: changesSchema }), args), 'MT5 配置参数无效；密钥通过安全配置引用导入');
  for (const [name, config] of Object.entries(args.changes.servers ?? {})) if (config.url !== undefined) connectionURL(name, config.url);
  const { hash, old } = previous(host, args); if (old) return old;
  return host.configuration.exclusive(async () => {
    const record = { id: args.command_id, conversation_id: host.scope.conversationId, fingerprint: hash, target: 'mt5', changes: args.changes, status: 'running', created_at: now() };
    recordChange(host, record);
    try { const result = await mt5.official.configure({ expected_version: args.expected_version, ...args.changes }); mt5.monitor?.settingsChanged(); return recordChange(host, { ...record, status: 'applied', result, completed_at: now() }); }
    catch (cause) { recordChange(host, { ...record, status: 'failed', error: { code: cause.code ?? 'configuration_failed', message: mt5.official.redact(cause.message) }, completed_at: now() }); throw cause; }
  });
}
export async function importConfiguration(host, mt5, imports, args) {
  requireValue(Value.Check(object(importProperties), args), '需要有效配置引用、操作 ID 和版本');
  const { hash, old } = previous(host, args); if (old) return old;
  return host.configuration.exclusive(async () => {
    requireValue(mt5.official.settings().version === args.expected_version, 'MT5 配置已更新，请重新读取', 409, 'version_conflict');
    const pending = imports.read(args.source_message_id, host.scope.conversationId);
    const record = { id: args.command_id, conversation_id: host.scope.conversationId, fingerprint: hash, target: 'mt5', changes: { source_message_id: args.source_message_id }, status: 'running', created_at: now() };
    recordChange(host, record);
    let result;
    try { result = await mt5.official.configure({ expected_version: args.expected_version, servers: pending.servers }); }
    catch (cause) {
      const safe = { code: cause.code ?? 'mt5_import_failed', message: 'MT5 配置导入未完成，请重新读取连接设置后重试。' };
      recordChange(host, { ...record, status: 'failed', error: safe, completed_at: now() }); throw new ApiError(cause.status ?? 422, safe.code, safe.message);
    }
    const receipt = recordChange(host, { ...record, status: 'applied', result, completed_at: now() });
    try { imports.remove(args.source_message_id); } catch { /* The successful update remains recorded; the private reference expires. */ }
    mt5.monitor?.settingsChanged(); return receipt;
  });
}
