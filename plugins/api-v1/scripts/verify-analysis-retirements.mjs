import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const contractDigest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
export const bytesDigest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const safePath = value => typeof value === 'string' && /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(value) && !value.split('/').some(part => ['.', '..'].includes(part));
const hash = value => assert.match(value, /^sha256:[a-f0-9]{64}$/);

/** Retirement is an explicit reviewed migration, never omission from a golden.
 * Old contracts authenticate against the immutable baseline. Current bindings,
 * numeric implementation, examples, attribution and license stay inspectable. */
export function verifyAnalysisRetirements(root, baselineBytes, review) {
  const baseline = JSON.parse(baselineBytes), retired = new Set();
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.status, 'approved', 'analysis retirement requires explicit approval');
  assert.equal(review.baselineSha256, bytesDigest(baselineBytes), 'analysis baseline bytes must remain immutable');
  assert.ok(Array.isArray(review.entries));
  for (const item of review.entries) {
    const original = baseline.packages.find(value => value.id === item.pluginId);
    assert.ok(original && !retired.has(item.pluginId), 'retirement must name a unique frozen identity');
    assert.equal(item.sourcePath, original.sourcePath);
    assert.ok(typeof item.reason === 'string' && item.reason.trim().length >= 20);
    assert.equal(item.decision, 'approved');
    assert.match(item.sourceEvidence.commit, /^[a-f0-9]{40}$/);
    assert.equal(item.sourceEvidence.path, item.sourcePath);
    assert.equal(item.previousManifest.id, item.pluginId);
    assert.equal(item.previousManifest.version, item.previousVersion);
    assert.equal(contractDigest(item.previousManifest), item.previousManifestDigest);
    assert.equal(contractDigest({ ...item.previousManifest, version: item.baselineVersion }), original.manifestDigest, 'previous manifest must reconstruct the complete frozen contract');
    assert.equal(contractDigest(item.previousDeclaration), original.declarationDigest, 'previous declaration must reconstruct the complete frozen contract');
    assert.equal(item.previousDeclarationDigest, original.declarationDigest);
    assert.equal(existsSync(join(root, item.sourcePath)), false, 'retired package must not remain as an alias');
    const distribution = item.sourcePath.split('/').slice(0, 2).join('/');
    assert.ok(!json(join(root, distribution, 'bundle-profile.json')).packages.includes(item.pluginId), 'retired identity remains in distribution');
    assert.ok(!Object.hasOwn(json(join(root, 'plugins/api-v1/inventory-policy.json')), item.pluginId.split('/')[1]), 'retired identity remains in inventory policy');
    const abuRegistry = join(root, distribution, 'abu-plugins.json');
    if (existsSync(abuRegistry)) assert.ok(!json(abuRegistry).some(entry => entry.id === item.pluginId), 'retired identity remains in ABU navigation');
    assert.match(item.replacementSourcePath, /^plugins\/(?:api-v1|optional-api-v1)\/packages\/[a-z][a-z0-9-]*$/);
    assert.notEqual(item.replacementPluginId, item.pluginId);
    const target = join(root, item.replacementSourcePath), manifest = json(join(target, 'plugin.json')), declaration = json(join(target, 'capabilities.json'));
    assert.equal(manifest.id, item.replacementPluginId);
    assert.equal(contractDigest({ ...manifest, version: item.replacementContract.version }), item.replacementContract.manifestDigest, 'replacement manifest changed beyond the reviewed migration');
    assert.equal(contractDigest(declaration), item.replacementContract.declarationDigest, 'replacement declaration changed beyond the reviewed migration');
    assert.equal(manifest.license, item.previousManifest.license, 'migration must retain the original license');
    assert.deepEqual(item.capabilityMappings.map(value => value.from).sort(), [...original.capabilityIds].sort(), 'every retired capability requires exactly one concrete replacement');
    assert.equal(new Set(item.capabilityMappings.map(value => value.to)).size, item.capabilityMappings.length);
    for (const mapping of item.capabilityMappings) {
      const before = item.previousDeclaration.capabilities.find(value => value.id === mapping.from), after = declaration.capabilities.find(value => value.id === mapping.to);
      assert.ok(before && after && mapping.from !== mapping.to);
      assert.equal(contractDigest(before), mapping.beforeDigest);
      assert.equal(contractDigest(after), mapping.afterDigest);
      assert.equal(after.binding.name, mapping.to, 'replacement must expose a real binding');
      for (const source of ['plugins/api-v1/packages', 'plugins/optional-api-v1/packages']) {
        if (!existsSync(join(root, source))) continue;
        for (const name of readdirSync(join(root, source))) {
          const path = join(root, source, name, 'capabilities.json');
          if (existsSync(path)) assert.ok(!json(path).capabilities.some(cap => cap.id === mapping.from || cap.binding?.name === mapping.from), 'retired capability must not survive as an alias');
        }
      }
    }
    assert.ok(Array.isArray(item.retainedFiles) && item.retainedFiles.length >= 5);
    const paths = new Set(), roles = new Set();
    for (const file of item.retainedFiles) {
      assert.ok(safePath(file.from) && safePath(file.to) && !paths.has(file.to));
      assert.ok(original.paths.includes(file.from), 'retained file must have belonged to the frozen source');
      hash(file.beforeSha256); hash(file.afterSha256);
      assert.equal(file.preservation, 'byte-identical');
      assert.equal(file.beforeSha256, file.afterSha256, 'claimed numerical/source preservation requires identical bytes');
      assert.equal(bytesDigest(readFileSync(join(target, file.to))), file.afterSha256, `retained ${file.role} bytes changed`);
      if (['example', 'method', 'provenance'].includes(file.role)) assert.ok(declaration.knowledge.some(entry => entry.path === file.to), 'retained references must remain declared and readable');
      paths.add(file.to); roles.add(file.role);
    }
    for (const role of ['algorithm', 'license', 'example', 'method', 'provenance']) assert.ok(roles.has(role), `retirement must preserve ${role}`);
    retired.add(item.pluginId);
  }
  return retired;
}
