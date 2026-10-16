export function createTools(host) {
  const { define, Type, optional } = host.tools;
  const object = properties => Type.Object(properties, { additionalProperties: false, minProperties: 1 });
  const preferences = object({ locale: Type.Union(['zh-CN', 'en'].map(Type.Literal)) });
  const model = object({ provider: Type.String({ minLength: 1, maxLength: 64 }), model: Type.String({ minLength: 1, maxLength: 200 }), thinking: Type.Optional(Type.Union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(Type.Literal))) });
  return [
    define('configuration_read', '读取模型、认证状态、偏好和已安装插件。不会返回秘密或启动程序。连接设置由对应提供方插件管理。', { section: Type.Optional(Type.Union(['all', 'model', 'preferences'].map(Type.Literal))), provider: optional('供应商 ID') }, args => host.configuration.read(args)),
    define('configuration_update', '按用户要求修改回复语言或已认证模型。模型切换 queued 后等待本轮结束，再读取结果确认。', {
      command_id: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }), target: Type.Union(['model', 'preferences'].map(Type.Literal)), changes: Type.Union([model, preferences]),
    }, args => host.configuration.update(args)),
    define('configuration_open', '打开现有模型设置窗口，供用户安全填写凭据或完成授权。', { dialog: Type.Literal('settings') }, args => host.configuration.open(args)),
  ];
}
