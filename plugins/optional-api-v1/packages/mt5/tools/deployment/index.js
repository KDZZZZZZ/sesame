import { capability } from '@sesame/plugin-sdk/capabilities';
import { records } from '../../backend/records.js';
export function createCapabilities(host, mt5) {
  const conversationId = host.context.sessionId;
  const view = row => ({ ...row, run_record: mt5.runObserver?.reference('deployment', row.id) ?? null });
  return [capability('mt5_deployment', async args => {
    const service = mt5.deployments;
    if (args.action === 'list') return { items: service.list().map(view), candidates: service.candidates(), preparations: service.preparations() };
    if (args.action === 'check') return { ...await service.check(args.pass_id), run_record: mt5.runObserver?.reference('tester', args.pass_id) ?? null };
    return view(await (args.action === 'stop' ? service.stop(args.deployment_id) : service.requestMount(args.pass_id, args.request_id, args, records(host), conversationId)));
  })];
}
