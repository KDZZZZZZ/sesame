import { writeWorkspace } from './files.js';
import { capability } from '@sesame/plugin-sdk/capabilities';
import { requireValue } from './support.js';
import { groupTool } from './plugin-routing.js';

export function officialTool(host, mt5, group) {
  const conversationId = host.context.sessionId;
  const official = mt5.official;
  return capability(groupTool(group), async ({ save_as, ...args }, signal) => {
    requireValue(official.route(args.server, args.tool).group === group, '该方法属于其他插件，请按目录中的 agent_tool 调用', 403, 'mt5_wrong_plugin');
    const command = await official.call(args, conversationId, signal);
    if (!save_as) return command;
    await writeWorkspace(host, save_as, JSON.stringify(command, null, 2), signal);
    const { result, ...summary } = command; return { ...summary, saved_to: save_as };
  });
}
