import { Type } from 'typebox';
import { requireValue } from '../../store.js';
import { snapshot, update, updateProperties, importMT5, importMT5Properties } from '../../configuration-service.js';
import { connectMT5 } from '../../../mt5/connect.js';

export function createTools({ runtime, conversationId, define, optional }) {
  return [
    define('configuration_import_mt5', '导入用户在主会话直接粘贴的 MT5 MCP 导出（Claude JSON / Codex TOML）。使用 Sesame 提供的 source_message_id 引用与 configuration_read 的版本，密钥在后端私密传递。仅保存 Terminal / MetaEditor 连接；不修改交易、宿主权限或账户。保存后调用 mt5_connect 核验终端，mt5_catalog 单独核验 MetaEditor。', importMT5Properties,
      args => importMT5(runtime, conversationId, args)),
    define('mt5_connect', '自动检查并恢复本机 MT5 交易终端连接：验证 MCP 密钥、券商在线状态和绑定账户，重建失效会话；必要时以算法交易关闭的固定配置启动已配置终端。仅主 Agent 可用，不切换账户或开启权限。connected 仅证明 server=terminal 核验成功，不检查 MetaEditor、市场数据或 Python IPC。用户已提供导出时先 configuration_import_mt5，缺少凭据才打开设置，不读取或返回秘密。', {
      command_id: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$', description: '本次连接的唯一 ID；重试同一请求保留 ID，新检查使用新 ID' }),
      start_if_needed: Type.Optional(Type.Boolean({ description: '是否允许启动已配置且 MCP 已启用的终端，默认 true' })),
    }, (args, signal) => connectMT5(runtime, conversationId, args, signal)),
    define('configuration_read', '读取本应用当前模型、认证是否存在、MT5 脱敏设置与插件状态。不会读取秘密原文，也不登录、启动程序或交易。provider 可筛选供应商并查看其模型目录。', {
      section: Type.Optional(Type.Union(['all', 'mt5', 'model', 'preferences'].map(Type.Literal))), provider: optional('供应商 ID'),
    }, args => snapshot(runtime, conversationId, args.section, args.provider)),
    define('configuration_update', '按用户要求修改 MT5 连接设置及交易/宿主权限、导入本机配置、回复语言或已认证模型。MT5 先读 expected_version；其他目标不传版本。模型切换 queued 后等待当前回复及其他会话结束，之后读取结果确认。不修改插件策略，不接受秘密或启动 INI；用唯一 command_id 防止重复执行。', updateProperties,
      args => update(runtime, conversationId, args)),
    define('configuration_open', '为用户打开现有配置窗口，用于安全填写密钥/密码或完成浏览器授权。settings 是模型设置，mt5 是 MT5 连接设置。工具不会代替用户提交凭据或修改权限。', {
      dialog: Type.Union(['settings', 'mt5'].map(Type.Literal)),
    }, args => {
      requireValue(Object.keys(args).length === 1 && ['settings', 'mt5'].includes(args.dialog), '不支持的配置窗口');
      runtime.store.event('configuration.open', { dialog: args.dialog });
      return { status: 'requested', dialog: args.dialog };
    }),
  ];
}
