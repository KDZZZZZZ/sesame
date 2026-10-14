export function createTools(host) {
  const { define, Type, optional } = host.tools;
  const object = properties => Type.Object(properties, { additionalProperties: false, minProperties: 1 });
  const identifier = () => Type.String({ minLength: 1, maxLength: 512, pattern: '^[^\\u0000-\\u001f\\u007f]+$' });
  const source = Type.Object({
    provider: Type.Object({ pluginId: identifier(), providerId: identifier() }, { additionalProperties: false }),
    connection: Type.Optional(Type.Object({ id: identifier(), revision: identifier() }, { additionalProperties: false })),
    accountId: Type.Optional(identifier()),
    accountConnectionId: Type.Optional(identifier()),
  }, { additionalProperties: false });
  const selected = Type.Object({ ...source.properties, accountId: identifier() }, { additionalProperties: false });
  const preferences = object({
    locale: Type.Optional(Type.Union(['zh-CN', 'en'].map(Type.Literal))),
    account_view: Type.Optional(object({ source: Type.Optional(Type.Union([source, Type.Null()])), sources: Type.Optional(Type.Array(source, { maxItems: 32 })), selected: Type.Optional(Type.Array(selected, { maxItems: 32, description: '当前勾选账户；沿用读取结果的 provider、精确 connection、accountId 与 accountConnectionId。空数组取消全部勾选。' })) })),
  });
  const model = object({ provider: Type.String({ minLength: 1, maxLength: 64 }), model: Type.String({ minLength: 1, maxLength: 200 }), thinking: Type.Optional(Type.Union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(Type.Literal))) });
  return [
    define('configuration_read', '按 section 读取配置：preferences 返回偏好与版本，model 返回模型与认证状态，all 才包含插件清单。recent_changes 是对应配置的简短状态回执，不含完整历史结果。连接设置由对应提供方插件管理。', { section: Type.Optional(Type.Union(['all', 'model', 'preferences'].map(Type.Literal))), provider: optional('供应商 ID') }, args => host.configuration.read(args)),
    define('configuration_update', '按用户要求修改回复语言、账户视图的精确连接/账户选择或已认证模型。偏好修改使用 configuration_read 返回的 preferences.version 作为 expected_version；不传凭据。模型切换不传 expected_version，queued 后等待本轮结束再确认。', {
      command_id: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }), target: Type.Union(['model', 'preferences'].map(Type.Literal)), expected_version: Type.Optional(Type.Integer({ minimum: 1 })), changes: Type.Union([model, preferences]),
    }, args => host.configuration.update(args)),
    define('configuration_open', '按用户要求打开设置，或处理无法复用的模型认证。后端环境和连接由对应插件主动发现、导入并验证，不用此工具让用户手填。', { dialog: Type.Literal('settings') }, args => host.configuration.open(args)),
  ];
}
