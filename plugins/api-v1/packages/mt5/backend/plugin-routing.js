import groups from './tool-groups.json' with { type: 'json' };

// Native tool ownership is package data. No host registry or private runtime is
// inspected to discover a platform method.
export const builtinRoutes = () => groups;
export function pluginRoute(entries, server, method, category, permission) {
  const match = [...entries].sort((a, b) => b.rule.priority - a.rule.priority).find(({ rule }) =>
    (!rule.servers || rule.servers.includes(server)) && (!rule.methods || rule.methods.includes(method)) &&
    (!rule.exclude_methods || !rule.exclude_methods.includes(method)) &&
    (!rule.categories || rule.categories.includes(category)) && (!rule.permissions || rule.permissions.includes(permission)));
  return { plugin_id: match ? 'sesame/mt5' : null, agent_tool: match?.tool ?? null, group: match?.id ?? null };
}
export const groupTool = group => groups.find(entry => entry.id === group)?.tool;
