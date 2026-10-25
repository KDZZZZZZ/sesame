/** Descriptive navigation only: these labels never grant capabilities or installation authority. */
export const FUNCTIONAL_CATEGORIES = [
  { id: 'business', title: { en: 'Task workflows', zh: '业务流程' } },
  { id: 'analysis', title: { en: 'Knowledge and analysis', zh: '专业能力' } },
  { id: 'integration', title: { en: 'Resource integrations', zh: '资源接入' } },
  { id: 'presentation', title: { en: 'Presentation and interaction', zh: '交互呈现' } },
  { id: 'platform', title: { en: 'Platform management', zh: '平台管理' } },
];

export const IMPLEMENTATION_KINDS = [
  { id: 'knowledge', title: { en: 'Knowledge documents', zh: '知识文档' } },
  { id: 'function', title: { en: 'Deterministic function', zh: '确定性函数与计算' } },
  { id: 'adapter', title: { en: 'Source, engine or platform adapter', zh: '来源、引擎与平台适配' } },
  { id: 'workflow', title: { en: 'Agent or workflow', zh: 'Agent与工作流' } },
  { id: 'service', title: { en: 'Host service, state or presentation', zh: '宿主服务、状态与呈现' } },
];

const legacyCategories = new Set(['workspace', 'data', 'backend', 'strategy', 'research']);
const functionalCategories = new Set(FUNCTIONAL_CATEGORIES.map(item => item.id));
const implementationKinds = new Set(IMPLEMENTATION_KINDS.map(item => item.id));
const fields = new Set(['category', 'functionalCategory', 'implementationKinds', 'implementationReason', 'title', 'summary', 'dependencies']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (condition, message) => { if (!condition) throw new Error(message); };

/** Infer the smallest exposed implementation, not every implementation detail.
 * A native stub or a reference Python/JS script is not an exposed capability.
 * Specialized declarations supersede their mechanical function/lifecycle glue.
 * The reviewed policy may explain semantics not expressible in declarations,
 * but cannot manufacture execution or hide declared workflows/sources.
 */
export function deriveImplementationKinds(manifest, declaration, files, reviewed) {
  const paths = new Set(files), capabilities = declaration.capabilities ?? [];
  const hooks = declaration.hooks ?? [];
  const native = capabilities.some(capability => capability.binding?.type === 'native') || hooks.length > 0;
  fail(!native || typeof manifest.entry === 'string' && paths.has(manifest.entry), `${manifest.id}: exposed native implementation requires a packaged entry`);
  fail(!capabilities.some(capability => capability.binding?.type === 'mcp') || manifest.execution === 'mcp' && paths.has('mcp.json'), `${manifest.id}: exposed MCP implementation requires packaged server declarations`);
  const workflow = capabilities.some(capability => ['agent', 'workflow'].includes(capability.kind) || ['agent', 'graph'].includes(capability.binding?.type));
  const source = (declaration.sources ?? []).length > 0;
  const adapter = source || capabilities.some(capability => capability.binding?.type === 'mcp');
  const service = hooks.length > 0 || (declaration.services ?? []).length > 0 || (declaration.views ?? []).length > 0;
  const derived = [workflow ? 'workflow' : adapter ? 'adapter' : service ? 'service' : capabilities.length ? 'function' : 'knowledge'];
  if (!reviewed) return derived;
  const expected = reviewed.implementationKinds;
  if (JSON.stringify(expected) === JSON.stringify(derived)) {
    fail(reviewed.implementationReason === undefined, `${manifest.id}: stale implementation exception; declarations now express ${derived[0]}`);
    return derived;
  }
  fail(typeof reviewed.implementationReason === 'string' && reviewed.implementationReason.trim().length >= 20, `${manifest.id}: reviewed implementation ${JSON.stringify(expected)} differs from exposed ${derived[0]}; explain a curated implementationReason or update the policy`);
  fail(Array.isArray(expected) && expected.length > 0 && expected.every(kind => implementationKinds.has(kind)) && new Set(expected).size === expected.length, `${manifest.id}: invalid implementation exception`);
  fail(derived[0] !== 'knowledge' && !expected.includes('knowledge'), `${manifest.id}: implementation policy cannot create or hide exposed execution`);
  fail(!workflow || expected.includes('workflow'), `${manifest.id}: implementation policy cannot hide a declared workflow`);
  fail(!source || expected.includes('adapter'), `${manifest.id}: implementation policy cannot hide a declared source adapter`);
  return [...expected];
}

export function validateInventoryPolicy(policy, packageNames) {
  fail(object(policy), 'Inventory policy must be an object');
  fail(new Set(packageNames).size === packageNames.length, 'Duplicate package identity across distributions');
  for (const name of packageNames) fail(Object.hasOwn(policy, name), `Missing reviewed package explanation: sesame/${name}`);
  const names = new Set(packageNames);
  fail(Object.keys(policy).every(name => names.has(name)), 'Inventory policy contains absent packages');
  for (const [name, entry] of Object.entries(policy)) {
    fail(object(entry), `${name}: reviewed classification must be an object`);
    fail(Object.keys(entry).every(key => fields.has(key)), `${name}: Unknown policy field`);
    fail(legacyCategories.has(entry.category), `${name}: invalid legacy category`);
    fail(functionalCategories.has(entry.functionalCategory), `${name}: invalid functional category`);
    fail(Array.isArray(entry.implementationKinds) && entry.implementationKinds.length > 0 && entry.implementationKinds.every(kind => implementationKinds.has(kind)) && new Set(entry.implementationKinds).size === entry.implementationKinds.length, `${name}: implementationKinds requires unique supported implementation kinds`);
    fail(entry.implementationReason === undefined || typeof entry.implementationReason === 'string' && entry.implementationReason.trim().length >= 20, `${name}: implementationReason must explain the curated exception`);
    for (const field of ['title', 'summary', 'dependencies']) fail(object(entry[field]) && ['en', 'zh'].every(locale => typeof entry[field][locale] === 'string' && entry[field][locale].trim()), `${name}: ${field} requires English and Chinese text`);
  }
}
