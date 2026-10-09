import { requireValue } from './support.js';
import { groupTool } from './plugin-routing.js';

export function officialTool(host, mt5, group) {
  const { define, optional, string, Type } = host.tools;
  const conversationId = host.scope.conversationId, box = host.workspace;
  const official = mt5.official;
  return define(groupTool(group), `调用 ${group} 所属的官方能力。先从 mt5_catalog 获取精确 tool / inputSchema；其他插件的方法不能从此入口调用。command_id 沿用同一动作的稳定 ID；结果 unknown 时先核对真实状态。save_as 可保存大 JSON。`, {
    server: Type.Union(['terminal', 'metaeditor', 'marketdata', 'python', 'launcher'].map(Type.Literal)),
    tool: string('目录返回的精确方法名'), arguments: Type.Object({}, { additionalProperties: true }),
    command_id: Type.String({ pattern: '^[a-zA-Z0-9_-]{16,128}$', description: '唯一稳定 ID，推荐 UUID；同一动作重试必须沿用' }), save_as: optional('完整结果的 /work JSON 文件路径'),
  }, async ({ save_as, ...args }, signal) => {
    requireValue(official.route(args.server, args.tool).group === group, '该方法属于其他插件，请按目录中的 agent_tool 调用', 403, 'mt5_wrong_plugin');
    const command = await official.call(args, conversationId, signal);
    if (!save_as) return command;
    await box.file('write', save_as, JSON.stringify(command, null, 2), signal);
    const { result, ...summary } = command; return { ...summary, saved_to: save_as };
  });
}
