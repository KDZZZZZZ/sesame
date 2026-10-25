import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageFiles } from './plugin-lock.mjs';

const publicRoot = fileURLToPath(new URL('../../../', import.meta.url));
const baselinePath = join(publicRoot, 'plugins/api-v1/tests/fixtures/plugin-boundaries-baseline.json');
const extensionsPath = join(publicRoot, 'plugins/api-v1/tests/fixtures/plugin-boundaries-configuration-extensions.json');
const reviewedPath = join(publicRoot, 'plugins/api-v1/tests/fixtures/plugin-boundaries-reviewed-changes.json');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

const withoutVersion = ({ version: _version, ...manifest }) => manifest;

export function compareBoundary(expected, actual) {
  const changes = [];
  // A release label is not a contract. Report it separately; a version bump
  // must neither fail an unchanged interface nor conceal an interface change.
  if (canonical(withoutVersion(expected.manifest)) !== canonical(withoutVersion(actual.manifest))) changes.push('plugin.json');
  const before = expected.declaration, after = actual.declaration;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key !== 'capabilities') {
      if (canonical(before[key]) !== canonical(after[key])) changes.push(`capabilities.json/${key}`);
      continue;
    }
    const oldCapabilities = new Map(before.capabilities.map(item => [item.id, item]));
    const newCapabilities = new Map(after.capabilities.map(item => [item.id, item]));
    if (oldCapabilities.size !== before.capabilities.length || newCapabilities.size !== after.capabilities.length) changes.push('duplicate capability ID');
    for (const id of new Set([...oldCapabilities.keys(), ...newCapabilities.keys()])) {
      if (canonical(oldCapabilities.get(id)) !== canonical(newCapabilities.get(id))) changes.push(`capability:${id}`);
    }
  }
  const paths = new Set(actual.paths);
  for (const path of expected.paths) if (!paths.has(path)) changes.push(`removed path:${path}`);
  return changes;
}

export function readBoundary(root, sourcePath) {
  const directory = join(root, sourcePath);
  return {
    sourcePath,
    manifest: json(join(directory, 'plugin.json')),
    declaration: json(join(directory, 'capabilities.json')),
    paths: packageFiles(directory).map(file => file.path),
  };
}

// Explicit, additive configuration rollout. The original compatibility snapshot
// stays immutable: no schema, authorization, state, contribution or path edits
// can be hidden by recapturing it after the refactor.
export function applyConfigurationExtensions(baseline, extensions) {
  const result = structuredClone(baseline), seen = new Set();
  for (const extension of extensions?.plugins ?? []) {
    const entry = result.packages.find(item => item.manifest.id === extension.pluginId);
    if (!entry || seen.has(extension.pluginId)) throw new Error(`Invalid configuration extension: ${extension.pluginId}`);
    seen.add(extension.pluginId);
    if (Object.keys(extension).some(key => !['pluginId', 'configurationTitle', 'fields', 'requirements', 'capabilities'].includes(key))) throw new Error('Only additive configuration extensions are permitted');
    const declaration = entry.declaration;
    if (extension.configurationTitle !== undefined) {
      if (declaration.configuration) throw new Error('Cannot replace an existing configuration authority declaration');
      declaration.configuration = { title: extension.configurationTitle, fields: [] };
    }
    for (const field of extension.fields ?? []) {
      if (!declaration.configuration || declaration.configuration.fields.some(item => item.id === field.id)) throw new Error(`Cannot replace configuration field ${field.id}`);
      declaration.configuration.fields.push(structuredClone(field));
    }
    for (const [id, additions] of Object.entries(extension.requirements ?? {})) {
      const capability = declaration.capabilities.find(item => item.id === id);
      if (!capability || !Array.isArray(additions)) throw new Error(`Unknown configuration consumer ${id}`);
      for (const requirement of additions) {
        if (!declaration.configuration?.fields.some(field => field.id === requirement.field) || capability.configurationRequirements?.some(item => item.field === requirement.field)) throw new Error(`Cannot replace configuration requirement ${id}/${requirement.field}`);
        (capability.configurationRequirements ??= []).push(structuredClone(requirement));
      }
    }
    for (const capability of extension.capabilities ?? []) {
      const configurationAdapter = declaration.configuration?.fields.some(field => field.binding?.type === 'capability'
        && [field.binding.read, field.binding.update].includes(capability.id));
      if (!configurationAdapter || declaration.capabilities.some(item => item.id === capability.id) || canonical(capability.consumers) !== '["host"]' || capability.kind !== 'function' || capability.execution !== 'immediate') throw new Error(`Only new host configuration adapters may be added: ${capability.id}`);
      declaration.capabilities.push(structuredClone(capability));
    }
  }
  return result;
}

