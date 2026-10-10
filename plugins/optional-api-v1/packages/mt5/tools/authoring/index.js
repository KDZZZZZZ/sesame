import { ApiError, requireValue } from '../../backend/support.js';
import { compileFailure } from '../../backend/diagnostics.js';

export function createTools(host, mt5) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  return [
    define('mt5_project', '管理独立 MQL5 工程。create 创建 visual-mql-v1 空骨架；先读 visual-state-machines skill 和语言参考。save 严格解析、检查类型/效果/预算，并从同一 IR 生成原生代码与图；源码诊断是可恢复工具错误。旧工程继续按原模板编辑。草稿不能回测。', {
      action: Type.Union(['list', 'create', 'checkout', 'save', 'configure_risk'].map(Type.Literal)), title: optional('新工程名称'), project_id: optional('工程 ID'), checkout_id: optional('当前会话 checkout ID'),
      expected_version: Type.Optional(Type.Integer({ minimum: 1 })),
      test_risk_limits: Type.Optional(Type.Object({ max_risk_per_trade_pct: Type.Number({ exclusiveMinimum: 0 }), max_daily_loss_pct: Type.Number({ exclusiveMinimum: 0 }), max_open_positions: Type.Integer({ minimum: 1 }), max_lots: Type.String({ maxLength: 24 }) }, { additionalProperties: false, description: 'configure_risk 由主 Agent 按用户任务修改；仅影响随后创建的测试，既有构建和任务保留冻结参数' })),
    }, async (args, signal) => {
      const allowed = { list: ['action'], create: ['action', 'title'], checkout: ['action', 'project_id'], save: ['action', 'checkout_id'], configure_risk: ['action', 'project_id', 'expected_version', 'test_risk_limits'] }[args.action];
      requireValue(allowed && Object.keys(args).every(key => allowed.includes(key)), '工程动作包含不适用的参数');
      if (args.action === 'list') return mt5.list();
      if (args.action === 'create') return mt5.create(args.title);
      if (args.action === 'configure_risk') { requireValue(host.scope.kind === 'main', '只有主 Agent 可以修改用户的回测风险限制', 403); return mt5.configure(args.project_id, args.test_risk_limits, args.expected_version); }
      if (args.action === 'checkout') return mt5.checkout(box, args.project_id, signal, conversationId);
      return mt5.save(box, args.checkout_id, signal, conversationId);
    }),
    define('mt5_inspect', '查看本机能力、工程源码及生成逻辑摘要、冻结构建诊断。engine_node_id 可按源节点下钻到输入、调用目标和源码。checked 表示严格源码已校验；declared 只是旧工程手写声明；均不代表 Tester 已通过。', {
      project_id: optional('工程 ID'), build_id: optional('构建 ID'), engine_node_id: optional('严格工程中需要展开的节点 ID；必须同时给出 project_id 或 build_id'),
    }, args => {
      requireValue(!(args.project_id && args.build_id), 'project_id 和 build_id 二选一');
      if (args.engine_node_id) {
        requireValue(args.project_id || args.build_id, '节点查询需要 project_id 或 build_id');
        const owner = args.build_id ? mt5.storage.get('mt5_build', args.build_id) : mt5.project(args.project_id);
        const revision = mt5.storage.get('mt5_revision', `${args.project_id ?? owner.project_id}:${owner.revision}`), engine = revision.engine;
        const node = engine?.nodes.find(n => n.id === args.engine_node_id); requireValue(node, '此版本没有该生成节点', 404);
        return { revision: owner.revision, engine_digest: engine.digest, node, edges: engine.edges.filter(e => e.from === node.id || e.to === node.id), source: revision.files[node.source.file].slice(node.source.start, node.source.end) };
      }
      if (args.build_id) return mt5.storage.get('mt5_build', args.build_id);
      if (args.project_id) {
        const project = mt5.project(args.project_id), engine = project.engine;
        return { ...project, engine: engine ? { language: engine.language, digest: engine.digest, verification: engine.verification, functions: engine.functions, ports: engine.ports, limits: engine.limits } : null };
      }
      return mt5.status();
    }),
    define('mt5_compile', '冻结已保存 revision、平台 SDK 和本机标准库，按已配置引擎调用本机 MetaEditor；默认无需虚拟机，原生进程按本次任务管理与清理。成功返回 EX5 摘要；失败作为可恢复工具错误返回构建 ID、诊断与修复指引，修改 checkout 并 save 新 revision 后重试。不执行 EA。', {
      project_id: string('工程 ID'), revision: Type.Integer({ minimum: 1, description: '明确指定已保存的源码版本' }),
    }, async (args, signal) => {
      const build = mt5.queueBuild(args.project_id, args.revision, conversationId);
      const result = await mt5.startBuild(build.id, signal);
      signal?.throwIfAborted();
      // Pi converts the rejection to an isError tool result and continues the
      // current model turn. The failed build and full log remain immutable.
      if (result.status === 'failed') throw new ApiError(422, 'compile_failed', JSON.stringify(compileFailure(result)));
      return result;
    }),
  ];
}
