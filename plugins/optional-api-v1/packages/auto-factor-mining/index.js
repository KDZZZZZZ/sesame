import definitions from './tools.json' with { type: 'json' };
import { MiningRuntime } from './runtime.js';
import { ROLES, check } from './shared.js';
import { MiningActivityViewer } from './viewer.js';

const instances = new Map();
export async function activate(host, options = {}) {
  const runtime = new MiningRuntime(host, options);
  runtime.start(); runtime.viewer = new MiningActivityViewer(runtime); instances.set(host.storage.directory, runtime);
  return { async dispose() { try { await runtime.viewer.dispose(); await runtime.dispose(); } finally { instances.delete(host.storage.directory); } } };
}
export function createTools(host) {
  const { define, Type } = host.tools;
  // Lazy lookup keeps the factory pure for both main/subagent host probes.
  const runtime = () => { const value = instances.get(host.storage.directory); check(value, 'NOT_ACTIVE', 'Activate the factor-mining plugin first'); return value; };
  const handlers = {
    auto_factor_models: () => ({ models: host.inference.models(), roles: ROLES }),
    auto_factor_start: (args, signal) => runtime().create(host, args, signal),
    auto_factor_context: args => runtime().context(host, args.run_id, args.section, args.offset, args.limit),
    auto_factor_submit: (args, signal) => runtime().submit(host, args.run_id, args.output, signal),
    auto_factor_finalize: (args, signal) => runtime().finalize(host, args.run_id, signal),
    auto_factor_report: args => runtime().report(host, args.run_id),
    auto_factor_activity: args => args.action === 'read' ? runtime().viewer.read(host, args.run_id) : runtime().viewer.open(host, args.run_id),
    auto_factor_runs: args => {
      const service = runtime(); service.main(host);
      if (args.action === 'list') return { runs: service.list(host) };
      const run = service.get(args.run_id); service.main(host, run);
      return args.action === 'read' ? run : service.control(host, args.run_id, args.action);
    },
  };
  return definitions.map(spec => define(spec.name, spec.description, Object.fromEntries(Object.entries(spec.parameters.properties).map(([key, schema]) =>
    [key, spec.parameters.required?.includes(key) ? schema : Type.Optional(schema)])), handlers[spec.name]));
}
