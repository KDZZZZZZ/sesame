import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { check, digest, decimal } from "@sesame/plugin-sdk/protocol";
import { Decimal } from "@sesame/plugin-sdk/decimal";
import { environment, selected } from "./environment.js";
function resource(
  host,
  operationId,
  kind,
  content,
  files = {},
  dependencies = [],
) {
  return host.artifacts.publish({
    operationId,
    manifest: {
      kind,
      schemaVersion: "1.0.0",
      content,
      dependencies,
      blobs: Object.entries(files).map(([path, bytes]) => ({
        path,
        mediaType: path.endsWith(".py") ? "text/x-python" : "application/json",
        ...host.artifacts.blob(bytes),
      })),
    },
  });
}
export function fixedRows(host, ref, columns = {}) {
  const artifact = host.artifacts.read(ref),
    content = artifact.manifest.content;
  check(
    ref.kind === "data" && content.format === "json-rows",
    "Fixed json-rows DataRef required",
  );
  const blob = artifact.manifest.blobs.find(
    (blob) => blob.path === content.path,
  );
  check(
    blob && blob.size <= 16 * 1024 * 1024,
    "Input blob absent or exceeds 16MiB",
  );
  const rows = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      host.artifacts.readBlob(blob),
    ),
  );
  check(
    Array.isArray(rows) &&
      rows.length === content.rowCount &&
      rows.length >= 2 &&
      rows.length <= 100000,
    "Input row count mismatch or budget exceeded",
  );
  check(
    ["demo", "observed", "derived", "user_input"].includes(
      content.provenance?.kind,
    ),
    "Input provenance is required",
  );
  let prior = -Infinity;
  const mapped = rows.map((row) => {
    let time = row[columns.datetime ?? "datetime"];
    if (time?.basis === "utc") {
      check(Number.isSafeInteger(time.unixMs), "Invalid source UTC time");
      time = new Date(time.unixMs).toISOString();
    }
    check(
      typeof time === "string" &&
        /(Z|[+-]\d\d:\d\d)$/.test(time) &&
        Number.isFinite(Date.parse(time)),
      "Only explicit UTC/offset timestamps; no wall-clock inference",
    );
    const at = Date.parse(time);
    check(at > prior, "Fixed input times must strictly increase");
    prior = at;
    const prices = Object.fromEntries(
      ["open", "high", "low", "close", "volume"].map((key) => [
        key,
        decimal(row[columns[key] ?? key]),
      ]),
    );
    check(
      Decimal.compare(prices.high, prices.low) >= 0 &&
        ["open", "close"].every(
          (key) =>
            Decimal.compare(prices[key], prices.low) >= 0 &&
            Decimal.compare(prices[key], prices.high) <= 0,
        ) &&
        Decimal.compare(prices.volume, "0") >= 0,
      "Invalid fixed OHLCV",
    );
    return { datetime: new Date(at).toISOString(), ...prices };
  });
  return { rows: mapped, origin: content.provenance.kind };
}
async function backtest(host, args, signal) {
  const bytes = await host.workspace.file(
    "read",
    args.strategy_path,
    undefined,
    signal,
  );
  check(
    bytes.length > 0 && bytes.length <= 512 * 1024,
    "One strategy Python file <=512KiB",
  );
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    fixed = fixedRows(host, args.data, args.columns),
    fingerprint = digest({
      source,
      data: args.data,
      columns: args.columns ?? {},
      className: args.class_name,
      title: args.title,
      parameters: args.parameters ?? {},
      config: args.config,
    });
  const old = host.storage.get("backtests", args.operation_id, true);
  if (old) {
    check(
      old.fingerprint === fingerprint,
      "Operation already identifies different frozen inputs",
      "IDEMPOTENCY_CONFLICT",
    );
    return (
      old.result ?? {
        status: "unknown",
        operation_id: args.operation_id,
        reason:
          "Owned execution interrupted; this operation is never automatically rerun.",
      }
    );
  }
  for (const key of ["capital", "commission", "slippage"]) {
    decimal(args.config[key]);
    check(
      Decimal.compare(args.config[key], "0") >= 0,
      "Config must be nonnegative",
    );
  }
  check(
    Decimal.compare(args.config.capital, "0") > 0 &&
      Decimal.compare(args.config.commission, "1") <= 0 &&
      Decimal.compare(args.config.slippage, "1") < 0,
    "Capital positive; rates are ratios below allowed bound",
  );
  const selectedEnv = await selected(host, signal);
  const claimed = host.storage.transaction(() => {
    const existing = host.storage.get("backtests", args.operation_id, true);
    if (existing) {
      check(
        existing.fingerprint === fingerprint,
        "Operation already identifies different frozen inputs",
        "IDEMPOTENCY_CONFLICT",
      );
      return false;
    }
    host.storage.put("backtests", {
      id: args.operation_id,
      fingerprint,
      status: "running",
    });
    return true;
  });
  if (!claimed) {
    const existing = host.storage.get("backtests", args.operation_id);
    return (
      existing.result ?? {
        status: "unknown",
        operation_id: args.operation_id,
        reason:
          "Owned execution already reserved; it is never automatically replayed.",
      }
    );
  }
  const origin = fixed.origin === "demo" ? "demo" : "derived";
  let directory,
    run,
    result,
    preserve = false;
  try {
    const envRef = resource(
      host,
      args.operation_id + ":environment",
      "environment",
      {
        type: "backtrader-environment",
        execution: "host",
        path: "environment.json",
        version: "1.9.78.123",
      },
      { "environment.json": JSON.stringify(selectedEnv) },
    );
    const sourceRef = resource(
      host,
      args.operation_id + ":source",
      "resource",
      {
        type: "native-strategy-source",
        language: "python",
        className: args.class_name,
        path: "strategy.py",
        sourceDigest: digest(bytes),
        svlEquivalent: false,
      },
      { "strategy.py": bytes },
    );
    const inputs = resource(
      host,
      args.operation_id + ":inputs",
      "resource",
      {
        type: "backtrader-inputs",
        data: args.data,
        nativeSource: sourceRef,
        config: args.config,
        parameters: args.parameters ?? {},
        provenance: { kind: origin },
      },
      { "bars.json": JSON.stringify(fixed.rows) },
      [args.data, sourceRef, envRef],
    );
    directory = join(host.workspace.root(), `.backtrader-${randomUUID()}`);
    await mkdir(directory);
    await writeFile(join(directory, "strategy.py"), bytes);
    await writeFile(
      join(directory, "request.json"),
      JSON.stringify({
        strategy_path: join(directory, "strategy.py"),
        class_name: args.class_name,
        rows: fixed.rows,
        parameters: args.parameters ?? {},
        config: args.config,
      }),
    );
    run = await host.workspace.run(
      [
        selectedEnv.python,
        "-I",
        "-B",
        fileURLToPath(new URL("./runner.py", import.meta.url)),
        join(directory, "request.json"),
        join(directory, "result.json"),
      ],
      { cwd: directory, timeout: args.timeout ?? 120, signal },
    );
    signal?.throwIfAborted();
    const rawBytes = await readFile(join(directory, "result.json"));
    check(rawBytes.length <= 16 * 1024 * 1024, "Result budget exceeded");
    result = JSON.parse(rawBytes);
    check(
      ["completed", "failed"].includes(result.status) &&
        (run.exitCode === 0) === (result.status === "completed"),
      "Engine/process status disagree",
    );
    const dependencies = [args.data, sourceRef, envRef, inputs],
      raw = resource(
        host,
        args.operation_id + ":receipt",
        "resource",
        {
          type: "backtrader-receipt",
          status: result.status,
          executionId: run.executionId ?? null,
        },
        { "result.json": rawBytes },
        dependencies,
      );
    const tables =
      result.status === "completed"
        ? ["equity", "trades", "orders"].map((name) => ({
            id: name,
            ref: resource(
              host,
              args.operation_id + ":" + name,
              "data",
              {
                format: "json-rows",
                path: "rows.json",
                rowCount: result[name].length,
                columns: [
                  ...new Set(result[name].flatMap((row) => Object.keys(row))),
                ],
                provenance: {
                  kind: origin,
                  description:
                    "Actual Backtrader outputs for fixed inputs; native float arithmetic",
                },
              },
              { "rows.json": JSON.stringify(result[name]) },
              [...dependencies, raw],
            ),
          }))
        : [];
    const ref = resource(
      host,
      args.operation_id,
      "strategy.result",
      {
        schemaVersion: "1.0.0",
        status: result.status,
        title: args.title,
        source: null,
        nativeSource: sourceRef,
        translation: null,
        engine: result.engine ?? {
          name: "Backtrader Cerebro",
          version: "1.9.78.123",
        },
        execution: "host",
        environment: envRef,
        assumptions: inputs,
        inputs: [args.data],
        rawResult: raw,
        data: tables,
        statistics: result.statistics ?? {},
        provenance: { kind: origin, references: dependencies },
        limitations: result.limitations ?? [
          "Native engine failed; no success claim.",
        ],
      },
      {},
      [...dependencies, raw, ...tables.map((table) => table.ref)],
    );
    const answer = {
      ref,
      status: result.status,
      data: tables,
      statistics: result.statistics ?? {},
      diagnostics: result.error ?? null,
      executionId: run.executionId ?? null,
      nativeSource: sourceRef,
      environment: envRef,
    };
    host.storage.update("backtests", args.operation_id, {
      status: result.status,
      result: answer,
    });
    return answer;
  } catch (error) {
    preserve = error.code === "runtime_cleanup_failed";
    host.storage.update("backtests", args.operation_id, {
      status: "unknown",
      reason: error.code ?? "EXECUTION_INTERRUPTED",
    });
    throw error;
  } finally {
    if (directory && !preserve)
      await rm(directory, { recursive: true, force: true });
  }
}
export function createTools(host) {
  const { define, Type, string } = host.tools,
    ref = (kind) =>
      Type.Object(
        {
          id: Type.String(),
          revision: Type.String(),
          digest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
          kind: Type.Literal(kind),
          schemaVersion: Type.Literal("1.0.0"),
        },
        { additionalProperties: false },
      ),
    number = Type.String({ pattern: "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$" });
  return [
    define(
      "backtrader_environment",
      "Inspect and select existing pinned Backtrader/Python first; explicit prepare installs private PyPI dependencies only if missing. No startup downloads.",
      {
        action: Type.Union(["inspect", "prepare"].map(Type.Literal)),
        python_path: Type.Optional(string("Existing native Python executable")),
      },
      (args, signal) => environment(host, args, signal),
    ),
    define(
      "backtrader_backtest",
      "Run real Cerebro on one fixed UTC/offset DataRef and authored backtrader.Strategy file. Managed host execution, stocklike cash simulation, never connects a broker; no SVL equivalence. Frozen operation never replays an interrupted run.",
      {
        operation_id: string("Immutable operation key"),
        title: string("Result title"),
        data: ref("data"),
        strategy_path: string("Authored workspace Python file"),
        class_name: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }),
        config: Type.Object(
          { capital: number, commission: number, slippage: number },
          { additionalProperties: false },
        ),
        parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        columns: Type.Optional(
          Type.Object(
            Object.fromEntries(
              ["datetime", "open", "high", "low", "close", "volume"].map(
                (key) => [key, Type.Optional(Type.String())],
              ),
            ),
            { additionalProperties: false },
          ),
        ),
        timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
      },
      (args, signal) => backtest(host, args, signal),
    ),
    define(
      "backtrader_result",
      "Read fixed result and report DataRefs without rerunning native code.",
      { ref: ref("strategy.result") },
      (args) => host.artifacts.read(args.ref),
    ),
  ];
}
