import { records } from './records.js';
import { readUserFile, runProcess } from './execution.js';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { check, digest, decimal } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { selected } from './environment.js';
import { fixedRows } from './fixed-input.js';
import { publishInputs, publishResult } from './results.js';

export async function backtest(host, args, signal) {
  const bytes = await readUserFile(host,
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
    fixed = await fixedRows(host, args.data, args.columns),
    fingerprint = digest({
      source,
      data: args.data,
      columns: args.columns ?? {},
      className: args.class_name,
      title: args.title,
      parameters: args.parameters ?? {},
      config: args.config,
    });
  const old = records(host).get("backtests", args.operation_id, true);
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
  check(
    ["minutes", "days", "weeks", "months"].includes(
      args.config.feed?.timeframe,
    ) &&
      Number.isInteger(args.config.feed?.compression) &&
      args.config.feed.compression >= 1 &&
      args.config.feed.compression <= 100000,
    "Explicit feed timeframe/compression is required; no timestamp interval inference",
    "INVALID_ARGUMENT",
  );
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
  const claimed = records(host).transaction(() => {
    const existing = records(host).get("backtests", args.operation_id, true);
    if (existing) {
      check(
        existing.fingerprint === fingerprint,
        "Operation already identifies different frozen inputs",
        "IDEMPOTENCY_CONFLICT",
      );
      return false;
    }
    records(host).put("backtests", {
      id: args.operation_id,
      fingerprint,
      status: "running",
    });
    return true;
  });
  if (!claimed) {
    const existing = records(host).get("backtests", args.operation_id);
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
    const { envRef, sourceRef, inputs } = await publishInputs(host, args, { bytes, fixed, selectedEnv, origin });
    directory = join(host.context.workspaceRoot, `.backtrader-${randomUUID()}`);
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
    run = await runProcess(host,
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
        run.exitCode === 0,
      "Engine/process status disagree",
    );
    const answer = await publishResult(host, args, { sourceRef, envRef, inputs, run, result, rawBytes, origin });
    records(host).update("backtests", args.operation_id, {
      status: result.status,
      result: answer,
    });
    return answer;
  } catch (error) {
    preserve = error.code === "runtime_cleanup_failed";
    records(host).update("backtests", args.operation_id, {
      status: "unknown",
      reason: error.code ?? "EXECUTION_INTERRUPTED",
    });
    throw error;
  } finally {
    // Windows may hold native process files briefly while cancellation settles.
    if (directory && !preserve)
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