const reviewDigest = value => `sha256:${createHash('sha256').update(canonical({ present: value !== undefined, value })).digest('hex')}`;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
function valueDeltas(before, after, path = '') {
  if (canonical(before) === canonical(after)) return [];
  if (plain(before) && plain(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .flatMap(key => valueDeltas(before[key], after[key], `${path}/${pointer(key)}`));
  return [{ path: path || '/', beforePresent: before !== undefined, afterPresent: after !== undefined,
    ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) }];
}
const schemaAnnotations = new Set(['title', 'description', 'examples']);
const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const schemaChildren = new Set(['additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains', 'not', 'if', 'then', 'else', 'items', 'additionalItems', 'unevaluatedItems', 'contentSchema']);
function documentationDelta(component, path) {
  const parts = path.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  const capability = component.startsWith('capability:');
  if (capability && (parts[0] === 'usage' || parts.length === 1 && parts[0] === 'description')) return true;
  if (component === 'plugin.json' && parts.length === 1 && ['title', 'description'].includes(parts[0])) return true;
  const schemaPath = capability && ['inputSchema', 'outputSchema'].includes(parts[0]) ? parts.slice(1)
    : component === 'capabilities.json/configSchema' ? parts : null;
  if (!schemaPath?.length) return false;
  // Property/$defs names are arbitrary data, even when named title, description
  // or properties. Only annotation keywords on an actual schema node are prose.
  let position = 'schema';
  for (let index = 0; index < schemaPath.length; index++) {
    const key = schemaPath[index];
    if (position === 'map') { position = 'schema'; continue; }
    if (position === 'array') {
      if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
      position = 'schema'; continue;
    }
    if (index === schemaPath.length - 1) return schemaAnnotations.has(key);
    if (schemaMaps.has(key)) position = 'map';
    else if (schemaArrays.has(key) || key === 'items' && /^(?:0|[1-9]\d*)$/.test(schemaPath[index + 1])) position = 'array';
    else if (!schemaChildren.has(key)) return false;
  }
  return false;
}

function impact(component, delta) {
  if (component.startsWith('removed path:')) return 'breaking-path-removal';
  if (component === 'duplicate capability ID') return 'invalid-declaration';
  if (component.startsWith('capability:') && delta.path === '/') return delta.beforePresent ? 'breaking-capability-removal' : 'additive-capability';
  if (/^\/permissions(?:\/|$)/.test(delta.path)) return 'authorization-restriction';
  if (delta.path === '/engines/sesame') return 'host-compatibility-change';
  if (documentationDelta(component, delta.path)) return 'documentation';
  if (delta.path === '/effects') return 'operational-effects-change';
  if (delta.path.startsWith('/inputSchema/') && delta.path.endsWith('/required') && Array.isArray(delta.after)) return delta.after.some(key => !(delta.before ?? []).includes(key)) ? 'breaking-required-input' : 'input-relaxation';
  if (delta.path.startsWith('/inputSchema/')) {
    if (!delta.beforePresent && /^\/inputSchema\/properties\/[^/]+$/.test(delta.path)) return 'additive-input-field';
    if (delta.path.endsWith('/additionalProperties') && delta.after === false) return 'breaking-input-restriction';
    if (/\/(?:maximum|maxLength|maxItems|maxProperties)$/.test(delta.path) && typeof delta.after === 'number' && (!delta.beforePresent || delta.after < delta.before)) return 'breaking-input-restriction';
    if (/\/(?:minimum|minLength|minItems|minProperties)$/.test(delta.path) && typeof delta.after === 'number' && (!delta.beforePresent || delta.after > delta.before)) return 'breaking-input-restriction';
    if (delta.path.endsWith('/enum') && Array.isArray(delta.after)) return !delta.beforePresent || delta.before.some(value => !delta.after.includes(value)) ? 'breaking-input-restriction' : 'input-relaxation';
    return 'input-contract-review';
  }
  if (component === 'capabilities.json/services') return 'service-contract-review';
  if (component === 'capabilities.json/knowledge') return 'resource-declaration-review';
  if (component === 'capabilities.json/artifactSchemas') return 'artifact-contract-review';
  if (delta.path.startsWith('/outputSchema')) return 'output-contract-review';
  return 'declaration-contract-review';
}

function conditionalInputRestrictions(before, after) {
  const branches = capability => ['anyOf', 'oneOf'].flatMap(keyword => (capability?.inputSchema?.[keyword] ?? []).flatMap((branch, index) => {
    const discriminator = Object.fromEntries(Object.entries(branch.properties ?? {}).filter(([, schema]) => plain(schema) && Object.hasOwn(schema, 'const')).map(([key, schema]) => [key, schema.const]));
    return Object.keys(discriminator).length ? [{ discriminator, required: [...capability.inputSchema.required ?? [], ...branch.required ?? []], path: `/inputSchema/${keyword}/${index}/required` }] : [];
  }));
  const previous = new Map(branches(before).map(branch => [canonical(branch.discriminator), branch]));
  return branches(after).flatMap(branch => {
    const prior = previous.get(canonical(branch.discriminator));
    if (!prior) return [];
    const added = branch.required.filter(field => !prior.required.includes(field));
    return added.length ? [{ impact: 'breaking-conditional-input', discriminator: branch.discriminator, addedRequired: added,
      beforePath: prior.path, afterPath: branch.path, before: prior.required, after: branch.required,
      reason: 'Previously accepted operations with this discriminator now require additional input fields.' }] : [];
  });
}

/** Exact, reviewable deltas; impact labels are conservative review hints, not an
 * automatic claim of semantic compatibility. Historical bytes remain untouched. */
export function createBoundaryReview(root = publicRoot, baseline = json(baselinePath), extensions = existsSync(extensionsPath) ? json(extensionsPath) : undefined) {
  const expectedBaseline = applyConfigurationExtensions(baseline, extensions), entries = [], versions = [];
  for (const expected of expectedBaseline.packages) {
    const actual = readBoundary(root, expected.sourcePath);
    if (expected.manifest.version !== actual.manifest.version) versions.push({ pluginId: expected.manifest.id, before: expected.manifest.version, after: actual.manifest.version });
    for (const component of compareBoundary(expected, actual)) {
      const value = entry => component === 'plugin.json' ? withoutVersion(entry.manifest)
        : component.startsWith('capability:') ? entry.declaration.capabilities.find(item => item.id === component.slice('capability:'.length))
          : component.startsWith('capabilities.json/') ? entry.declaration[component.slice('capabilities.json/'.length)]
            : component.startsWith('removed path:') ? entry.paths.includes(component.slice('removed path:'.length)) : entry.declaration.capabilities;
      const before = value(expected), after = value(actual);
      const deltas = valueDeltas(before, after).map(delta => ({ ...delta, impact: impact(component, delta) }));
      const findings = component.startsWith('capability:') && before && after ? conditionalInputRestrictions(before, after) : [];
      entries.push({ pluginId: expected.manifest.id, sourcePath: expected.sourcePath, component,
        beforeDigest: reviewDigest(before), afterDigest: reviewDigest(after), decision: 'pending', reason: '', deltas, findings });
    }
  }
  return { schemaVersion: 1, status: 'pending-review', baselineDigest: reviewDigest(baseline), extensionsDigest: reviewDigest(extensions),
    notice: 'Review exact before/after deltas. A version label is not approval. Set status and each decision to approved with an explicit reason only after contract review; any new drift invalidates that entry.', versions, entries };
}

export function applyApprovedBoundaryReview(failures, actual, reviewed) {
  if (reviewed === undefined) return failures;
  if (reviewed.schemaVersion !== 1 || reviewed.status !== 'approved' || reviewed.baselineDigest !== actual.baselineDigest || reviewed.extensionsDigest !== actual.extensionsDigest || !Array.isArray(reviewed.entries)) throw new Error('Boundary review must be explicitly approved against the same immutable baseline and extensions');
  const current = new Map(actual.entries.map(entry => [`${entry.pluginId}: ${entry.component}`, entry])), accepted = new Set();
  for (const entry of reviewed.entries) {
    const key = `${entry.pluginId}: ${entry.component}`, found = current.get(key);
    if (!found || accepted.has(key) || entry.component === 'duplicate capability ID' || entry.decision !== 'approved' || typeof entry.reason !== 'string' || entry.reason.trim().length < 20
      || entry.beforeDigest !== found.beforeDigest || entry.afterDigest !== found.afterDigest) throw new Error(`Stale, unapproved or unexplained boundary review: ${key}`);
    accepted.add(key);
  }
  return failures.filter(failure => !accepted.has(failure));
}

export function boundaryReport(root = publicRoot, baseline = json(baselinePath), extensions = existsSync(extensionsPath) ? json(extensionsPath) : undefined) {
  const expectedBaseline = applyConfigurationExtensions(baseline, extensions);
  const failures = [], versions = [];
  for (const expected of expectedBaseline.packages) {
    const actual = readBoundary(root, expected.sourcePath);
    if (expected.manifest.version !== actual.manifest.version) versions.push({ pluginId: expected.manifest.id, before: expected.manifest.version, after: actual.manifest.version });
    for (const change of compareBoundary(expected, actual)) failures.push(`${expected.manifest.id}: ${change}`);
  }
  return { packages: baseline.packages.length, declarations: baseline.packages.length * 2,
    capabilities: expectedBaseline.packages.reduce((sum, item) => sum + item.declaration.capabilities.length, 0), versions, failures };
}

export function checkBoundaries(root = publicRoot, baseline = json(baselinePath), extensions = existsSync(extensionsPath) ? json(extensionsPath) : undefined, reviewed = root === publicRoot && existsSync(reviewedPath) ? json(reviewedPath) : undefined) {
  const report = boundaryReport(root, baseline, extensions);
  if (reviewed !== undefined) report.failures = applyApprovedBoundaryReview(report.failures, createBoundaryReview(root, baseline, extensions), reviewed);
  if (report.failures.length) throw Object.assign(new Error(`Plugin boundary drift (requires contract review, not a version-label update):\n${report.failures.join('\n')}`), { report });
  const { packages, declarations, capabilities } = report;
  return { packages, declarations, capabilities };
}

/** A reproducible review candidate, never a replacement for historical evidence.
 * Scope comes from the checked-in fixture; no local planning directory is used.
 * Explicit output and exclusive creation prevent accidental golden recapture.
 */
export function captureBoundaryCandidate(output, root = publicRoot, baseline = json(baselinePath)) {
  if (!output || resolve(output) === resolve(baselinePath)) throw new Error('Choose a new candidate path; the compatibility baseline is immutable');
  const ids = new Set(), paths = new Set();
  const packages = baseline.packages.map(expected => {
    if (ids.has(expected.manifest.id) || paths.has(expected.sourcePath)) throw new Error('Duplicate baseline package scope');
    ids.add(expected.manifest.id); paths.add(expected.sourcePath);
    if (!/^plugins\/(?:api-v1|optional-api-v1)\/packages\/[a-z][a-z0-9-]*$/.test(expected.sourcePath)) throw new Error(`Invalid baseline source path: ${expected.sourcePath}`);
    const current = readBoundary(root, expected.sourcePath);
    if (current.manifest.id !== expected.manifest.id) throw new Error(`Baseline identity differs: ${expected.sourcePath}`);
    return current;
  });
  const candidate = { schemaVersion: 1, purpose: 'Unreviewed current-source candidate. Does not replace or approve changes to the immutable compatibility baseline.',
    parentDigest: `sha256:${createHash('sha256').update(canonical(baseline)).digest('hex')}`, packages };
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
  return candidate;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--capture' && args.length === 2) {
    const candidate = captureBoundaryCandidate(args[1]);
    console.log(JSON.stringify({ candidate: resolve(args[1]), packages: candidate.packages.length, accepted: false }));
  } else if (args[0] === '--review' && args.length === 2) {
    const review = createBoundaryReview();
    mkdirSync(dirname(resolve(args[1])), { recursive: true });
    writeFileSync(args[1], JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ review: resolve(args[1]), changes: review.entries.length, status: review.status }));
  } else if (args.length === 1 && args[0] === '--report') {
    const report = boundaryReport();
    console.log(JSON.stringify(report));
    if (report.failures.length) process.exitCode = 1;
  } else if (args.length === 0 || args.length === 1 && args[0] === '--check' || args.length === 2 && args[0] === '--approved') {
    try { console.log(JSON.stringify(args[0] === '--approved' ? checkBoundaries(undefined, undefined, undefined, json(args[1])) : checkBoundaries())); }
    catch (error) { console.error(JSON.stringify(error.report ?? { error: error.message })); process.exitCode = 1; }
  } else throw new Error('Use --check, --report, --review <new-review-path>, --approved <reviewed-path>, or --capture <new-candidate-path>; never overwrite a compatibility baseline');
}
