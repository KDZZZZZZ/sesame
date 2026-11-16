import { readFileSync } from 'node:fs';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Initialize built-ins without moving authored details or changing source data. */
export function withEvidenceAppendix(html) {
  if (html.includes('data-report-native-charts') && !html.includes('id="sesame-report-native-charts"')) {
    html = html.replace(/<body[^>]*>/i, match => `${match}<script id="sesame-report-native-charts">${asset('assets/editorial-charts.js')}</script>`);
  }
  if (html.includes('data-report-math') && !html.includes('id="sesame-report-math-runtime"')) {
    const math = `<script id="sesame-report-math-runtime">${asset('assets/vendor/katex/katex.min.js')}\n${asset('assets/report-math.js')}</script>`;
    html = html.replace(/<\/body>/i, () => `${math}</body>`);
  }
  if (html.includes('id="sesame-report-detail-style"')) return html;
  const style = '<style id="sesame-report-detail-style">@media print{main details::details-content{content-visibility:visible}main details>:not(summary){display:block}}</style>';
  return html.replace(/<\/head>/i, () => `${style}</head>`);
}
