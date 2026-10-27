# Schema Worker startup isolation — 2026-10-18

## Observed failure and scope

The retained `run-3/evidence.json` contains `MCP schema worker 启动超时` on capability input/output validation after genuine concurrent member execution. The same file separately records the earlier OAuth refresh interruption. This patch does not change authentication or the research harness.

An idle-process batch of 8 valid, small schemas completed in 184 ms before the change. Therefore, concurrent calls alone did not reproduce the actual 30-second startup stall. No claim is made that this patch fully explains the production stall; the resumed real workflow is the remaining validation.

## Confirmed defect and repair

Previously, `schema-worker.js` imported `schemaValidator` from `mcp-client.js`, which also imported Store/SQLite, process execution, the plugin package parser, the capability contract and the workflow graph code. Every validation worker loaded that unrelated host module graph.

The compiler now lives in `modules/agent/plugin-system/schema-validator.js`. The worker imports only that compiler and `node:worker_threads`. Its Ajv instance is initialized for the requested schema dialect. `mcp-client.js` keeps its public wrapper and the existing direct-call `ApiError` shape.

The worker's startup deadline, execution deadline, memory limit, payload limit, schema byte limit, nesting/node limits and isolated execution remain intact. No worker pool or unbounded retry was introduced.

## Verification

- A regression worker rejects host storage/process/plugin imports: the original code failed by loading `mcp-client.js`; the repaired code passes.
- A 16-worker batch mixes valid and invalid inputs and verifies each result independently.
- Draft-07 and 2020-12 tuple validation, schema size/depth/node limits, worker startup/exit/error handling and direct-call error compatibility pass.
- The pathological regular-expression test still terminates around 3 seconds without blocking the application's event loop.
- `node --test tests/schema-worker.test.js tests/plugin-packages.test.js tests/report-library-tools-policy.test.js tests/workflow-capability-schema.test.js tests/mt5-project-schema.test.js`: **35 passed**, no failures/skips.
- Syntax and whitespace checks pass. Oxlint reports only 3 pre-existing spread-style warnings in unchanged portions of `mcp-client.js`.
- The equivalent post-change 8-worker idle sample completed in 118 ms. This is a local timing sample, not a general benchmark or proof of the 30-second cause.

## Separate findings retained for follow-up

1. `web-sources/fetch.js` permits source bodies up to 2 MiB. The default `validateSchemas` payload allowance is 1 MiB, and the MCP argument/output path uses that default. `run-3` preparation recorded `Schema 校验数据超限（1 MiB）` while handing a fetched page to an inline parser. The native capability service already has a separate 64 MiB allowance; increasing that service allowance would not fix the parser handoff. This patch does not change either interface limit.
2. `CapabilityService.validate` currently converts every validation exception, including worker infrastructure failures, into `INVALID_INPUT`/`INVALID_OUTPUT`. Error classification is unchanged by this isolated-import repair and remains a distinct follow-up.

No model calls, user-configuration edits, installation, release or publication were performed in this repair lane.
