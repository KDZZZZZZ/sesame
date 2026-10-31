import { publishFiles } from './resource-files.js';
import { digest } from '@sesame/plugin-sdk/protocol';

async function resource(host,operationId,kind,content,files={},dependencies=[],origin) {return publishFiles(host,{operationId,kind,content,files,dependencies,...(origin?{provenance:{kind:origin,references:dependencies}}:{})});}

export async function publishInputs(host, args, { bytes, fixed, selectedEnv, origin }) {
    const envRef = await resource(
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
    const sourceRef = await resource(
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
    const inputs = await resource(
      host,
      args.operation_id + ":inputs",
      "resource",
      {
        type: "backtrader-inputs",
        data: args.data,
        nativeSource: sourceRef,
        config: args.config,
        parameters: args.parameters ?? {},
        ...(args.parameter_space ? { parameterSpace: args.parameter_space, optimizer: 'Cerebro.optstrategy' } : {}),
        provenance: { kind: origin },
      },
      { "bars.json": JSON.stringify(fixed.rows) },
      [args.data, sourceRef, envRef],
    );
    return { envRef, sourceRef, inputs };
}

export async function publishResult(host, args, { sourceRef, envRef, inputs, run, result, rawBytes, origin }) {
    const dependencies = [args.data, sourceRef, envRef, inputs],
      raw = await resource(
        host,
        args.operation_id + ":receipt",
        "resource",
        {
          type: "backtrader-receipt",
          status: result.status,
          executionRunId: run.runId ?? null,
        },
        { "result.json": rawBytes },
        dependencies,
      );
    const tables =
      result.status === "completed" || result.passes
        ? await Promise.all((result.passes ? ['passes'] : ["equity", "trades", "orders"]).map(async (name) => ({
            id: name,
            ref: await resource(
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
          })))
        : [];
    const ref = await resource(
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
        ...(result.optimizer ? { optimizer: result.optimizer } : {}),
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
      executionRunId: run.runId ?? null,
      nativeSource: sourceRef,
      environment: envRef,
      rawResult: raw,
      ...(result.passes ? { optimizer: result.optimizer, passes: result.passes.map(({ equity, trades, orders, ...summary }) => summary) } : {}),
    };
    return answer;
}
