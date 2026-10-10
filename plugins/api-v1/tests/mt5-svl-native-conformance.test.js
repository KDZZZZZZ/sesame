// Opt-in native semantic acceptance. No orders, no chart attachment, no user terminal restart.
// Uses an isolated Tester and actual installed MetaEditor; credentials are read from an
// explicitly named existing local connection file and are never printed or copied to reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, cp, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '@sesame/plugin-sdk/protocol';
import { evaluateReplay } from '@sesame/plugin-sdk/svl';
import { fixtureHost, sourceFixture, replayFixture } from './mt5-conformance-fixture.js';
import { prepareConformance, verifyConformance } from '../../optional-api-v1/packages/mt5/backend/conformance.js';
import { targetProfile, registerTranslation } from '../../optional-api-v1/packages/mt5/backend/target.js';
import { sourceNodes } from '../../optional-api-v1/packages/mt5/backend/svl-capabilities.js';
import { TIMELINE_PATH } from '../../optional-api-v1/packages/mt5/backend/external-inputs.js';
import { installation, compileNative, fileManifest } from '../../optional-api-v1/packages/mt5/backend/native.js';
import { execute } from '../../optional-api-v1/packages/mt5/backend/compiler-worker.js';
import { SDK_VERSION, DEFAULT_RISK_LIMITS } from '../../optional-api-v1/packages/mt5/backend/contracts.js';
import { MT5MCP } from '../../optional-api-v1/packages/mt5/backend/mcp.js';
import { Tester } from '../../optional-api-v1/packages/mt5/backend/tester.js';

const mql = prepared => String.raw`#property strict
#property description "SVL fixed-input semantic acceptance: no trading code."
#include <Product/Results.mqh>
#include <Product/Risk.mqh>
#include <Product/Conformance.mqh>
#include <Product/FrozenInputs.mqh>
#include <Strategy/ConformanceFixture.mqh>
bool Delivered=false;
double Counter=0;
string EventField(string body,string field)
  {
   string marker="\""+field+"\":\""; int start=StringFind(body,marker);
   if(start<0) return "";
   start+=StringLen(marker); int end=StringFind(body,"\"",start);
   return end<start ? "" : StringSubstr(body,start,end-start);
  }
double AddStep(double previous,double increment) { return previous+increment; }
int OnInit()
  {
   if(!MQLInfoInteger(MQL_TESTER) || !ProductTraceOpen()) return INIT_FAILED;
   if(!ProductFrozenOpen("${prepared.timelineDigest}")) { ProductTraceClose(); return INIT_FAILED; }
   return INIT_SUCCEEDED;
  }
void OnTick()
  {
   ProductEquity(); if(Delivered) return; Delivered=true;
   ProductSvlBegin(PRODUCT_SVL_FIXTURE_DIGEST,PRODUCT_SVL_SOURCE_DIGEST,"conformance-unit-test",PRODUCT_SVL_PARAMETERS_DIGEST);
   int index=0; string event_body;
   for(long time=0;time<=2000;time+=1000)
     {
      while(ProductFrozenNext(time,event_body)==1)
        {
         string event_id=EventField(event_body,"eventId");
         string delta=EventField(event_body,"increment");
         if(delta=="") { ProductSvlEnd("paused","{\"counter\":"+ProductQuote(DoubleToString(Counter,0))+"}"); return; }
         ProductSvlInput(index,event_id,ProductFrozenEventDigest(event_body)); index++;
         double sum=AddStep(Counter,StringToDouble(delta));
         double limited=MathMax(0,MathMin(4,sum));
         string sum_json=ProductQuote(DoubleToString(sum,0)), limited_json=ProductQuote(DoubleToString(limited,0));
         Counter=limited;
         string trace="[{\"nodeId\":\"sum\",\"value\":"+sum_json+",\"location\":\"clock/apply\",\"functionId\":\"addStep\",\"callPath\":[{\"nodeId\":\"call\",\"functionId\":\"addStep\"}]},"+
                      "{\"nodeId\":\"call\",\"value\":"+sum_json+",\"location\":\"clock/apply\"},"+
                      "{\"nodeId\":\"limit\",\"value\":"+limited_json+",\"location\":\"clock/apply\"},"+
                      "{\"nodeId\":\"save\",\"value\":{\"status\":\"written\"},\"location\":\"clock/apply\"}]";
         ProductSvlEvent("{\"eventId\":"+ProductQuote(event_id)+",\"status\":\"committed\",\"state\":{\"counter\":"+limited_json+"},\"intents\":[],\"trace\":"+trace+"}");
        }
     }
   ProductSvlEnd("completed","{\"counter\":"+ProductQuote(DoubleToString(Counter,0))+"}");
  }
double OnTester() { return ProductTesterResult(); }
void OnDeinit(const int reason) { ProductTraceClose(); }
`;

