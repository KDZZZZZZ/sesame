import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay, scheduler } from "node:timers/promises";

const hostRoot = process.env.SESAME_HOST_ROOT ?? fileURLToPath(new URL("../../../../mt5agent/", import.meta.url));
const { hostPythonPath } = await import(pathToFileURL(join(hostRoot, "modules/agent/host-environment.js")).href);
const python = process.env.PYTHON ?? hostPythonPath();

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
        response={'id':request['id'],'error':{'code':p['fail'] if isinstance(p['fail'],str) else 'SOURCE_UNAVAILABLE','message':'temporary upstream failure'}}
    else:
        response={'id':request['id'],'result':{'pid':os.getpid(),'count':count,'symbol':p.get('symbol'),'exchange':p['exchange']}}
    print(json.dumps(response),flush=True)
`;

async function fixture(t) {
  assert.ok(python, "The real worker transport fixture requires an available native Python interpreter");
  const directory = await mkdtemp(join(tmpdir(), "sesame-ccxt-worker-"));
  await copyFile(new URL("../packages/ccxt/worker.js", import.meta.url), join(directory, "worker.mjs"));
  await writeFile(join(directory, "bridge.py"), fixtureBridge);
  await writeFile(join(directory, "selection.json"), JSON.stringify({ python }));
  const worker = await import(pathToFileURL(join(directory, "worker.mjs")).href);
  t.after(async () => {
    await worker.closeWorkers(directory);
    assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), "sesame-ccxt-worker-"))));
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

test("A rate-limited public route pauses sibling reads already queued behind it", { timeout: 6000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = await fixture(t), signal = new AbortController().signal;
  const first = await f.call({}, signal);
  const limited = assert.rejects(f.call({ pause: 0.1, fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
  for (let i = 0; i < 100; i++) {
    if (JSON.parse(await readFile(join(f.directory, "started.json"))).count === 2) break;
    await scheduler.wait(5);
  }
  assert.equal(JSON.parse(await readFile(join(f.directory, "started.json"))).count, 2);
  const sibling = f.call({ symbol: "ETH/USD" }, signal);
  // Attach a rejection handler even if a red assertion disposes this queued read.
  sibling.catch(() => {});
  await limited;
  await scheduler.wait(30);
  assert.equal(JSON.parse(await readFile(join(f.directory, "started.json"))).count, 2, "A queued sibling must not bypass the route's rate-limit cooldown");
  t.mock.timers.tick(1999);
  await scheduler.wait(20);
  assert.equal(JSON.parse(await readFile(join(f.directory, "started.json"))).count, 2);
  t.mock.timers.tick(1);
  const recovered = await sibling;
  assert.equal(recovered.pid, first.pid, "Recovery retains the exchange session and its limiter");
  assert.equal(recovered.count, 3);
  assert.equal(recovered.symbol, "ETH/USD");
});

test("Repeated rate limits back off to a fixed bound and a successful read resets recovery", { timeout: 6000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = await fixture(t), signal = new AbortController().signal;
  await assert.rejects(f.call({ fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
  let count = 1;
  for (const interval of [2000, 4000, 8000, 16000, 30000, 30000]) {
    const limited = assert.rejects(f.call({ fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
    await scheduler.wait(20);
    t.mock.timers.tick(interval - 1);
    await scheduler.wait(20);
    assert.equal(JSON.parse(await readFile(join(f.directory, "started.json"))).count, count, "Repeated limits must not dispatch before the increasing cooldown expires");
    t.mock.timers.tick(1);
    await limited;
    count++;
  }
  const recovered = f.call({}, signal);
  recovered.catch(() => {});
  await scheduler.wait(20);
  t.mock.timers.tick(30000);
  assert.equal((await recovered).count, ++count);
  await assert.rejects(f.call({ fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
  count++;
  const next = f.call({}, signal);
  next.catch(() => {});
  await scheduler.wait(20);
  t.mock.timers.tick(2000);
  assert.equal((await next).count, ++count, "After success, the next recovery starts at two seconds");
});

test("A cached market directory cannot clear an upstream rate-limit streak", { timeout: 6000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = await fixture(t), signal = new AbortController().signal;
  await assert.rejects(f.call({ fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
  const markets = f.call({ action: "markets" }, signal);
  markets.catch(() => {});
  await scheduler.wait(20);
  t.mock.timers.tick(2000);
  assert.equal((await markets).count, 2);
  await assert.rejects(f.call({ fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
  const recovered = f.call({}, signal);
  recovered.catch(() => {});
  await scheduler.wait(20);
  t.mock.timers.tick(3999);
  await scheduler.wait(20);
  assert.equal(JSON.parse(await readFile(join(f.directory, "started.json"))).count, 3, "A directory success may be local; the next upstream limit still requires four seconds");
  t.mock.timers.tick(1);
  assert.equal((await recovered).count, 4);
});

test("Rate-limit cooldown respects route isolation, cancellation and disposal", { timeout: 6000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = await fixture(t), signal = new AbortController().signal;
  const first = await f.call({}, signal);
  await assert.rejects(f.call({ fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
  const controller = new AbortController();
  const canceled = assert.rejects(f.call({}, controller.signal), { code: "ABORTED" });
  const other = await f.call({ exchange: "kraken" }, signal);
  assert.notEqual(other.pid, first.pid, "An unrelated route is not delayed by another route's limit");
  let completed = false;
  const sibling = f.call({}, signal).then(value => { completed = true; return value; });
  sibling.catch(() => {});
  await scheduler.wait(20);
  controller.abort();
  await canceled;
  t.mock.timers.tick(1999);
  await scheduler.wait(20);
  assert.equal(completed, false, "Canceling a waiting reader must not release the next reader before the shared cooldown");
  t.mock.timers.tick(1);
  assert.equal((await sibling).count, 3, "The canceled reader never reached the native process");
  await assert.rejects(f.call({ fail: "RATE_LIMITED" }, signal), { code: "RATE_LIMITED" });
  const pending = assert.rejects(f.call({}, signal), { code: "CONNECTION_CHANGED" });
  await scheduler.wait(20);
  await f.worker.closeWorkers(f.directory);
  await pending;
  t.mock.timers.tick(30000);
  assert.throws(() => process.kill(first.pid, 0), { code: "ESRCH" });
  assert.throws(() => process.kill(other.pid, 0), { code: "ESRCH" });
});
