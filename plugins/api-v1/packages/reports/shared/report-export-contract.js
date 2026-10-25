import { analyzeReportHtml } from './report-html.js';

// One budget and print contract for both isolated renderer adapters.
export const REPORT_EXPORT = Object.freeze({
  width: 1000, maxHeight: 64000, maxPixels: 64 * 1024 * 1024,
  maxOutput: 32 * 1024 * 1024, timeout: 45000,
  singleImageHeight: 16000, imageSliceHeight: 8000,
  paperWidth: 8.2677, paperHeight: 11.6929, margin: 0.25, scale: 0.7457,
});
export const REPORT_EXPORT_FORMATS = Object.freeze(['pdf', 'png']);
export class ReportExportError extends Error {
  constructor(message) { super(message); this.name = 'ReportExportError'; this.status = 422; this.code = 'report_export_invalid'; }
}

/** Cheap author advice, not a rendering receipt or permission to relocate HTML. */
export function reportExportAdvice(html, assets = []) {
  const analysis = analyzeReportHtml(html);
  const documents = [analysis, ...assets.filter(asset => /^(?:text\/html|image\/svg\+xml)(?:;|$)/i.test(asset.mediaType ?? '')).map(asset => analyzeReportHtml(asset.text))];
  const pdfReasons = [];
  if (documents.some(value => value.elements.some(el => ['animate', 'animatemotion', 'animatetransform', 'set', 'video', 'audio'].includes(el.name))))
    pdfReasons.push({ code: 'static_media', message: 'Static PDF cannot preserve animated SVG or audio/video state. Keep the interactive report, or author a separate faithful static view.' });
  if (documents.some(value => value.elements.some(el => el.attributes.some(attr => attr.name === 'shadowrootmode'))))
    pdfReasons.push({ code: 'shadow_dom', message: 'Static PDF cannot preserve report shadow DOM. Use ordinary DOM/SVG for the static view.' });
  const pending = { code: 'render_required', message: 'Source checks do not verify runtime resources, fonts, canvas state, layout, completeness or output budgets. Run export preflight on the exact revision.' };
  const formats = {
    pdf: { status: pdfReasons.length ? 'unsupported' : 'needs-render-check', reasons: pdfReasons.length ? pdfReasons : [pending] },
    png: { status: 'needs-render-check', reasons: [pending] },
  };
  return { checked: 'source', outputVerified: false, supportedFormats: [], candidateFormats: REPORT_EXPORT_FORMATS.filter(format => formats[format].status !== 'unsupported'), formats,
    source: { selfContained: analysis.selfContained, relocatable: analysis.relocatable, reasons: analysis.reasons }, limits: REPORT_EXPORT };
}
