import { changesSchema, commandSchema, importProperties, readConfiguration, updateConfiguration, importConfiguration } from '../backend/configuration.js';
import { connectMT5 } from '../backend/connect.js';

export function createTools(host, mt5, imports) {
  const { define, Type } = host.tools;
  return [
    define('mt5_settings', '读取 MT5 脱敏连接、账户绑定、环境与待导入凭据引用。不会登录、启动终端或交易。', {}, () => readConfiguration(mt5, imports)),
    define('mt5_update_configuration', '按用户任务修改 MT5 连接、原生设置或普通运行选项。先读取版本；密钥通过 mt5_import_configuration 的安全引用导入。', { command_id: commandSchema, expected_version: Type.Integer({ minimum: 1 }), changes: changesSchema }, args => updateConfiguration(host, mt5, args)),
    define('mt5_import_configuration', '导入主会话用户直接提供的 MT5 MCP 配置引用，密钥只在插件后台传递。只保存 Terminal/MetaEditor 连接，随后 mt5_connect 核验账户；MetaEditor 用目录单独核验。', importProperties, args => importConfiguration(host, mt5, imports, args)),
    define('mt5_connect', '验证并恢复已配置的 MT5 Terminal 连接。connected 只证明终端及绑定账户通过核验；不切换账户、不重放交易。不读取或返回秘密。', { command_id: commandSchema, start_if_needed: Type.Optional(Type.Boolean()) }, (args, signal) => connectMT5(host, mt5, args, signal)),
  ];
}
