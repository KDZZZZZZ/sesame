export function createTools(host) {
  const { define, Type, optional } = host.tools;
  const object = properties => Type.Object(properties, { additionalProperties: false, minProperties: 1 });
  const identifier = () => Type.String({ minLength: 1, maxLength: 512, pattern: '^[^\\u0000-\\u001f\\u007f]+$' });
  const source = Type.Object({
    provider: Type.Object({ pluginId: identifier(), providerId: identifier() }, { additionalProperties: false }),
    connection: Type.Optional(Type.Object({ id: identifier(), revision: identifier() }, { additionalProperties: false })),
    accountId: Type.Optional(identifier()),
  }, { additionalProperties: false });
  const preferences = object({
    locale: Type.Optional(Type.Union(['zh-CN', 'en'].map(Type.Literal))),
    account_view: Type.Optional(object({ source: Type.Optional(Type.Union([source, Type.Null()])), sources: Type.Optional(Type.Array(source, { maxItems: 32 })) })),
  });
  const model = object({ provider: Type.String({ minLength: 1, maxLength: 64 }), model: Type.String({ minLength: 1, maxLength: 200 }), thinking: Type.Optional(Type.Union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(Type.Literal))) });
  return [
    define('configuration_read', '读取模型、认证状态、偏好和已安装插件。不会返回秘密或启动程序。连接设置由对应提供方插件管理。', { section: Type.Optional(Type.Union(['all', 'model', 'preferences'].map(Type.Literal))), provider: optional('供应商 ID') }, args => host.configuration.read(args)),
    define('configuration_update', '按用户要求修改回复语言、账户视图的精确连接/账户选择或已认证模型。偏好修改使用 configuration_read 返回的 preferences.version 作为 expected_version；不传凭据。模型切换不传 expected_version，queued 后等待本轮结束再确认。', {
      command_id: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }), target: Type.Union(['model', 'preferences'].map(Type.Literal)), expected_version: Type.Optional(Type.Integer({ minimum: 1 })), changes: Type.Union([model, preferences]),
    }, args => host.configuration.update(args)),
    define('configuration_open', '打开现有模型设置窗口，供用户安全填写凭据或完成授权。', { dialog: Type.Literal('settings') }, args => host.configuration.open(args)),
  ];
}
