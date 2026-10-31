/* Render authored LaTeX as native MathML, without external assets or fonts. */
(() => {
  'use strict';
  const render = root => {
    for (const node of root.querySelectorAll('[data-report-math]:not([data-math-rendered])')) {
      const latex = node.getAttribute('data-report-math') || node.textContent;
      node.innerHTML = katex.renderToString(latex, { output: 'mathml', displayMode: node.getAttribute('data-display') !== 'inline', throwOnError: true, trust: false, strict: 'error', maxExpand: 1000, maxSize: 20 });
      node.setAttribute('data-math-rendered', 'true');
    }
  };
  const boot = () => render(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
  Object.defineProperty(window, 'SesameMath', { value: Object.freeze({ render }), configurable: false });
})();
