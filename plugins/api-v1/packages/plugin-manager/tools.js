import { catalogQuery, installCatalog } from './catalog.js';
import { createNativeDraft } from './scaffold.js';

export function createCapabilities(host) {
  return [
    { name: 'plugin_discover', execute: input => host.plugins.search(input) },
    { name: 'plugin_load', execute: ({ pluginId }) => host.plugins.setEnabled(pluginId, true, { scope: 'session' }) },
    { name: 'plugin_catalog', execute: (input, signal) => catalogQuery(input, signal) },
    { name: 'plugin_install_catalog', execute: (input, signal) => installCatalog(host, input, signal) },
    { name: 'plugin_read', execute: ({ pluginId, part, path }) => host.plugins.read(pluginId, { part, path }) },
    { name: 'plugin_inspect', execute: ({ pluginId }) => host.plugins.read(pluginId, { part: 'status' }) },
    { name: 'plugin_create', execute: (input, signal) => createNativeDraft(host, input, signal) },
    { name: 'plugin_install', execute: ({ path, digest, operationId }, signal) => host.plugins.install({ path, digest }, { operationId, signal }) },
    { name: 'plugin_set_state', execute: ({ pluginId, enabled, scope, expectedVersion }) => host.plugins.setEnabled(pluginId, enabled, { scope, expectedVersion }) },
    { name: 'plugin_update', execute: ({ pluginId, path, digest, expectedRevision, operationId }, signal) => host.plugins.update(pluginId, { path, digest }, { expectedRevision, operationId, signal }) },
    { name: 'plugin_uninstall', execute: ({ pluginId, expectedRevision, operationId }, signal) => host.plugins.remove(pluginId, { expectedRevision, operationId, signal }) },
  ];
}
