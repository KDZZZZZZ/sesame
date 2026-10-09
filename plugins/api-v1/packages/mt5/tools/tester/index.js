import { officialTool } from '../../backend/plugin-tools.js';
import { requireValue, digest } from '../../backend/support.js';
export function createTools(host, mt5) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  const tester = mt5.tester;
  return [officialTool(host, mt5, 'tester'), define('mt5_backtest', '受管理的真实 MT5 Tester。start 用冻结 build_id 和明确 config 创建任务；可用 parameter_space 穷举最多 64 组。get/list 查看，wait 最多等待 20 秒，stop 显式停止。结果自动登记后端数据；完成不等于策略有效。', {
    action: Type.Union(['start', 'get', 'list', 'wait', 'stop'].map(Type.Literal)), build_id: optional('编译成功的构建 ID'), backtest_id: optional('回测任务 ID'), project_id: optional('list 可按工程过滤'),
    command_id: Type.Optional(Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$', description: 'start 必填的稳定任务请求 ID；重试同一请求不会重复启动 Tester' })),
    config: Type.Optional(Type.Object({ symbol: string('券商精确品种名'), period: string('M1/H1 等原生周期'), from_date: string('YYYY-MM-DD，券商服务器日期'), to_date: string('YYYY-MM-DD，排除终止日'), deposit: Type.Number({ exclusiveMinimum: 0 }), currency: string('USD 等货币'), leverage: Type.Integer({ minimum: 1, maximum: 1000 }), model: Type.Union([0,1,2,4].map(Type.Literal)), parameters: Type.Object({}, { additionalProperties: Type.Union([Type.String(), Type.Number(), Type.Boolean()]) }) }, { additionalProperties: false })),
    parameter_space: Type.Optional(Type.Object({}, { additionalProperties: Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), { minItems: 1 }) })),
  }, async (args, signal) => {
    const fields = { start: ['action', 'command_id', 'build_id', 'config', 'parameter_space'], get: ['action', 'backtest_id'], wait: ['action', 'backtest_id'], stop: ['action', 'backtest_id'], list: ['action', 'project_id'] };
    requireValue(Object.keys(args).every(k => fields[args.action].includes(k)), '回测动作包含不适用的参数');
    if (args.action === 'list') return tester.list(args.project_id);
    if (args.action === 'start') {
      requireValue(typeof args.command_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id), 'start 需要稳定的 command_id');
      return host.storage.idempotent(`tester-start-${args.command_id}`, digest(JSON.stringify([conversationId, args])), () => {
        const job = tester.queue(args.build_id, args.config, args.parameter_space, conversationId);
        void tester.start(job.id).catch(() => {}); return job;
      });
    }
    if (args.action === 'stop') return tester.stop(args.backtest_id, conversationId);
    if (args.action === 'wait') {
      await new Promise(resolve => {
        const timer = setTimeout(done, 20000);
        function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
        signal?.addEventListener('abort', done, { once: true });
        (tester.pending.get(args.backtest_id)?.promise ?? Promise.resolve()).then(done, done);
      });
    }
    return tester.get(args.backtest_id);
  })];
}
