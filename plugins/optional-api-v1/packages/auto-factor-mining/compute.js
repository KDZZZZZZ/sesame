export function createCompute({ python }) {
  if (typeof python?.execute !== 'function') throw new TypeError('Compute requires python.execute');
  return {
    prepare(source, layout, budget, ctx) {
      return python.execute('prepare', { source, layout, budget }, ctx);
    },
    compute(snapshot, candidates, partition, ctx, diagnostics) {
      return python.execute('compute', { snapshot, candidates, partition, ...(diagnostics === undefined ? {} : { diagnostics }) }, ctx);
    },
  };
}
