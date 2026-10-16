import { decisionService } from './decision-service.js';
import { startDecisionBridge } from './decision-bridge.js';
import { readWorkspace, writeWorkspace, publishFiles } from '../artifact-io.js';

function view(job) {
  return { id: job.id, requestId: job.request.requestId, status: job.status, scope: job.request.scope, role: job.request.program.role, mode: job.request.mode,
    programDigest: job.programDigest, inputDigest: job.inputDigest, attempts: job.attempts, output: job.output, decision: job.decision ?? null, error: job.error ?? null,
    limitations: job.limitations ?? [], failurePolicy: job.request.program.failurePolicy };
}

export function createDecisionCapabilities(host) {
  return [{ name: 'strategy_decision', execute: async (args, signal) => {
    const decisions = decisionService(host);
    if (args.action === 'models') return { models: await decisions.services.models(), context: 'isolated-frozen-inputs', tools: false, conversationMemory: false };
    if (args.action === 'bridge_start') {
      decisions.bridgePromise ??= startDecisionBridge(decisions).then(bridge => { decisions.bridge = bridge; return bridge; }).catch(error => { decisions.bridgePromise = null; throw error; });
      const bridge = await decisions.bridgePromise;
      return { endpoint: bridge.endpoint, token: bridge.token, protocol: bridge.protocol, credentialHandling: 'Local adapter only; do not include the token in reports, artifacts or strategy source.', lifetime: 'Current Sesame process; restart creates a new endpoint and credential' };
    }
    if (args.action === 'bridge_stop') { if (decisions.bridgePromise) await decisions.bridgePromise; await decisions.bridge?.close(); decisions.bridge = null; decisions.bridgePromise = null; return { stopped: true, modelJobsCanceled: false }; }
    if (args.action === 'submit') {
      if (!args.request_path) throw new Error('submit requires request_path');
      const bytes = await readWorkspace(host, args.request_path, signal); if (bytes.length > 1048576) throw new Error('Decision request exceeds 1 MiB');
      const submitted = await decisions.submit(JSON.parse(bytes.toString('utf8')));
      return view(args.wait ? await decisions.wait(submitted.id, signal) : submitted);
    }
    if (!args.job_id) throw new Error(`${args.action} requires job_id`);
    const job = decisions.get(args.job_id);
    if (args.action === 'status') return view(args.wait ? await decisions.wait(job.id, signal) : job);
    if (args.action === 'cancel') return view(decisions.cancel(job.id, args.reason ?? 'Canceled by Agent or user', args.as_of_ms === undefined ? undefined : { basis: 'utc', unixMs: args.as_of_ms }));
    if (args.action === 'invalidate') return decisions.invalidate(job.request.scope, args.reason ?? 'Strategy context changed', job.request.inputs.map(input => input.ref), args.as_of_ms === undefined ? undefined : { basis: 'utc', unixMs: args.as_of_ms });
    if (args.action !== 'timeline') throw new Error('Unknown decision action');
    const at = args.as_of_ms ?? (job.request.mode === 'live' ? Date.now() : null); if (at === null) throw new Error('Historical timeline requires as_of_ms');
    const timeline = decisions.timeline(job.request.scope, { basis: 'utc', unixMs: at }), output = JSON.stringify(timeline, null, 2) + '\n';
    if (args.output_path) await writeWorkspace(host, args.output_path, output, signal);
    let evidence;
    if (args.operation_id) {
      const jobs = decisions.records.list('decision_job').filter(record => record.status === 'completed' && record.output.availableAt.unixMs <= at && record.request.scope.runId === job.request.scope.runId && record.request.scope.strategyId === job.request.scope.strategyId && JSON.stringify(record.request.scope.account) === JSON.stringify(job.request.scope.account));
      const references = [...new Map(jobs.flatMap(record => record.request.inputs.map(input => [JSON.stringify(input.ref), input.ref]))).values()];
      let kind = 'derived';
      for (const ref of references) { const manifest = await host.resources.read(ref, { part: 'manifest' }); if (manifest.provenance?.kind === 'demo' || manifest.content.provenance?.kind === 'demo') kind = 'demo'; }
      evidence = (await publishFiles(host, args.operation_id, { kind: 'resource', schemaVersion: '1.0.0',
        content: { type: 'strategy-agent-timeline', timelinePath: 'timeline.json', requestsPath: 'requests.json', timelineDigest: timeline.digest, nativeEngineExecuted: false },
        dependencies: references, provenance: { kind, references } }, [{ path: 'timeline.json', bytes: output, mediaType: 'application/json' }, { path: 'requests.json', bytes: JSON.stringify(jobs), mediaType: 'application/json' }], {}, signal)).ref;
    }
    return { ...timeline, ...(evidence ? { evidence } : {}), nativeEngineExecuted: false };
  } }];
}
