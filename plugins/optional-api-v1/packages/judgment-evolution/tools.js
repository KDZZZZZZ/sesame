import { readFileSync } from 'node:fs';
import { capability } from '@sesame/plugin-sdk/capabilities';
import { instance, setInstance } from './state.js';
import { JudgmentService } from './service.js';
import { digest } from './support.js';

const handlers = {
  judgment_review_queue: 'reviewQueue', judgment_review_due: 'reviewDue', judgment_record: 'record',
  judgment_list: 'query', judgment_read: 'read', judgment_resolve: 'resolve', judgment_defer: 'defer',
  judgment_rule: 'proposeRule', judgment_reflect: 'reflect', judgment_audit_source: 'auditSource',
  judgment_rules: 'rules', judgment_retire_rule: 'retireRule', judgment_coverage: 'acknowledgeCoverage',
};

export function createCapabilities(host) {
  return [
    ...Object.entries(handlers).map(([name, method]) => capability(name, async (input, signal) => {
      const value = await instance(host).invoke(host, method, [host.context.sessionId, name === 'judgment_read' ? input.judgment_id : input], signal);
      const path = value.path ?? value.criteria_path;
      if (!path) return value;
      const content = readFileSync(path, 'utf8'), hash = digest(content);
      const draft = await host.resources.create({ kind: 'blob', lifetime: 'durable', name: `judgment-criteria-${hash.replace(/^sha256:/, '')}.md`, source: { content }, policy: { readOnly: true } }, { operationId: `criteria:${hash}`, signal });
      const { ref: criteria } = await host.resources.publish(draft, {
        kind: 'resource', schemaVersion: '1.0.0',
        content: { type: 'judgment-criteria', title: '专属判断准则', path: 'CRITERIA.md', contentDigest: hash },
        dependencies: [], blobs: [{ entry: 'content', path: 'CRITERIA.md', mediaType: 'text/markdown' }],
      }, { operationId: `criteria-publish:${hash}`, signal });
      const { path: _path, criteria_path: _criteriaPath, ...result } = value;
      return { ...result, criteria };
    })),
    capability('judgment_activate', () => { setInstance(host, new JudgmentService(host).init()); return { ready: true }; }),
    capability('judgment_dispose', () => { instance(host).close(); setInstance(host, null); return { closed: true }; }),
    capability('judgment_after_turn', async (event, signal) => { await instance(host).invoke(host, 'auditTurn', [event], signal); return { completed: true }; }),
  ];
}
