export function createTools(host, mt5) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  const view = row => ({ ...row, run_record: mt5.runObserver?.reference('deployment', row.id) ?? null });
  return [define('mt5_deployment', '受管理的原生挂载。先 list/check，用户要求挂载时才用 mount；必须传入检查返回的账户、构建校验值与稳定 request_id。check 的 ready:false 若 preparable:true，授权 mount 会自动处理算法交易启用/构建准备并再次核验；不要猜测或调用 MCP 开关。仅支持已回测冻结 EX5。SVL 运行返回固定版本 run_record，可绑定报告 related.run；旧原生工程为 null。unknown 不换 ID 重试；stop 停止 EA，不平仓。', {
    action: Type.Union(['list', 'check', 'mount', 'stop'].map(Type.Literal)), pass_id: optional('已成功回测的 pass_id'), deployment_id: optional('挂载 ID'),
    request_id: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })), login: optional('检查返回的账户'), server: optional('检查返回的服务器'), artifact_digest: optional('检查返回的冻结 EX5 摘要'),
  }, async args => {
    const service = mt5.deployments;
    if (args.action === 'list') return { items: service.list().map(view), candidates: service.candidates(), preparations: service.preparations() };
    if (args.action === 'check') return { ...await service.check(args.pass_id), run_record: mt5.runObserver?.reference('tester', args.pass_id) ?? null };
    return view(await (args.action === 'stop' ? service.stop(args.deployment_id) : service.requestMount(args.pass_id, args.request_id, args, host.configuration, conversationId)));
  })];
}
