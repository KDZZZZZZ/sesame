import { capability } from '@sesame/plugin-sdk/capabilities';
import { ApiError, requireValue } from '../../backend/support.js';
import { compileFailure } from '../../backend/diagnostics.js';

export function createCapabilities(host, mt5) {
  const conversationId = host.context.sessionId;
  return [
    capability('mt5_project', async (args, signal) => {
      const allowed = { list: ['action'], create: ['action', 'title'], checkout: ['action', 'project_id'], save: ['action', 'checkout_id'], configure_risk: ['action', 'project_id', 'expected_version', 'test_risk_limits'] }[args.action];
      requireValue(allowed && Object.keys(args).every(key => allowed.includes(key)), '工程动作包含不适用的参数');
      if (args.action === 'list') return mt5.list();
      if (args.action === 'create') return mt5.create(args.title);
      if (args.action === 'configure_risk') { requireValue(host.context.kind === 'main', '只有主 Agent 可以修改用户的回测风险限制', 403); return mt5.configure(args.project_id, args.test_risk_limits, args.expected_version); }
      if (args.action === 'checkout') return mt5.checkout(host, args.project_id, signal, conversationId);
      return mt5.save(host, args.checkout_id, signal, conversationId);
    }),
    capability('mt5_inspect', args => {
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
    capability('mt5_compile', async (args, signal) => {
      const build = mt5.queueBuild(args.project_id, args.revision, conversationId, host);
      const result = await mt5.startBuild(build.id, signal);
      signal?.throwIfAborted();
      // Pi converts the rejection to an isError tool result and continues the
      // current model turn. The failed build and full log remain immutable.
      if (result.status === 'failed') throw new ApiError(422, 'compile_failed', JSON.stringify(compileFailure(result)));
      return result;
    }),
  ];
}
