import { readFileSync } from 'node:fs';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Presentation only: preserve authored data, node identities and callbacks. */
export function withEvidenceAppendix(html) {
  if (html.includes('data-report-native-charts') && !html.includes('id="sesame-report-native-charts"')) {
    html = html.replace(/<body[^>]*>/i, match => `${match}<script id="sesame-report-native-charts">${asset('assets/editorial-charts.js')}</script>`);
  }
  if (html.includes('data-report-math') && !html.includes('id="sesame-report-math-runtime"')) {
    const math = `<script id="sesame-report-math-runtime">${asset('assets/vendor/katex/katex.min.js')}\n${asset('assets/report-math.js')}</script>`;
    html = html.replace(/<\/body>/i, () => `${math}</body>`);
  }
  if (html.includes('id="sesame-evidence-appendix-runtime"')) return html;
  const style = `<style id="sesame-evidence-appendix-style">${asset('assets/report-appendix.css')}</style>`;
  const script = `<script id="sesame-evidence-appendix-runtime">${asset('assets/report-appendix.js')}</script>`;
  return html.replace(/<\/head>/i, () => `${style}</head>`).replace(/<\/body>/i, () => `${script}</body>`);
}
