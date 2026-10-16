export function createTools({ runtime, conversationId, define, string, optional, Type }) {
  const command = { command_id: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$', description: '稳定操作 ID；同一操作重试沿用此 ID' }) };
  const hash = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' });
  const path = { path: string('沙箱中的插件目录，例如 /work/plugin-drafts/my-plugin') };
  const installed = { plugin_id: string('已安装的外部插件 ID') };
  const mutation = { ...installed, ...command, expected_digest: hash };
  const manage = (action, description, properties) => define(`plugin_${action}`, description, properties, (args, signal) => runtime.plugins.manager.execute(conversationId, action, args, signal));
  return [
    define('plugin_catalog', '查询官方 Sesame 插件目录；用户复制精确 sesame/name 时先查此工具。返回版本、来源提交、目录摘要和包摘要；区分内置与可安装标准包，不把审核声明当安全保证。', { query: optional('精确目录 ID 或关键词') }, (args, signal) => runtime.plugins.manager.official.catalog(args.query, signal)),
    define('plugin_install_catalog', '按已核对的官方精确 ID、版本和摘要集成插件。已内置包仅加载本地；外部标准包逐文件校验、隔离测试、固定依赖和安装回执；当前回合即可调用工具。', { ...command, id: string('精确官方目录 ID，如 sesame/web-extract'), version: string('plugin_catalog 返回的精确版本'), catalog_digest: hash, digest: Type.Optional(hash) }, (args, signal) => runtime.plugins.manager.official.install(conversationId, args, signal)),
    define('plugin_discover', '列出允许发现的插件元数据。不会加载提示词、skill 正文或工具；不可使用的插件不出现。', { query: optional('可选关键词') }, args => runtime.plugins.discover(conversationId, args.query)),
    define('plugin_load', '按需加载当前会话允许的可发现插件。配置助手仅供主 Agent 使用；加载不改变全局默认状态。', { plugin_id: string('插件 ID') }, async args => {
      const loaded = runtime.plugins.activate(conversationId, args.plugin_id);
      const session = await runtime.session(conversationId);
      runtime.plugins.apply(session, conversationId);
      return loaded;
    }),
    define('plugin_read', '读取已挂载插件中声明的提示词、skill 或参考资源。传入插件 ID 和目录清单中的相对 path。', { plugin_id: string('插件 ID'), path: string('资源相对路径，例如 skills/analyze-data/SKILL.md') }, args => runtime.plugins.read(conversationId, args.plugin_id, args.path)),
    define('plugin_inspect', '主 Agent 查看已安装外部插件的版本、摘要、诊断和可回滚版本；不会激活插件。', installed, args => {
      runtime.plugins.manager.installation(args.plugin_id);
      return { policy_version: runtime.plugins.policy().version, ...runtime.plugins.summary(runtime.plugins.entry(args.plugin_id), conversationId) };
    }),
    manage('create', '主 Agent 创建标准插件草稿。mcp-python 模板自带波动率工具和测试；随后用 write/edit 修改。', { ...command, name: string('小写插件名称'), description: string('用途与触发条件'), version: optional('SemVer，默认 0.1.0'), template: Type.Optional(Type.Union(['skill', 'mcp-python'].map(Type.Literal))) }),
    manage('validate', '静态验证标准/Claude/Codex/独立 skill 草稿；不执行代码。返回兼容诊断和内容摘要。', path),
    manage('test', '在隔离沙箱中检查 stdio 工具并执行包内测试；远程 MCP 只读取用户已授权连接的 schema。记录摘要和依赖锁。', path),
    manage('install', '安装已通过测试的精确摘要，默认可发现。不会覆盖内置插件或赋予宿主权限；注册表当轮刷新，随后 plugin_load 即可调用。', { ...path, ...command, digest: hash }),
    manage('set_state', '仅改变已安装外部插件的 mounted/discoverable/disabled 策略；不修改内置插件、网络授权或交易权限。', { ...installed, ...command, state: Type.Union(['mounted', 'discoverable', 'disabled'].map(Type.Literal)), expected_version: Type.Integer({ minimum: 1 }) }),
    manage('update', '从已测试草稿升级外部插件；要求更高版本和匹配的当前摘要。保留旧包及持久数据。', { ...path, ...command, digest: hash, expected_digest: hash }),
    manage('rollback', '切换到已安装且已测试的历史摘要；保留 PLUGIN_DATA，不自动回滚业务数据。', { ...mutation, digest: hash }),
    manage('uninstall', '卸载外部插件并撤销工具注册；保留版本审计与持久数据。依赖方存在时拒绝。', mutation),
    manage('export', '将已安装插件导出为标准、Claude 或 Codex 目录到 /work/plugin-exports；不安装到用户的其他客户端。', { ...installed, ...command, target: Type.Union(['agent-plugins', 'claude', 'codex'].map(Type.Literal)) }),
  ];
}
