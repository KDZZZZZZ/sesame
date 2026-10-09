import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, canonical } from '@sesame/plugin-sdk/protocol';
import { translationBinding } from './parameters.js';
import { accountIdentity } from './contract-mapping.js';
import { requireValue } from './support.js';
import { initialized } from './deployments.js';

const completed = new Set(['stopped', 'completed', 'failed']);
const unknown = reason => ({ status: 'unknown', reason });

/** Record actual native evidence; never launch, resume, detach or stop an EA. */
export class NativeRunObserver {
  constructor(host, mt5) {
    this.host = host; this.mt5 = mt5; this.sessionId = randomUUID();
    this.current = new Map(host.records.list().filter(row => row.producer.id === host.plugin.id).map(row => [row.id, row]));
  }
  reference(kind, nativeId) {
    const recordId = 'mt5-' + kind + '-' + nativeId;
    if (!this.current.has(recordId)) return null;
    // Return a real stored version for report.related.record. Legacy native
    // runs have no SVL record and must never receive a fabricated reference.
    const record = this.host.records.read(recordId);
    return { id: record.id, version: record.version };
  }
  artifact(operationId, kind, content, dependencies = [], files = {}) {
    const blobs = Object.entries(files).map(([path, text]) => ({ path, mediaType: path.endsWith('.ex5') ? 'application/octet-stream' : 'application/json', ...this.host.artifacts.blob(Buffer.isBuffer(text) || typeof text === 'string' ? text : JSON.stringify(text)) }));
    return this.host.artifacts.publish({ operationId, manifest: { kind, schemaVersion: '1.0.0', content, dependencies, blobs } });
  }
  frozenBuild(build, manifest, translation, bytes) {
    // Archive location/cleanup flags describe storage lifecycle, not compiled content.
    const stable = value => { const { archived_artifact, archived_manifest, intermediate_files_removed, ...content } = value; return content; };
    const identity = digest([stable(build), manifest, translation, digest(bytes)]);
    const verify = ref => {
      const artifact = this.host.artifacts.read(ref), content = artifact.manifest.content;
      requireValue(artifact.producer.id === this.host.plugin.id && ref.kind === 'resource' && content.format === 'sesame.mt5.build/1' && content.build?.id === build.id, '冻结构建引用身份不匹配');
      requireValue(digest([stable(content.build), content.manifest, translation, digest(bytes)]) === identity && canonical(artifact.manifest.dependencies) === canonical([translation]), '冻结构建内容已改变，不能覆盖或复用原引用');
      const blob = artifact.manifest.blobs.find(blob => blob.path === 'Strategy.ex5');
      requireValue(blob && digest(this.host.artifacts.readBlob(blob)) === digest(bytes), '冻结构建 EX5 与原成果不一致');
      return ref;
    };
    const saved = this.mt5.storage.get('native_build_inputs', build.id, true);
    if (saved) { requireValue(saved.identity === identity, '冻结构建内容已改变，不能复用原引用'); return verify(saved.ref); }
    // Migrate already-published pre-index builds without re-publishing mutable metadata
    // under their existing host idempotency key. Read exact artifacts, not request internals.
    const migrationId = 'legacy-build-resources-v1';
    if (!this.mt5.storage.get('native_build_migrations', migrationId, true)) {
      const candidates = new Map();
      for (let offset = 0; ; offset += 2000) {
        const page = this.host.artifacts.list({ kind: 'resource', limit: 2000, offset });
        for (const item of page.items) {
          if (item.producer && item.producer.id !== this.host.plugin.id) continue;
          const artifact = this.host.artifacts.read(item.ref), content = artifact.manifest.content;
          if (artifact.producer.id === this.host.plugin.id && content.format === 'sesame.mt5.build/1' && content.build?.id) {
            const refs = candidates.get(content.build.id) ?? [];
            refs.push(item.ref); candidates.set(content.build.id, refs);
          }
        }
        if (!page.hasMore) break;
      }
      // Completion is written last: interrupted scans retry rather than hiding legacy refs.
      for (const [id, refs] of candidates) this.mt5.storage.put('native_build_legacy_refs', { id, refs });
      this.mt5.storage.put('native_build_migrations', { id: migrationId, completed: true });
    }
    let ref;
    for (const item of this.mt5.storage.get('native_build_legacy_refs', build.id, true)?.refs ?? []) {
      const candidate = verify(item);
      requireValue(!ref || canonical(ref) === canonical(candidate), '同一构建存在不同冻结引用，需人工核查'); ref = candidate;
    }
    ref ??= this.artifact(`native-build-${build.id}`, 'resource', { format: 'sesame.mt5.build/1', build: stable(build), manifest }, [translation], { 'Strategy.ex5': bytes });
    this.mt5.storage.put('native_build_inputs', { id: build.id, identity, ref }); return ref;
  }
  definition(kind, native) {
    const recordId = `mt5-${kind}-${native.id}`, saved = this.mt5.storage.get('native_run_inputs', recordId, true);
    if (saved) return saved.body;
    const config = native.config ?? { symbol: native.symbol, period: native.period, parameters: native.parameters };
    const binding = translationBinding(this.host, this.mt5, native.build_id, config);
    if (!binding) return null; // Old MQL source retains private native observations only.
    requireValue(native.conversation_id || native.authorization_ref, 'SVL 原生运行必须关联发起它的用户会话');
    const build = this.mt5.storage.get('mt5_build', native.build_id), directory = join(this.mt5.storage.directory, 'mt5/builds', build.id), bytes = readFileSync(join(directory, 'Experts/Strategy.ex5'));
    requireValue(digest(bytes) === build.ex5_sha256, '运行前冻结 EX5 摘要不匹配');
    const manifestPath = join(directory, 'manifest.json');
    let manifestBytes;
    if (existsSync(manifestPath)) manifestBytes = readFileSync(manifestPath);
    else {
      const archived = this.host.artifacts.read(build.archived_artifact);
      manifestBytes = this.host.artifacts.readBlob(archived.manifest.blobs.find(item => item.path === `builds/${build.id}-manifest.json`));
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const frozen = this.frozenBuild(build, manifest, binding.translation, bytes);
    const parameters = this.artifact(`${recordId}-parameters`, 'parameters', { source: binding.source, values: binding.parameters, nativeInputs: binding.native, defaultsExpanded: true }, [binding.source]);
    const input = this.artifact(`${recordId}-inputs`, 'resource', { format: 'sesame.mt5.binding/1', source: binding.source, instrument: binding.instrument, sourceInputs: binding.inputs, nativeConfig: config, timeBasis: 'broker_server_unspecified', limitations: ['One native symbol/timeframe; broker history and calendar are not a frozen semantic replay fixture.'] }, [binding.source]);
    const connection = { id: 'mt5-terminal', revision: String(native.connection_version ?? this.mt5.official.config.version) };
    const started = this.mt5.storage.idempotent(`observe-start-${recordId}`, digest([native.id, native.build_id]), () => Date.now());
    const environment = this.artifact(`${recordId}-environment`, 'environment', { profile: binding.target, plugin: this.host.plugin, observedAt: started, platform: process.platform,
      runtime: { name: 'MetaTrader 5', version: 'not_observed', digest: this.mt5.native?.terminal && existsSync(this.mt5.native.terminal) ? { status: 'value', value: digest(readFileSync(this.mt5.native.terminal)) } : unknown('Native terminal executable has not been observed') },
      dependencies: [{ name: 'MetaEditor', version: 'not_observed', digest: manifest.compiler_sha256 ? { status: 'value', value: manifest.compiler_sha256 } : unknown('Compiler identity absent') }], connection, capabilities: [], evidence: [frozen] }, [binding.target, frozen]);
    const validations = binding.validation ? [binding.validation] : [];
    const body = { schemaVersion: '1.0.0', runId: recordId, operationId: native.request_key ?? native.id, mode: kind === 'tester' ? 'backtest' : 'live', source: binding.source, translation: binding.translation, validations, parameters, dataBindings: [input],
      accounts: kind === 'tester' ? [] : [{ binding: 'executionAccount', account: { connectionId: connection.id, accountId: accountIdentity(native.server, native.login) }, connection }],
      plugin: this.host.plugin, environment, owner: { kind: kind === 'tester' ? 'task' : 'persistent', id: kind === 'tester' ? native.owner_run_id ?? native.conversation_id : recordId }, authorizationRef: native.authorization_ref ?? `conversation:${native.conversation_id}`,
      observer: { plugin: this.host.plugin, publisherId: 'native-observer', sessionId: this.sessionId }, nativeInstance: unknown('No verified native execution evidence yet'), status: 'starting', checkpoint: unknown('No native recoverable state checkpoint was supplied'), observation: null,
      dependencies: [binding.source, binding.translation, ...validations, parameters, input, environment, frozen] };
    this.mt5.storage.put('native_run_inputs', { id: recordId, body }); return body;
  }
  observe(kind, native, status, { nativeInstanceId, recovery = false } = {}) {
    const recordId = `mt5-${kind}-${native.id}`, fingerprint = digest([native, recovery]);
    const previous = this.mt5.storage.get('native_observation_head', recordId, true);
    if (previous?.fingerprint === fingerprint && previous.confirmed) return this.current.get(recordId) ?? previous;
    const remember = () => this.mt5.storage.put('native_observation_head', { id: recordId, fingerprint, native, recovery, observedAt: Date.now(), confirmed: true });
    const body = this.definition(kind, native);
    if (!body) { remember(); return null; }
    let record = this.current.get(recordId);
    if (record && completed.has(record.body.status)) return record;
    let evidence = this.mt5.storage.get('native_observation', fingerprint, true)?.artifact;
    if (!evidence) {
      evidence = this.artifact(`native-observation-${fingerprint}`, 'resource', { format: 'sesame.mt5.observation/1', nativeId: native.id, kind, observedAt: Date.now(), recovery }, [...body.dependencies, ...(native.result_artifact ? [native.result_artifact] : [])], { 'observation.json': native });
      this.mt5.storage.put('native_observation', { id: fingerprint, artifact: evidence });
    }
    if (!record) {
      this.host.records.create({ operationId: `${recordId}-create`, recordId, kind: 'strategy.run', schemaVersion: '1.0.0', body });
      record = this.host.records.read(recordId); this.current.set(recordId, record);
    }
    const append = (state, suffix, instance) => {
      const observedAt = Date.now();
      this.host.records.append({ operationId: `observe-${digest([recordId, record.version, fingerprint, suffix]).slice(7)}`, recordId, expectedVersion: record.version, event: { type: 'native.observation', status: state, evidence: [evidence], observedAt,
        observation: { observedAt, validUntil: observedAt + 30000, evidence: [evidence] },
        ...(instance ? { nativeInstanceId: instance, nativeInstance: { status: 'value', value: { id: instance, startedAt: Date.parse(native.created_at), evidence: [evidence] } } } : {}),
        ...(recovery ? { reason: 'Application resumed observation; native state has not yet been reverified.' } : {}) } });
      record = this.host.records.read(recordId); this.current.set(recordId, record);
    };
    if (status === 'stopped' && record.body.status !== 'stopping') append('stopping', 'stopping');
    if (status === 'completed' && record.body.status === 'starting') append('unknown', 'unobserved-start');
    if (status === 'running' && !nativeInstanceId) status = record.body.status === 'starting' ? 'starting' : 'unknown';
    append(status, 'state', nativeInstanceId); remember(); return record;
  }
  deployment(value, recovery = false) {
    const verified = !recovery && value.status === 'running' && value.chart_id && value.native_evidence?.verified;
    const status = recovery && ['running', 'attaching', 'preparing'].includes(value.status) ? 'unknown' : ({ preparing: 'starting', attaching: 'starting', running: verified ? 'running' : 'unknown', unknown: 'unknown', failed: 'failed', stopped: 'stopped' }[value.status] ?? 'unknown');
    return this.observe('deployment', value, status, { recovery, nativeInstanceId: verified ? `${value.server}:${value.login}:${value.chart_id}:${value.artifact_digest}` : null });
  }
  backtest(value, recovery = false) {
    return value.passes?.map(pass => {
      const native = { ...pass, conversation_id: value.conversation_id, owner_run_id: pass.owner_run_id ?? value.owner_run_id ?? null };
      // A PID is only a created process. Parsed SDK output confirms execution.
      const verified = pass.status === 'succeeded' && pass.result_artifact;
      const status = recovery && ['queued', 'running', 'canceling', 'preparing', 'collecting'].includes(pass.status) ? 'unknown' : ({ queued: 'starting', preparing: 'starting', running: 'starting', collecting: 'starting', canceling: 'stopping', canceled: 'stopped', succeeded: 'completed', failed: 'failed', unknown: 'unknown' }[pass.status] ?? 'unknown');
      return this.observe('tester', native, status, { recovery, nativeInstanceId: verified ? pass.id : null });
    });
  }
  result(pass, parsed) {
    const body = this.definition('tester', { ...pass, conversation_id: this.mt5.tester.get(pass.backtest_id).conversation_id });
    if (!body) return null;
    const dependencies = [body.source, body.translation], data = [];
    for (const [role, rows] of Object.entries({ deals: parsed.result.deals, equity: parsed.equity, trace: parsed.trace })) {
      for (let i = 0; i < Math.max(rows.length, 1); i += 10000) {
        const chunk = rows.slice(i, i + 10000);
        data.push({ role, offset: i, ref: this.artifact(`${pass.id}-${role}-${i}`, 'data', { format: 'json-rows', path: 'rows.json', rowCount: chunk.length, columns: [...new Set(chunk.flatMap(Object.keys))], provenance: { kind: 'observed', engine: 'MetaTrader 5 Strategy Tester', timeBasis: 'broker_server_unspecified', nativePassId: pass.id } }, dependencies, { 'rows.json': chunk }) });
      }
    }
    const raw = this.artifact(`${pass.id}-raw`, 'resource', { format: 'sesame.mt5.tester-result/1', nativePassId: pass.id, data }, [...dependencies, ...data.map(item => item.ref)], { 'result.json': parsed.result });
    const assumptions = this.artifact(`${pass.id}-assumptions`, 'resource', { format: 'sesame.mt5.tester-assumptions/1', nativeConfig: pass.config, riskLimits: pass.risk_limits, timeBasis: 'broker_server_unspecified', brokerExecutionRules: unknown('Rules are native broker history/Tester settings; a deterministic injected-response fixture is not available') }, [body.parameters, ...body.dataBindings]);
    const ref = this.artifact(`${pass.id}-result`, 'strategy.result', { schemaVersion: '1.0.0', runId: body.runId, source: body.source, translation: body.translation, engine: { name: 'MetaTrader 5 Strategy Tester', version: String(parsed.result.terminal_build), evidence: [raw] }, inputs: body.dataBindings, assumptions, status: 'completed', rawResult: raw, report: unknown('No report has been authored'),
      nativePassId: pass.id, buildId: pass.build_id, codeDigest: pass.artifact_digest, data, limitations: ['Native SDK evidence; missing or uninstrumented branches are not reconstructed.', 'Native arithmetic and broker behavior require independent SVL target equivalence validation.'] }, [...dependencies, raw, assumptions, ...body.dataBindings, ...data.map(item => item.ref)]);
    this.mt5.storage.put('mt5_result_artifact', { id: pass.id, artifact: ref }); this.mt5.storage.update('mt5_pass', pass.id, { result_artifact: ref }); return ref;
  }
  start() {
    this.timer = setInterval(() => {
      if (this.pending || this.closed) return;
      this.pending = this.refresh().catch(() => {}).finally(() => { this.pending = null; });
    }, 10000); this.timer.unref(); return this;
  }
  async refresh() {
    for (const native of this.mt5.deployments.list().filter(item => ['running', 'unknown'].includes(item.status) && item.chart_id && item.output_path)) {
      let verified = false, events = [], sequence = native.native_evidence?.sequence ?? null;
      try {
        const { scope } = await this.mt5.market.connected(); requireValue(scope.login === native.login && scope.server === native.server, 'Observed account changed');
        const charts = await this.mt5.market.read('list_open_charts', {});
        requireValue(charts.charts?.some(chart => String(chart.chart_id) === String(native.chart_id) && chart.symbol === native.symbol), 'Observed chart is unavailable');
        events = await this.mt5.deployments.readTrace(native);
        verified = sequence !== null && (events.at(-1)?.seq ?? 0) > sequence && initialized(events);
      } catch { /* Persist unknown; never infer a stop or replay the native start. */ }
      const last = events.at(-1)?.seq ?? sequence;
      if (!verified && native.status === 'running' && Date.now() - (native.native_evidence?.observedAt ?? 0) < 30000) continue;
      this.mt5.deployments.save({ ...native, status: verified ? 'running' : 'unknown', native_evidence: { verified, sequence: last, observedAt: Date.now(), trace: verified ? events.slice(-32) : [] } });
    }
  }
  async close() { this.closed = true; clearInterval(this.timer); await this.pending; }
}
