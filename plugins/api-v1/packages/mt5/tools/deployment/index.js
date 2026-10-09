export function createTools(host, mt5) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  return [define('mt5_deployment', '与面板共用的受管理挂载。先 list/check，用户要求挂载时才用 mount；必须传入检查返回的账户、构建校验值与稳定 request_id。仅支持已回测冻结 EX5。unknown 不换 ID 重试；stop 停止 EA，不平仓。', {
    action: Type.Union(['list', 'check', 'mount', 'stop'].map(Type.Literal)), pass_id: optional('已成功回测的 pass_id'), deployment_id: optional('挂载 ID'),
    request_id: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })), login: optional('检查返回的账户'), server: optional('检查返回的服务器'), artifact_digest: optional('检查返回的冻结 EX5 摘要'),
  }, args => {
    const service = mt5.deployments;
    return args.action === 'list' ? { items: service.list(), candidates: service.candidates(), preparations: service.preparations() } : args.action === 'check' ? service.check(args.pass_id) : args.action === 'stop' ? service.stop(args.deployment_id) : service.requestMount(args.pass_id, args.request_id, args, host.configuration, conversationId);
  })];
}