test('actual MetaEditor/Tester matches SVL 1.2 function/clamp and UTC-gated external timeline, without any orders', { skip: process.env.SESAME_SVL_NATIVE_TESTS !== '1', timeout: 420000 }, async t => {
  assert.ok(process.env.SESAME_TESTER_CONNECTION_JSON, 'Explicit existing connection file required');
  const f = await fixtureHost(), native = installation(); assert.ok(native);
  if (process.env.SESAME_TESTER_CACHE_DIRECTORY) native.dataDirectory = process.env.SESAME_TESTER_CACHE_DIRECTORY;
  let preserve = false, client;
  t.after(async () => { client?.close(); if (!preserve) await rm(f.directory, { recursive: true, force: true }); else t.diagnostic(`Native cleanup needs inspection: ${f.directory}`); });
  const config = JSON.parse(await readFile(process.env.SESAME_TESTER_CONNECTION_JSON, 'utf8'));
  const secrets = [config.account.password, ...Object.values(config.servers).map(value => value.token)].filter(Boolean);
  const redact = value => secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value));
  const schema = f.publish('resource', { type: 'native-external-fixture' }), value = sourceFixture('1.2.0');
  value.parameters = {}; value.inputs.clock = { kind: 'external', schema: structuredClone(schema), availabilityPolicy: structuredClone(schema) }; value.handlers[0].event.type = 'external.input';
  value.nodes[0].inputs.arguments.record.step = { input: 'clock', field: 'increment' };
  value.nodes.splice(1, 0, { id: 'limit', op: 'math.clamp', inputs: { value: { node: 'call' }, min: '0', max: '4' } }); value.nodes.at(-1).inputs.value = { node: 'limit' };
  const source = f.publishSource(value), replay = replayFixture();
  replay.events.forEach((event, i) => { event.type = 'external.input'; event.inputs.clock = { increment: String(i + 1) }; });
  assert.deepEqual(evaluateReplay(value, replay).events.map(event => event.state.counter), ['1', '3', '4']);
  await f.host.workspace.file('write', 'fixture.json', JSON.stringify(replay));
  const prepared = await prepareConformance(f.host, { operation_id: 'native_fixture_001', source, fixture_path: 'fixture.json', header_path: 'ConformanceFixture.mqh', timeline_path: 'timeline.ndjson' });
  const files = { 'Experts/Strategy.mq5': mql(prepared), 'Include/Strategy/ConformanceFixture.mqh': await readFile(join(f.workspace, 'ConformanceFixture.mqh'), 'utf8'), [TIMELINE_PATH]: await readFile(join(f.workspace, 'timeline.ndjson'), 'utf8') };
  const target = await targetProfile(f.host), registered = await registerTranslation(f.host, f.mt5, { operation_id: 'native_translation_001', title: 'No-trade native SVL fixture', source, target, mode: 'backtest', parameter_map: {}, files, source_map: sourceNodes(value).map(node => ({ nodeId: node.nodeId, ...(node.functionId ? { functionId: node.functionId } : {}), instrumentation: 'direct', generated: [{ path: 'Experts/Strategy.mq5', startLine: 1, endLine: files['Experts/Strategy.mq5'].split('\n').length }] })), adaptations: [{ code: 'EXTERNAL_INPUT_BRIDGE', nodes: ['call'], status: 'limited', description: 'Fixed external fixture only; no live HTTP bridge and no trades', evidence: [prepared.bridgeConfiguration] }] });
  const buildId = 'build_' + randomUUID(), directory = join(f.store.directory, 'mt5/builds', buildId);
  await mkdir(join(directory, 'Experts'), { recursive: true }); await mkdir(join(directory, '.compiler'));
  await cp(native.include, join(directory, 'Include'), { recursive: true }); await rm(join(directory, 'Include/Product'), { recursive: true, force: true }); await cp(new URL('../../optional-api-v1/packages/mt5/backend/sdk/', import.meta.url), join(directory, 'Include/Product'), { recursive: true });
  await writeFile(join(directory, 'Include/Product/Build.mqh'), `#define PRODUCT_BUILD_ID "${buildId}"\n#define PRODUCT_SDK_VERSION "${SDK_VERSION}"\n`);
  await copyFile(native.editor, join(directory, '.compiler/MetaEditor64.exe'));
  for (const [path, text] of Object.entries(files)) { await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), text); }
  const manifestFiles = await fileManifest(directory), manifest = JSON.stringify({ files: manifestFiles, compiler_sha256: manifestFiles['.compiler/MetaEditor64.exe'].sha256 }); await writeFile(join(directory, 'manifest.json'), manifest);
  let compiled;
  try { compiled = await compileNative(native, directory, AbortSignal.timeout(240000), digest(Buffer.from(manifest)), undefined, { executeWorker: (_entry, payload, options) => execute(payload, { signal: options.signal, directory }) }); }
  catch (error) { preserve = error.code === 'runtime_cleanup_failed'; throw new Error(redact(error.message), { cause: error }); }
  assert.equal(compiled.success, true, compiled.diagnostics); assert.equal(compiled.execution.backend, 'native');
  f.store.put('mt5_build', { id: buildId, project_id: registered.project_id, revision: 1, status: 'succeeded', ex5_sha256: compiled.ex5_sha256, execution: compiled.execution });
  client = new MT5MCP({ ...config.servers.terminal, server: 'terminal' });
  Object.assign(f.mt5, { native, official: { config, client: () => client, redact } });
  const pass = { id: 'pass_' + randomUUID(), build_id: buildId, artifact_digest: compiled.ex5_sha256, backtest_id: 'backtest_native_conformance', label: 'No-trade semantic fixture', status: 'queued', connection_version: config.version, risk_limits: structuredClone(DEFAULT_RISK_LIMITS), config: { symbol: process.env.SESAME_TESTER_SYMBOL ?? 'EURUSD', period: 'M1', from_date: process.env.SESAME_TESTER_FROM ?? '2026-10-08', to_date: process.env.SESAME_TESTER_TO ?? '2026-10-09', deposit: 100000, currency: 'USD', leverage: 100, model: 1, parameters: {} }, created_at: new Date().toISOString() };
  f.store.put('mt5_pass', pass); let resultRef;
  // Publish only parsed results delivered by the real Tester, never reference values.
  f.mt5.runObserver = { backtest() {}, result(nativePass, parsed) {
    const chunk = f.publish('data', { path: 'rows.json', rowCount: parsed.trace.length, provenance: { kind: 'observed', nativePassId: nativePass.id } }, { 'rows.json': parsed.trace });
    const raw = f.publish('resource', {}, { 'result.json': parsed.result });
    resultRef = f.publish('strategy.result', { source, translation: registered.translation, status: 'completed', nativePassId: nativePass.id, buildId, codeDigest: compiled.ex5_sha256, rawResult: raw, data: [{ role: 'trace', offset: 0, ref: chunk }] });
    f.store.update('mt5_pass', nativePass.id, { result_artifact: resultRef });
  } };
  const tester = new Tester(f.mt5); tester.get = () => ({ passes: [] });
  try { await tester.execute(pass, AbortSignal.timeout(180000)); }
  catch (error) { preserve = error.code === 'runtime_cleanup_failed'; throw new Error(redact(error.message), { cause: error }); }
  assert.ok(resultRef); const receipt = f.store.get('mt5_pass', pass.id);
  assert.equal(receipt.metrics.trade_count, 0); assert.equal(receipt.process_cleanup.activeProcesses, 0);
  const verified = verifyConformance(f.host, f.mt5, { operation_id: 'native_verify_001', fixture: prepared.fixture, translation: registered.translation, result: resultRef });
  assert.equal(verified.outcome, 'passed', JSON.stringify(verified.differences)); assert.equal(verified.covered, 4);
  const report = { completedAt: new Date().toISOString(), sourceDigest: f.host.artifacts.read(source).manifest.content.sourceDigest, languageVersion: value.schemaVersion, fixtureDigest: prepared.fixtureDigest, buildId, ex5Digest: compiled.ex5_sha256, compilerDigest: manifestFiles['.compiler/MetaEditor64.exe'].sha256, passId: pass.id, tradeCount: receipt.metrics.trade_count, metrics: receipt.metrics, processCleanup: receipt.process_cleanup, observedInputFile: receipt.native_input_files.map(({ digest, rows }) => ({ digest, rows })), validation: verified };
  if (process.env.SESAME_SVL_NATIVE_REPORT) await writeFile(process.env.SESAME_SVL_NATIVE_REPORT, JSON.stringify(report, null, 2));
  t.diagnostic(JSON.stringify({ nativeEngineExecuted: true, languageVersion: value.schemaVersion, ex5Digest: compiled.ex5_sha256, tradeCount: 0, outcome: verified.outcome, covered: verified.covered, inputRows: replay.events.length, cleanup: receipt.process_cleanup }));
});
