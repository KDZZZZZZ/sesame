/** Numerical work and artifact handling belong to the injected Python bridge. */
export function createEvaluator({ python }) {
  if (!python || typeof python.execute !== 'function') throw new TypeError('python.execute is required');
  return Object.freeze({
    evaluate(values, profile, referenceValues, ctx) {
      return python.execute('evaluate', { values, profile, referenceValues }, ctx);
    },
  });
}
