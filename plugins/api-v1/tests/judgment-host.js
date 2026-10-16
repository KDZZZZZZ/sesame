// Minimal declared host ports; evidence and private SQLite remain the real plugin implementation.
import { join } from 'node:path';
export { Store } from './mt5-host.js';
const snapshots = new WeakMap();
export const judgmentSnapshot = host => snapshots.get(host);
export function judgmentHost(store, { isActive = () => true } = {}) {
  const host = { context: { pluginId: 'sesame/judgment-evolution', storageRoot: join(store.directory, 'judgment-state'), sessionId: 'conv_main', kind: 'main' } };
  // Pure domain tests inject observed inputs; port integration is covered in ports.test.js.
  snapshots.set(host, () => ({
    sessions: new Map(store.list('conversation').map(item => [item.id, { id: item.id, kind: item.scope, activeResponseId: item.active_response_message_id }])),
    messages: new Map(store.list('message').map(item => [item.id, { ...item, replyTo: item.reply_to_message_id }])),
    datasets: new Map(store.list('dataset').map(item => [item.id, item])), enabled: isActive(),
  }));
  return host;
}
