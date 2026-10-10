import { catalogQuery, installCatalog } from './catalog.js';

export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const command = { command_id: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$', description: '稳定操作 ID；同一操作重试沿用此 ID' }) };
  const hash = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' });
  const path = { path: string('插件草稿的实际工作区路径，或相对当前真实工作区 root 的目录') };
  const installed = { plugin_id: string('已安装插件 ID，包括可显式更新的官方随附包') };
  const mutation = { ...installed, ...command, expected_digest: hash };
  const manage = (action, description, properties) => define(`plugin_${action}`, description, properties, (args, signal) => host.plugins.manage(action, args, signal));
  return [
    define('plugin_discover', '列出允许发现的插件元数据。不会加载提示词、skill 正文或工具；不可使用的插件不出现。', { query: optional('可选关键词') }, args => host.plugins.discover(args.query)),
    define('plugin_load', '按需加载当前会话允许的可发现插件并立即刷新本轮工具与提示词。加载不改变全局默认状态。', { plugin_id: string('插件 ID') }, args => host.plugins.load(args.plugin_id)),
    define('plugin_catalog', '查询统一 Plugin API 1 development 目录中的官方包与可选包，返回精确ID、格式、版本、固定release/source/摘要及catalog_digest。此目录不适用于稳定0.1.4；查询不会安装或准备依赖。', { plugin_id: optional('精确 sesame/name，可不填'), query: optional('关键词，可不填') }, (args, signal) => catalogQuery(args, signal)),
    define('plugin_install_catalog', '按固定catalog_digest获取官方或可选包并核验每文件/整包摘要。默认install只装缺失包；已有不同版本必须显式action:update和plugin_inspect返回的expected_digest，执行plugin_test→plugin_update，宿主保留版本/权限校验。同版本同摘要返回already-installed，禁用状态不改变。成功后刷新当前工具，依赖准备另行执行。', { ...command, plugin_id: string('目录精确 sesame/name'), catalog_digest: hash, action: Type.Optional(Type.Union(['install', 'update'].map(Type.Literal))), expected_digest: Type.Optional(hash) }, (args, signal) => installCatalog(host, args, signal)),
    define('plugin_read', '读取已挂载插件中声明的提示词、skill 或参考资源。传入插件 ID 和目录清单中的相对 path。', { plugin_id: string('插件 ID'), path: string('资源相对路径，例如 skills/analyze-data/SKILL.md') }, args => host.plugins.read(args.plugin_id, args.path)),
    define('plugin_inspect', '主 Agent 查看已安装插件的版本、摘要、状态和诊断；更新官方随附包也先读取其当前digest。不会激活插件。', installed, args => host.plugins.inspect(args.plugin_id)),
    manage('create', '主 Agent 创建标准插件草稿。mcp-python 模板自带波动率工具和测试；随后用 write/edit 修改。', { ...command, name: string('小写插件名称'), description: string('用途与触发条件'), version: optional('SemVer，默认 0.1.0'), template: Type.Optional(Type.Union(['skill', 'mcp-python'].map(Type.Literal))) }),
    manage('validate', '静态验证 sesame-native/apiVersion1、标准MCP、Claude/Codex与独立skill草稿；不执行代码。返回兼容诊断和内容摘要。', path),
    manage('test', '原生API1包仅检查清单、schema和JS语法，不执行工厂或实际工具，不证明行为安全。stdio MCP在本机当前用户权限下检查工具并执行包内断言；远程MCP仅读已授权schema。记录精确摘要与依赖锁。', path),
    manage('install', '安装通过对应检查的精确摘要，默认可发现；原生包实际执行activate。读取runtime_status与diagnostics，成功后plugin_load立即加载本轮工具。依赖下载与环境准备不会由此操作自动授权。', { ...path, ...command, digest: hash }),
    manage('set_state', '仅改变已安装外部插件的 mounted/discoverable/disabled 策略；不修改内置插件、网络授权或交易权限。', { ...installed, ...command, state: Type.Union(['mounted', 'discoverable', 'disabled'].map(Type.Literal)), expected_version: Type.Integer({ minimum: 1 }) }),
    manage('update', '从已测试草稿显式升级已安装插件，包括支持此能力的宿主提供的官方随附包；要求更高版本与匹配的expected_digest。保留旧包、状态及持久数据，不授予额外迁移权限。', { ...path, ...command, digest: hash, expected_digest: hash }),
    manage('rollback', '切换到已安装且已测试的历史摘要；保留 PLUGIN_DATA，不自动回滚业务数据。', { ...mutation, digest: hash }),
    manage('uninstall', '卸载外部插件并撤销工具注册；保留版本审计与持久数据。依赖方存在时拒绝。', mutation),
    manage('export', '将可兼容插件导出到当前工作区plugin-exports并返回实际路径；原生API1包不可无损转换成Claude/Codex，必须保留原生格式。不会安装到其他客户端。', { ...installed, ...command, target: Type.Union(['agent-plugins', 'claude', 'codex'].map(Type.Literal)) }),
  ];
}
