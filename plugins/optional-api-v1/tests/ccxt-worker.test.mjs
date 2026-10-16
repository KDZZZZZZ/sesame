import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// A real local JSONL process isolates transport/lifecycle behavior from networking.
const fixtureBridge = `import sys,json,os,time
from pathlib import Path
count=0
for line in sys.stdin:
    request=json.loads(line)
    p=request['payload']
    count+=1
    Path('started.json').write_text(json.dumps({'pid':os.getpid(),'count':count}))
    if p.get('pause'): time.sleep(p['pause'])
    if p.get('exit'): os._exit(7)
    if p.get('fail'):
        response={'id':request['id'],'error':{'code':'SOURCE_UNAVAILABLE','message':'temporary upstream failure'}}
    else:
        response={'id':request['id'],'result':{'pid':os.getpid(),'count':count,'symbol':p.get('symbol'),'exchange':p['exchange']}}
    print(json.dumps(response),flush=True)
`;

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "sesame-ccxt-worker-"));
  await copyFile(new URL("../packages/ccxt/worker.js", import.meta.url), join(directory, "worker.mjs"));
  await writeFile(join(directory, "bridge.py"), fixtureBridge);
  await writeFile(join(directory, "selection.json"), JSON.stringify({ python: process.env.PYTHON ?? "python3" }));
  const worker = await import(pathToFileURL(join(directory, "worker.mjs")).href);
  t.after(async () => {
    await worker.closeWorkers(directory);
    await rm(directory, { recursive: true, force: true });
  });
  const call = (payload = {}, signal = AbortSignal.timeout(2000)) => worker.execute({ exchange: "coinbase", action: "bars", symbol: "BTC/USD", ...payload }, { directory, signal });
  return { directory, worker, call };
}

test("Public worker retains process between refreshes and symbols, and keeps a failed request recoverable", { timeout: 6000 }, async t => {
  const f = await fixture(t);
  const first = await f.call();
  const second = await f.call();
  const switched = await f.call({ symbol: "ETH/USD" });
  assert.equal(second.pid, first.pid);
  assert.equal(switched.pid, first.pid);
  assert.equal(switched.symbol, "ETH/USD");
  assert.equal(switched.count, 3);
  await assert.rejects(f.call({ fail: true }), { code: "SOURCE_UNAVAILABLE" });
  const recovered = await f.call();
  assert.equal(recovered.pid, first.pid);
  assert.equal(recovered.count, 5);
});

test("Canceling one active chart does not kill a queued request on the shared public connection", { timeout: 6000 }, async t => {
  const f = await fixture(t), controller = new AbortController();
  const slow = f.call({ pause: 0.2 }, controller.signal);
  const canceled = assert.rejects(slow, { code: "ABORTED" });
  let started;
  for (let i = 0; i < 100; i++) {
    try { started = JSON.parse(await readFile(join(f.directory, "started.json"))); break; } catch {}
    await delay(5);
  }
  assert.ok(started, "The native request must be running before cancellation");
  const next = f.call({ symbol: "ETH/USD" });
  controller.abort();
  await canceled;
  const completed = await next;
  assert.equal(completed.pid, started.pid);
  assert.equal(completed.count, 2);
  assert.equal(completed.symbol, "ETH/USD");
});

test("Explicit routes use distinct sessions and plugin disposal closes all owned processes", { timeout: 6000 }, async t => {
  const f = await fixture(t);
  const direct = await f.call(), proxy = await f.call({ publicProxy: "http://127.0.0.1:7897" });
  assert.notEqual(direct.pid, proxy.pid);
  assert.equal((await f.call()).pid, direct.pid);
  await f.worker.closeWorkers(f.directory);
  for (const pid of [direct.pid, proxy.pid]) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  const fresh = await f.call();
  assert.notEqual(fresh.pid, direct.pid);
});

test("A crashed worker is replaced on the next read without switching the explicit route", { timeout: 6000 }, async t => {
  const f = await fixture(t), first = await f.call();
  await assert.rejects(f.call({ exit: true }), { code: "SOURCE_UNAVAILABLE" });
  const recovered = await f.call();
  assert.notEqual(recovered.pid, first.pid);
  assert.equal(recovered.exchange, "coinbase");
});

test("The connection pool evicts its oldest idle route at its fixed bound", { timeout: 6000 }, async t => {
  const f = await fixture(t), sessions = [];
  for (let i = 0; i < 9; i++) sessions.push(await f.call({ publicProxy: `http://localhost:${7800 + i}` }));
  assert.throws(() => process.kill(sessions[0].pid, 0), { code: "ESRCH" });
  assert.equal((await f.call({ publicProxy: "http://localhost:7808" })).pid, sessions[8].pid);
});

test("Idle native connections expire and active polling is unaffected by cleanup", { timeout: 6000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(t), first = await f.call();
  t.mock.timers.tick(299000);
  assert.equal((await f.call()).pid, first.pid, "Recent use renews the idle window");
  t.mock.timers.tick(300000);
  await f.worker.closeWorkers(f.directory);
  assert.throws(() => process.kill(first.pid, 0), { code: "ESRCH" });
});
