import { readFileSync } from 'node:fs';
import { digest } from '@sesame/plugin-sdk/protocol';
const handlers = { judgment_review_queue: 'reviewQueue', judgment_review_due: 'reviewDue', judgment_record: 'record', judgment_list: 'query', judgment_read: 'read', judgment_resolve: 'resolve', judgment_defer: 'defer', judgment_reflect: 'reflect', judgment_rule: 'proposeRule', judgment_rules: 'rules', judgment_retire_rule: 'retireRule', judgment_audit_source: 'auditSource', judgment_coverage: 'acknowledgeCoverage' };
export function createJudgmentCapabilities(host, getService) {
  return Object.entries(handlers).map(([name, method]) => ({ name: `manual_${name}`, execute: async (input, signal) => {
    const value = await getService().invoke(host, method, [host.context.sessionId, name === 'judgment_read' ? input.judgment_id : input], signal);
    const path = value.path ?? value.criteria_path;
    if (!path) return value;
    const content = readFileSync(path, 'utf8'), hash = digest(content);
    const draft = await host.resources.create({ kind: 'blob', lifetime: 'durable', name: `manual-judgment-criteria-${hash.replace(/^sha256:/, '')}.md`, source: { content }, policy: { readOnly: true } }, { operationId: `criteria:${hash}`, signal });
    const { ref: criteria } = await host.resources.publish(draft, {
      kind: 'resource', schemaVersion: '1.0.0',
      content: { type: 'judgment-criteria', title: '手动交易专属判断准则', path: 'CRITERIA.md', contentDigest: hash },
      dependencies: [], blobs: [{ entry: 'content', path: 'CRITERIA.md', mediaType: 'text/markdown' }],
    }, { operationId: `criteria-publish:${hash}`, signal });
    const { path: _path, criteria_path: _criteriaPath, ...result } = value;
    return { ...result, criteria };
  } }));
}
