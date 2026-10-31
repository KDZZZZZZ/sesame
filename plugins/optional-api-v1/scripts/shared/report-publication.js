// Deterministic source; copied into independently installable workflow packages.
import { digest } from '@sesame/plugin-sdk/protocol';
import { invokeValue } from '@sesame/plugin-sdk/capabilities';
import { check } from './workflow-mechanics.js';
import { artifactRef, checkedArtifact, checkedReportReceipt, uniqueRefs } from './research-artifacts.js';

export const REPORT_CAPABILITIES = Object.freeze({
  describe: 'host.reports.describe', publish: 'sesame/reports#report_publish', inspect: 'sesame/reports#report_check', write: 'sesame/workspace#write',
});
export async function publishWorkflowReport(host, { operationId, title, summary, content, style, attachments = [], data = [], references = [], demo = false,
  features = [], locale = 'zh-CN', publication, onPublication = () => {}, signal }) {
  let saved = publication;
  if (!saved) {
    check(content && typeof content === 'object' && !Array.isArray(content), 'INVALID_REPORT_CONTENT', 'Workflow reports provide structured content and a built-in style, never HTML.');
    const description = await invokeValue(host, REPORT_CAPABILITIES.describe, {}, { signal });
    const schema = description?.inputSchema;
    const variants = schema?.properties?.content?.oneOf ?? schema?.properties?.content?.anyOf ?? [];
    check(description?.contract === 'sesame.report/1' && description?.provider?.pluginId === 'sesame/reports'
      && schema?.$id === 'urn:sesame:report:provider-input:1' && schema.properties.style
      && variants.some(variant => variant?.properties?.kind?.const === content.kind)
      && (!attachments.length || schema.properties.assets), 'REPORT_PROVIDER_UNSUPPORTED',
    `The fixed workflow adapter supports the declared sesame/reports content/style schema for ${content.kind}; selected provider ${description?.provider?.pluginId ?? 'unknown'} does not expose that interface. Research and frozen results remain saved. Use an Agent with host_reports_describe and host_reports_publish to adapt the existing evidence to the selected provider; this workflow never changes host provider settings.`);
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
    const result = await invokeValue(host, REPORT_CAPABILITIES.publish, { operation_id: operationId, title, summary, content, ...(style === undefined ? {} : { style }), data, assets,
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
