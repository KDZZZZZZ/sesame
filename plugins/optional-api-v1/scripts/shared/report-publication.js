// Deterministic source; copied into independently installable workflow packages.
import { digest } from '@sesame/plugin-sdk/protocol';
import { invokeValue } from '@sesame/plugin-sdk/capabilities';
import { check } from './workflow-mechanics.js';
import { artifactRef, checkedArtifact, checkedReportReceipt, uniqueRefs } from './research-artifacts.js';

export const REPORT_CAPABILITIES = Object.freeze({
  template: 'sesame/reports#report_document_template', publish: 'sesame/reports#report_publish', inspect: 'sesame/reports#report_check', write: 'sesame/workspace#write',
});
export async function publishWorkflowReport(host, { operationId, title, summary, bodyHTML, attachments = [], data = [], references = [], demo = false,
  features = [], locale = 'zh-CN', publication, onPublication = () => {}, signal }) {
  let saved = publication;
  if (!saved) {
    const root = `workflow-reports/${digest(operationId).slice(7)}`;
    const refs = uniqueRefs([...references, ...data.map(binding => binding.ref)]);
    let isDemo = demo;
    for (const ref of refs) {
      check(artifactRef(ref), 'INVALID_RESEARCH_EVIDENCE', 'Report evidence must use complete pinned artifact references.');
      const { manifest } = await checkedArtifact(host, ref, ref.kind);
      if ((manifest.provenance ?? manifest.content?.provenance)?.kind === 'demo') isDemo = true;
    }
    const assets = [];
    for (const file of attachments) {
      check(typeof file.path === 'string' && /^[A-Za-z0-9_.-]+$/.test(file.path) && !['.', '..', 'index.html', 'report.html'].includes(file.path), 'INVALID_REPORT_DOCUMENT', 'Report attachment requires a safe unique file name.');
      check(!assets.some(asset => asset.path === file.path), 'INVALID_REPORT_DOCUMENT', 'Report attachment paths must be unique.');
      const source_path = `${root}/${file.path}`;
      await invokeValue(host, REPORT_CAPABILITIES.write, { path: source_path, content: file.content }, { signal });
      assets.push({ path: file.path, source_path, media_type: file.mediaType });
    }
    const template = await invokeValue(host, REPORT_CAPABILITIES.template, { title, locale, body_html: (isDemo ? '<aside role="note">DEMO · 演示数据</aside>' : '') + bodyHTML, output_path: `${root}/report.html` }, { signal });
    check(template?.path === `${root}/report.html` && template.runtime === 'sesame-report/1' && template.runtimeRevision === '1.0.0', 'INVALID_REPORT_TEMPLATE', 'Report service must return the requested document path and supported runtime.');
    const result = await invokeValue(host, REPORT_CAPABILITIES.publish, { operation_id: operationId, title, summary, html_path: template.path, data, assets,
      related: [], references: refs, features, locale, provenance_kind: isDemo ? 'demo' : 'derived' }, { signal });
    check(artifactRef(result?.ref, 'report'), 'REPORT_PUBLICATION_UNKNOWN', 'Report publication did not return an exact report ArtifactRef; reconcile the original operation ID.');
    saved = { ref: result.ref, entry: 'index.html', attachments: attachments.map(({ path, mediaType }) => ({ path, mediaType })), state: 'published', renderStatus: 'not_checked' };
    // Persist publication before inspection: an inspector failure is not a failed
    // publication and must not repeat a completed Agent, evaluation or trade.
    await onPublication(structuredClone(saved));
  }
  check(artifactRef(saved.ref, 'report'), 'REPORT_PUBLICATION_UNKNOWN', 'Retained publication must name its original fixed report revision.');
  await invokeValue(host, REPORT_CAPABILITIES.inspect, { ref: saved.ref }, { signal });
  const inspection = await checkedReportReceipt(host, saved.ref);
  return { ...saved, renderStatus: 'rendered', inspection };
}
