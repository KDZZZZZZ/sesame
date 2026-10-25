import { check } from '@sesame/plugin-sdk/protocol';
import { requirePlugin } from './calls.js';

export const EXECUTION_CONTRACT = 'sesame.execution-adapter/1';
export const READ_OPERATIONS = Object.freeze(['identity', 'snapshot', 'recover', 'command']);
export const WRITE_OPERATIONS = Object.freeze(['prepare', 'submit', 'cancel']);
// Historical safety floors are independent of the current package version. A
// version never proves readiness: every operation must ALSO declare the guarded
// service contract. Manual QMT guards existed before delegated task authority.
export const ADAPTER_FLOORS = Object.freeze({
  mt5: Object.freeze({ manual: '2.1.7', delegated: '2.1.0', prepare: '2.1.7' }),
  qmt: Object.freeze({ manual: '1.2.0', delegated: '1.4.0', prepare: '1.2.0' }),
});
const parseVersion = value => {
  if (typeof value !== 'string' || value.length > 200) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  return match ? { core: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split('.') ?? [] } : null;
};
export function atLeastVersion(value, floor) {
  const version = parseVersion(value), minimum = parseVersion(floor);
  if (!version || !minimum) return false;
  for (let i = 0; i < 3; i++) if (version.core[i] !== minimum.core[i]) return version.core[i] > minimum.core[i];
  if (!version.prerelease.length || !minimum.prerelease.length) return !version.prerelease.length || minimum.prerelease.length > 0;
  for (let i = 0; i < Math.max(version.prerelease.length, minimum.prerelease.length); i++) {
    const a = version.prerelease[i], b = minimum.prerelease[i];
    if (a === b) continue;
    if (a === undefined || b === undefined) return b === undefined;
    const numericA = /^\d+$/.test(a), numericB = /^\d+$/.test(b);
    return numericA && numericB ? BigInt(a) > BigInt(b) : numericA !== numericB ? !numericA : a > b;
  }
  return true;
}

export async function adapterOperation(host, backend, operation, { delegated = host.context?.kind === 'subagent' } = {}) {
  check(ADAPTER_FLOORS[backend] && [...READ_OPERATIONS, ...WRITE_OPERATIONS].includes(operation), 'Choose a declared native execution operation', 'UNSUPPORTED_CAPABILITY');
  check(operation !== 'prepare' || !delegated, 'Permission preparation belongs only to the main conversation', 'FORBIDDEN');
  const pluginId = `sesame/${backend}`, status = await requirePlugin(host, pluginId);
  const floor = operation === 'prepare' ? ADAPTER_FLOORS[backend].prepare : ADAPTER_FLOORS[backend][delegated ? 'delegated' : 'manual'];
  check(atLeastVersion(status.version, floor), `Use ${pluginId} ${floor}+ with the ${delegated ? 'delegated' : 'manual'} guarded execution contract`, 'PREREQUISITE_REQUIRED');
  const manifest = await host.plugins.read(pluginId, { part: 'manifest' });
  check(!manifest.version || manifest.version === status.version, 'Native adapter changed during contract selection', 'CAPABILITY_CHANGED');
  const services = manifest.services?.filter(row => row.contract === EXECUTION_CONTRACT);
  check(services?.length === 1, `${pluginId} must declare ${EXECUTION_CONTRACT}; package version alone is not execution readiness`, 'PREREQUISITE_REQUIRED');
  const id = services[0].operations?.[operation], declaration = manifest.capabilities?.find(row => row.id === id);
  check(declaration?.kind === 'function' && declaration.consumers?.includes('host') && declaration.outputSchema?.properties?.contract?.const === EXECUTION_CONTRACT,
    `${pluginId} does not declare the normalized ${operation} operation`, 'PREREQUISITE_REQUIRED');
  const effects = declaration.effects;
  check(Array.isArray(effects) && effects.length > 0, 'Execution operations must declare nonempty effects', 'PREREQUISITE_REQUIRED');
  if (READ_OPERATIONS.includes(operation)) check(effects.every(effect => ['backend.read', 'state.read', 'plugin.state.read', 'plugin.state.write', 'network', 'process'].includes(effect)), 'An execution read operation must not grant trading or permission changes', 'PREREQUISITE_REQUIRED');
  if (['submit', 'cancel'].includes(operation)) {
    const required = declaration.inputSchema?.required;
    check(effects.includes('external-trading') && Array.isArray(required) && (operation === 'submit'
      ? required.includes('observation') && required.includes('intent') && declaration.inputSchema.properties?.intent?.properties?.user_authorized?.const === true
      : required.includes('record') && required.includes('operationId')),
    'Execution writes must declare their guarded intent and trading effects', 'PREREQUISITE_REQUIRED');
  }
  return { pluginId, id, declaration };
}

export async function executionTools(host, backend) {
  const reads = [], writes = [];
  for (const operation of [...READ_OPERATIONS, 'submit', 'cancel']) {
    const { id } = await adapterOperation(host, backend, operation, { delegated: true });
    (READ_OPERATIONS.includes(operation) ? reads : writes).push(id);
  }
  return { reads, writes };
}

export function adapterResult(value, backend) {
  check(value?.contract === EXECUTION_CONTRACT && value.backend === backend, 'Native adapter returned an incompatible execution contract', 'SOURCE_DATA_INVALID');
  return value;
}
