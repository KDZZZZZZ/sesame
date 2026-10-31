import { capability } from '@sesame/plugin-sdk/capabilities';
import { MiningRuntime } from './runtime.js';
import { ROLES, check } from './shared.js';

const instances = new Map();
export function createCapabilities(host) {
  const runtime = () => { const value = instances.get(host.context.storageRoot); check(value, 'NOT_ACTIVE', 'Activate the factor-mining plugin first'); return value; };
  const handlers = {
    auto_factor_models: () => { runtime().main(host); return { models: host.context.models, roles: ROLES }; },
    auto_factor_start: (args, signal) => runtime().create(host, args, signal),
    auto_factor_context: async (args, _signal, execution) => { const value = runtime().context(host, args.run_id, args.section, args.offset, args.limit, execution); await runtime().checkpoints.flush(); return value; },
    auto_factor_submit: (args, signal, execution) => runtime().submit(host, args.run_id, args.output, signal, execution, args.step_id),
    auto_factor_report: args => runtime().report(host, args.run_id),
    auto_factor_activity: args => { const service = runtime(), run = service.get(args.run_id); service.main(host, run); check(run.workflow, 'NOT_STARTED', 'The workflow has no execution yet'); return host.views.open({ surface: 'run', runId: run.workflow.id }); },
    auto_factor_runs: async args => {
      const service = runtime(); service.main(host);
      if (args.action === 'list') return { runs: await service.list(host) };
      const run = service.get(args.run_id); service.main(host, run);
      return args.action === 'read' ? service.observed(host, args.run_id) : service.control(host, args.run_id, args.action, args);
    },
    auto_factor_workflow: (args, signal, execution) => runtime().workflow(host, args.run_id, signal, execution),
    auto_factor_dependencies: args => runtime().dependencies(host, args.run_id),
    auto_factor_activate: async () => { const value = await new MiningRuntime(host).start(); instances.set(host.context.storageRoot, value); return { ready: true }; },
    auto_factor_dispose: async () => { const value = instances.get(host.context.storageRoot); if (value) { value.host = host; value.checkpoints.host = host; await value.dispose(); instances.delete(host.context.storageRoot); } return { closed: true }; },
  };
  return Object.entries(handlers).map(([name, execute]) => capability(name, execute));
}
