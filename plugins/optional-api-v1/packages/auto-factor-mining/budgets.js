import { ensure } from './contracts.js';

// The job record holds only totals and currently reserved worker slots, never
// an unbounded history. Completed attempt receipts stay in the journal.
export function createBudgets(journal) {
  const usage = job => job.byteUsage ?? { input: 0, output: 0, active: {} };
  return {
    async available(jobId) {
      const job = await journal.get(jobId), used = usage(job), active = Object.values(used.active);
      return { maxInputBytes: job.budget.maxInputBytes - used.input - active.reduce((n, r) => n + r.input, 0), maxOutputBytes: job.budget.maxOutputBytes - used.output - active.reduce((n, r) => n + r.output, 0) };
    },
    async reserve(ctx, token, inputBytes, serialOutput = false) {
      const saved = await journal.update(ctx.jobId, job => {
        ensure(job.epoch === ctx.epoch && ['running', 'pausing'].includes(job.status), 'Attempt cannot reserve work after cancellation', 'CANCELLED');
        const used = usage(job); if (used.active[token]) return job;
        const current = Object.values(used.active), inputRemaining = job.budget.maxInputBytes - used.input - current.reduce((n, r) => n + r.input, 0), outputRemaining = job.budget.maxOutputBytes - used.output - current.reduce((n, r) => n + r.output, 0);
        ensure(Number.isSafeInteger(inputBytes) && inputBytes > 0 && inputBytes <= inputRemaining && outputRemaining >= 1024, 'Research byte budget exhausted', 'BUDGET_EXHAUSTED');
        ensure(current.length < job.budget.maxWorkers, 'All byte-budget worker slots are occupied', 'RESOURCE_EXHAUSTED');
        const output = Math.min(outputRemaining, serialOutput ? outputRemaining : Math.max(1024, Math.floor(job.budget.maxOutputBytes / job.budget.maxWorkers)));
        return { ...job, byteUsage: { ...used, active: { ...used.active, [token]: { input: inputBytes, output } } } };
      }, ctx.signal);
      return saved.byteUsage.active[token];
    },
    async settle(ctx, token, actual) {
      let exceeded = false;
      await journal.update(ctx.jobId, job => {
        exceeded = false;
        const used = usage(job), reserved = used.active[token]; if (!reserved) return job;
        const active = { ...used.active }; delete active[token];
        ensure(Number.isSafeInteger(actual.input) && actual.input >= 0 && Number.isSafeInteger(actual.output) && actual.output >= 0, 'Invalid byte accounting');
        exceeded = actual.input > reserved.input || actual.output > reserved.output;
        return { ...job, byteUsage: { input: used.input + actual.input, output: used.output + actual.output, active } };
      });
      ensure(!exceeded, 'Worker exceeded its reserved byte budget', 'BUDGET_EXHAUSTED');
    },
  };
}
