import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// One serial worker per exact public route preserves CCXT's HTTP session,
// market directory and exchange rate limiter across reads and chart switches.
const workers = new Map();
const processes = new Set();
const MAX_WORKERS = 8, MAX_QUEUE = 128, MAX_OUTPUT = 8 * 1024 * 1024;
const IDLE_MS = 5 * 60000, REQUEST_MS = 45000;
const failure = (message, code = "SOURCE_UNAVAILABLE") => Object.assign(Error(message), { code });
const safeMessage = value => String(value).replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, "$1[redacted]@").slice(-1500);
const checkCanceled = signal => { if (signal?.aborted) throw failure("Public request canceled", "ABORTED"); };

class PublicWorker {
  constructor(key, directory, python) {
    this.key = key;
    this.directory = directory;
    this.queue = [];
    this.active = null;
    this.serial = 0;
    this.output = "";
    this.stderr = "";
    this.lastUsed = Date.now();
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
    this.child = spawn(python, ["-I", "-B", "-u", fileURLToPath(new URL("./bridge.py", import.meta.url))], {
      cwd: directory, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", chunk => this.receive(chunk));
    this.child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk).slice(-1500); });
    this.child.stdin.on("error", error => this.stop(failure(safeMessage(error.message))));
    this.child.on("error", error => this.stop(failure(safeMessage(error.message))));
    this.child.on("close", () => {
      this.ended = true;
      this.stop(failure("Public exchange worker stopped" + (this.stderr ? ": " + safeMessage(this.stderr) : "")));
      clearTimeout(this.killTimer);
      processes.delete(this);
      this.resolveClosed();
    });
  }
  reference(enabled) {
    const method = enabled ? "ref" : "unref";
    this.child[method]();
    for (const pipe of [this.child.stdin, this.child.stdout, this.child.stderr]) pipe[method]?.();
  }
  request(payload, signal) {
    if (signal?.aborted) return Promise.reject(failure("Public request canceled", "ABORTED"));
    if (this.dead) return Promise.reject(failure("Public exchange worker is closed"));
    if (this.queue.length >= MAX_QUEUE) return Promise.reject(failure("Public request queue is full", "RESOURCE_EXHAUSTED"));
    clearTimeout(this.idleTimer);
    this.reference(true);
    return new Promise((resolve, reject) => {
      const item = { id: String(++this.serial), payload, signal, resolve, reject, settled: false };
      item.abort = () => {
        this.settle(item, failure("Public request canceled", "ABORTED"));
        // A canceled reader never kills another chart's shared connection.
        // If already sent, drain its bounded response before the next request.
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
      };
      signal?.addEventListener("abort", item.abort, { once: true });
      this.queue.push(item);
      if (signal?.aborted) item.abort();
      this.dispatch();
    });
  }
  settle(item, error, result) {
    if (item.settled) return;
    item.settled = true;
    item.signal?.removeEventListener("abort", item.abort);
    if (error) item.reject(error);
    else item.resolve(result);
  }
  dispatch() {
    if (this.dead || this.active) return;
    const item = this.queue.shift();
    if (!item) {
      this.lastUsed = Date.now();
      this.reference(false);
      this.idleTimer = setTimeout(() => this.stop(failure("Idle public connection closed", "CONNECTION_CHANGED")), IDLE_MS);
      this.idleTimer.unref?.();
      return;
    }
    this.active = item;
    this.requestTimer = setTimeout(() => this.stop(failure("Public exchange request timed out")), REQUEST_MS);
    this.child.stdin.write(JSON.stringify({ id: item.id, payload: item.payload }) + "\n");
  }
  receive(chunk) {
    if (this.dead) return;
    this.output += chunk;
    // Every response is bounded independently; sessions do not accumulate output.
    if (Buffer.byteLength(this.output) > MAX_OUTPUT) {
      this.stop(failure("Public response exceeds output budget", "RESOURCE_EXHAUSTED"));
      return;
    }
    let end;
    while ((end = this.output.indexOf("\n")) >= 0) {
      const line = this.output.slice(0, end);
      this.output = this.output.slice(end + 1);
      let response;
      try { response = JSON.parse(line); } catch {
        this.stop(failure("Invalid public worker response", "SOURCE_DATA_INVALID"));
        return;
      }
      const item = this.active;
      if (!item || !response || typeof response !== "object" || response.id !== item.id || Object.hasOwn(response, "result") === Object.hasOwn(response, "error")) {
        this.stop(failure("Public worker response identity mismatch", "SOURCE_DATA_INVALID"));
        return;
      }
      clearTimeout(this.requestTimer);
      this.active = null;
      this.settle(item, response.error ? failure(safeMessage(response.error.message), response.error.code ?? "SOURCE_UNAVAILABLE") : null, response.result);
      this.dispatch();
    }
  }
  stop(error = failure("Public connection disposed", "CONNECTION_CHANGED")) {
    if (this.dead) return this.closed;
    this.dead = true;
    if (workers.get(this.key) === this) workers.delete(this.key);
    clearTimeout(this.idleTimer);
    clearTimeout(this.requestTimer);
    for (const item of [...this.queue, ...(this.active ? [this.active] : [])]) this.settle(item, error);
    this.queue = [];
    this.active = null;
    if (!this.ended) {
      this.reference(true);
      this.child.kill("SIGTERM");
      this.killTimer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
      this.killTimer.unref?.();
    }
    return this.closed;
  }
}

export async function execute(payload, context) {
  checkCanceled(context.signal);
  const directory = resolve(context.directory);
  const selected = JSON.parse(await readFile(join(directory, "selection.json")));
  if (typeof selected.python !== "string" || !selected.python) throw failure("Select a compatible public-market Python environment first", "PREREQUISITE_REQUIRED");
  if (Buffer.byteLength(JSON.stringify(payload)) > 65536) throw failure("Public request exceeds input budget", "RESOURCE_EXHAUSTED");
  checkCanceled(context.signal);
  const key = JSON.stringify([directory, selected.python, payload.exchange, payload.publicProxy ?? null]);
  let worker = workers.get(key);
  while (!worker) {
    if (workers.size >= MAX_WORKERS) {
      const idle = [...workers.values()].filter(worker => !worker.active && !worker.queue.length).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!idle) throw failure("Public connection pool is busy", "RESOURCE_EXHAUSTED");
      await idle.stop();
      checkCanceled(context.signal);
      worker = workers.get(key);
      continue;
    }
    worker = new PublicWorker(key, directory, selected.python);
    processes.add(worker);
    workers.set(key, worker);
  }
  return worker.request(payload, context.signal);
}

export async function closeWorkers(directory) {
  if (!directory) return;
  const target = resolve(directory);
  await Promise.all([...processes].filter(worker => worker.directory === target).map(worker => worker.stop()));
}
