import { AgentDecisionService } from './agent-decisions.js';
import { startDecisionBridge } from './decision-bridge.js';

const services = new Map();
const key = host => host.storage.directory;
const service = host => {
  let result = services.get(key(host));
  if (!result) { result = new AgentDecisionService(host); services.set(key(host), result); }
  return result;
};
export function activateDecisions(host) {
  const instance = service(host);
  return { async dispose() { if (instance.bridgePromise) await instance.bridgePromise.catch(() => {}); await instance.bridge?.close(); await instance.close(); if (services.get(key(host)) === instance) services.delete(key(host)); } };
}
function view(job) {
  return { id: job.id, requestId: job.request.requestId, status: job.status, scope: job.request.scope, role: job.request.program.role, mode: job.request.mode,
    programDigest: job.programDigest, inputDigest: job.inputDigest, attempts: job.attempts, output: job.output, decision: job.decision ?? null, error: job.error ?? null,
    limitations: job.limitations ?? [], failurePolicy: job.request.program.failurePolicy };
}

export function createDecisionTools(host) {
  const { define, Type, optional } = host.tools;
  return [define('strategy_decision', 'Run an isolated versioned Agent signal or risk decision with the configured model and frozen artifact inputs. Submit is asynchronous; status waits optionally, cancel/invalidate retire requests, timeline exports actual saved outputs without new model calls. Never places orders.', {
    action: Type.Union(['models', 'submit', 'status', 'cancel', 'invalidate', 'timeline', 'bridge_start', 'bridge_stop'].map(action => Type.Literal(action))),
    request_path: optional('Workspace JSON decision request conforming to references/agent-inputs.md'),
    job_id: optional('Job ID returned by submit; selects its portfolio run for invalidate/timeline'),
    wait: Type.Optional(Type.Boolean({ description: 'Wait for this one job to finish; cancellation of the tool wait does not cancel the job' })),
    reason: optional('Reason for cancel or invalidation'),
    as_of_ms: Type.Optional(Type.Integer({ minimum: 0, description: 'UTC time for timeline replay or cancel/invalidate; required for historical invalidation' })),
    output_path: optional('Workspace JSON path for the saved immutable decision timeline'),
    operation_id: optional('Idempotency key to publish a saved timeline as an evidence resource'),
  }, async (args, signal) => {
    if (!host.inference) throw new Error('This host does not provide the isolated inference port; upgrade the host before using Agent decisions.');
    if (args.action === 'models') return { models: host.inference.models(), context: 'isolated-frozen-inputs', tools: false, conversationMemory: false };
    const decisions = service(host);
    if (args.action === 'bridge_start') {
      decisions.bridgePromise ??= startDecisionBridge(decisions).then(bridge => { decisions.bridge = bridge; return bridge; }).catch(error => { decisions.bridgePromise = null; throw error; });
      const bridge = await decisions.bridgePromise;
      return { endpoint: bridge.endpoint, token: bridge.token, protocol: bridge.protocol, credentialHandling: 'Local adapter only; do not include the token in reports, artifacts or strategy source.', lifetime: 'Current Sesame process; restart creates a new endpoint and credential' };
    }
    if (args.action === 'bridge_stop') { if (decisions.bridgePromise) await decisions.bridgePromise; await decisions.bridge?.close(); decisions.bridge = null; decisions.bridgePromise = null; return { stopped: true, modelJobsCanceled: false }; }
    if (args.action === 'submit') {
      if (!args.request_path) throw new Error('submit requires request_path');
      const bytes = await host.workspace.file('read', args.request_path, undefined, signal);
      if (bytes.length > 1024 * 1024) throw new Error('Decision request exceeds 1 MiB');
      const submitted = decisions.submit(JSON.parse(bytes.toString('utf8')));
      return view(args.wait ? await decisions.wait(submitted.id, signal) : submitted);
    }
    if (!args.job_id) throw new Error(`${args.action} requires job_id`);
    const job = decisions.get(args.job_id);
    if (args.action === 'status') return view(args.wait ? await decisions.wait(job.id, signal) : job);
    if (args.action === 'cancel') return view(decisions.cancel(job.id, args.reason ?? 'Canceled by Agent or user', args.as_of_ms === undefined ? undefined : { basis: 'utc', unixMs: args.as_of_ms }));
    if (args.action === 'invalidate') return decisions.invalidate(job.request.scope, args.reason ?? 'Strategy context changed', job.request.inputs.map(input => input.ref), args.as_of_ms === undefined ? undefined : { basis: 'utc', unixMs: args.as_of_ms });
    if (args.action !== 'timeline') throw new Error('Unknown decision action');
    const at = args.as_of_ms ?? (job.request.mode === 'live' ? Date.now() : null);
    if (at === null) throw new Error('Historical timeline requires as_of_ms');
    const timeline = decisions.timeline(job.request.scope, { basis: 'utc', unixMs: at });
    const output = JSON.stringify(timeline, null, 2) + '\n';
    if (args.output_path) await host.workspace.file('write', args.output_path, output, signal);
    let evidence;
    if (args.operation_id) {
      const jobs = host.storage.list('decision_job').filter(record => record.status === 'completed' && record.output.availableAt.unixMs <= at && record.request.scope.runId === job.request.scope.runId && record.request.scope.strategyId === job.request.scope.strategyId && JSON.stringify(record.request.scope.account) === JSON.stringify(job.request.scope.account));
      const references = [...new Map(jobs.flatMap(record => record.request.inputs.map(input => [JSON.stringify(input.ref), input.ref]))).values()];
      const timelineBlob = host.artifacts.blob(output), jobsBlob = host.artifacts.blob(JSON.stringify(jobs));
      evidence = host.artifacts.publish({ operationId: args.operation_id, manifest: { kind: 'resource', schemaVersion: '1.0.0',
        content: { type: 'strategy-agent-timeline', timelinePath: 'timeline.json', requestsPath: 'requests.json', timelineDigest: timeline.digest, nativeEngineExecuted: false },
        blobs: [{ ...timelineBlob, path: 'timeline.json', mediaType: 'application/json' }, { ...jobsBlob, path: 'requests.json', mediaType: 'application/json' }], dependencies: references,
        provenance: { kind: references.some(ref => host.artifacts.read(ref).manifest.provenance?.kind === 'demo') ? 'demo' : 'derived', references } } });
    }
    return { ...timeline, ...(evidence ? { evidence } : {}), nativeEngineExecuted: false };
  })];
}
