import { randomUUID } from 'node:crypto';
import { records } from './records.js';
import { CONFIG_FIELDS, CREDENTIAL_FIELDS } from './schema.js';
import { SOURCE_KINDS } from './sources.js';

const DEFAULTS = Object.freeze({ fmp_key_env: 'FMP_API_KEY', fred_key_env: 'FRED_API_KEY', sec_user_agent_env: 'SEC_USER_AGENT', reddit_token_env: 'REDDIT_ACCESS_TOKEN', reddit_user_agent_env: 'REDDIT_USER_AGENT' });
export const SOURCE_CREDENTIAL_FIELDS = Object.freeze({ sec: ['sec_user_agent_env'], fmp: ['fmp_key_env'], fred: ['fred_key_env'], reddit: ['reddit_token_env', 'reddit_user_agent_env'], cftc: [] });

const fail = (condition, message, code = 'INVALID_ARGUMENT') => { if (!condition) throw Object.assign(new Error(message), { code }); };

// Credential values remain in host configuration; private plugin records contain
// only environment-variable names. This module never contacts remote sources.
export function createConfiguration(host, { now = Date.now, env = process.env } = {}) {
  const config = () => ({ ...DEFAULTS, ...records(host).get('research_config', 'default', true)?.values });
  const credential = field => {
    const value = env[config()[field]];
    fail(typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value), 'A required source environment variable is unavailable.', 'SOURCE_CREDENTIAL_MISSING');
    return value.trim();
  };
  return {
    credential,
    status() {
      const settings = config();
      return {
        plugin_id: 'sesame/financial-research', configuration: settings,
        credentials: Object.fromEntries(Object.entries(CREDENTIAL_FIELDS).map(([id, field]) => {
          try { credential(field); return [id, true]; } catch { return [id, false]; }
        })),
        sources: Object.entries(SOURCE_KINDS).map(([provider, kinds]) => ({ provider, kinds, configured: SOURCE_CREDENTIAL_FIELDS[provider].every(field => { try { credential(field); return true; } catch { return false; } }), required_environment_names: SOURCE_CREDENTIAL_FIELDS[provider].map(field => settings[field]) })),
      };
    },
    async configure(input, signal) {
      fail(host.context?.kind === 'main', 'Research configuration requires the main conversation.', 'MAIN_ONLY');
      fail(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => CONFIG_FIELDS.includes(key) || key === 'credentials' || key === 'command_id'), 'Use credentials for source values and *_env fields for optional environment-variable names.');
      const { credentials, command_id, ...mapping } = input;
      fail(command_id === undefined || typeof command_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(command_id), 'command_id requires 16–128 letters, digits, underscores or hyphens.');
      for (const value of Object.values(mapping)) fail(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value), 'The *_env fields require environment-variable names; put source values in credentials.');
      const settings = { ...config(), ...mapping };
      if (credentials !== undefined) {
        fail(credentials && typeof credentials === 'object' && !Array.isArray(credentials) && Object.keys(credentials).length > 0 && Object.keys(credentials).every(key => Object.hasOwn(CREDENTIAL_FIELDS, key)), 'credentials supports fmp_api_key, fred_api_key, sec_user_agent, reddit_access_token and reddit_user_agent.');
        const changes = {};
        for (const [key, value] of Object.entries(credentials)) {
          fail(value === null || typeof value === 'string' && value.trim().length > 0 && value.length <= 8192 && !/[\r\n\0]/.test(value), 'Each credential must be a nonempty single-line value of at most 8192 characters or null to remove it.');
          const name = settings[CREDENTIAL_FIELDS[key]], normalized = value === null ? null : value.trim();
          fail(!Object.hasOwn(changes, name) || changes[name] === normalized, 'Different source credentials cannot overwrite the same environment-variable name.');
          changes[name] = normalized;
        }
        signal?.throwIfAborted();
        const result = await host.capabilities.invoke('host.configuration.update', { command_id: command_id ?? `research-config-${randomUUID()}`, target: 'environment', changes }, { mode: 'inline', signal });
        fail(result?.type === 'result' && result.value?.status === 'applied', 'Host configuration has not been applied; read application configuration before retrying.', 'CONFIGURATION_NOT_APPLIED');
      }
      // Values belong to host configuration. This plugin stores only the public
      // variable-name mapping, after the host has accepted the credential update.
      records(host).put('research_config', { id: 'default', values: settings, updated_at: new Date(now()).toISOString() });
    },
  };
}
