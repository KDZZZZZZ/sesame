import { capability } from '@sesame/plugin-sdk/capabilities';
import { records } from '../../backend/records.js';
import { officialTool } from '../../backend/plugin-tools.js';
import { requireValue, digest } from '../../backend/support.js';
export function createCapabilities(host, mt5) {
  const conversationId = host.context.sessionId;
  const tester = mt5.tester;
  const reference = pass => mt5.runObserver?.reference('tester', pass.id) ?? null;
  const view = job => ({ ...job, passes: job.passes.map(pass => ({ ...pass, run_record: reference(pass) })) });
  return [officialTool(host, mt5, 'tester'), capability('mt5_backtest_operation', args => {
    const operation = records(host).get('operation', `tester-start-${args.command_id}`, true);
    if (!operation?.result?.id) return { command_id: args.command_id, status: 'not-found', note: 'No committed receipt. This does not prove a prior dispatch did not start; never resend an uncertain attempt.' };
    const job = tester.get(operation.result.id);
    requireValue(job.conversation_id === conversationId, 'Backtest receipt belongs to another conversation', 403, 'FORBIDDEN');
    return { command_id: args.command_id, status: job.status, result: view(job) };
  }), capability('mt5_backtest', async (args, signal) => {
    const fields = { start: ['action', 'command_id', 'build_id', 'config', 'parameter_space'], get: ['action', 'backtest_id'], wait: ['action', 'backtest_id'], stop: ['action', 'backtest_id'], list: ['action', 'project_id'] };
    requireValue(Object.keys(args).every(k => fields[args.action].includes(k)), '回测动作包含不适用的参数');
    if (args.action === 'list') return tester.list(args.project_id).map(job => ({ ...job, run_records: tester.get(job.id).passes.map(pass => ({ pass_id: pass.id, record: reference(pass) })) }));
    if (args.action === 'start') {
      requireValue(typeof args.command_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id), 'start 需要稳定的 command_id');
      const job = await records(host).idempotentAsync(`tester-start-${args.command_id}`, digest(JSON.stringify([conversationId, args])), async () => {
        const job = await tester.queue(args.build_id, args.config, args.parameter_space, conversationId, null, host);
        void tester.start(job.id).catch(() => {}); return job;
      });
      return view(job);
    }
    if (args.action === 'stop') return view(tester.stop(args.backtest_id, conversationId));
    if (args.action === 'wait') {
      await new Promise(resolve => {
        const timer = setTimeout(done, 20000);
        function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
        signal?.addEventListener('abort', done, { once: true });
        (tester.pending.get(args.backtest_id)?.promise ?? Promise.resolve()).then(done, done);
      });
    }
    return view(tester.get(args.backtest_id));
  })];
}
