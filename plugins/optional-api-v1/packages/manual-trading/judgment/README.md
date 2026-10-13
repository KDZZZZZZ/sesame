# Manual trading judgment and episodic memory

The judgment service preserves the existing `judgment-evolution` registration,
frozen evidence checks, probability scoring, semantic reflection, coverage audit
and prospective rule evaluation. The original package is retained. Tools are
published as `manual_judgment_*`, so both packages can be installed together.

## Host integration

```js
import { JudgmentService, createJudgmentTools } from './judgment/index.js';
import { createTradingMemory } from './memory.js';

const judgment = new JudgmentService(host).init();
const tools = createJudgmentTools(scopedHost, { service: judgment });
const memory = createTradingMemory(scopedHost, { now: Date.now });
// A service host must bind the trusted plan owner in the factory:
// createTradingMemory(serviceHost, { now: Date.now, ownerConversationId });
// Attach judgment.auditTurn(event) to the plugin afterTurn hook.
// Await judgment.close() during plugin disposal.
```

`JudgmentService` options are `clock` (returns a Date), `policy`, `pluginId`
(default `sesame/manual-trading`), `workspaceSubpath` (default
`manual-trading/judgment`) and `stateSubpath` (default `judgment-state`).
Relative directory components cannot escape their host root or traverse links.
Its SQLite file lives under `host.storage.directory/stateSubpath`, with exports
under `host.workspace.root('conv_main')/workspaceSubpath`.

`activateJudgment(host, options)` is also available and returns
`{service, afterTurn, dispose}`. An explicit service passed to the factory does
not require this convenience activation or its instance registry.

## Memory API

All three memory methods are **synchronous**, using the host's synchronous
`storage.get(kind,id,true)`, `storage.put(kind,record)`, `storage.list(kind)` and,
for review, `datasets.read(id)` ports. They do not submit orders, retrieve market
data, call a model, or promote reflections into validated judgment rules.
Main hosts use their own conversation. Service hosts require an explicit
`ownerConversationId` factory option; method arguments cannot override that
binding. Subagent hosts cannot access memory or bind a different owner.

### `record(run)`

Required fields: `id`, `planId`, `accountId` (strings), `snapshot` and `decision`
(JSON objects). `createdAt` is epoch milliseconds or ISO8601 with a timezone; it
defaults to local record time. Use the time all stored episode information,
including later execution and team reports, became available. Optional
`decisionAt` is the actual decision time as nonnegative epoch milliseconds,
no later than `createdAt` or now. Snapshot observations must be known by
`decisionAt` (or `createdAt` when omitted); later role reports may be known by
`createdAt`. This permits reviewing fills between the decision and completion
without exposing the completed episode early. `symbols` may be supplied, or
symbols are collected from `symbol`, `snapshot.symbol`, `snapshot.symbols` and
`decision.targets[].symbol`.

`reports` and any extra JSON fields are preserved, including team role, model,
reasoning and output. The full record is limited to 256 KiB; oversized input is
rejected rather than silently clipped. An unchanged target/hold decision is
still a valid episode. Same ID and same normalized content is idempotent;
conflicting content is rejected. `recordedAt` is assigned locally, so an import
with an old `createdAt` does not become visible to earlier historical queries.

### `context({planId,accountId,symbols=[],asOf,limit=8})`

`accountId` is required. `asOf` defaults to now. Only the same conversation and
account are searched, and records must have been both created and actually
recorded by `asOf`. Provided symbols must overlap the run's symbols; relevant
episodes from other plans can be returned. Without symbols, a provided plan ID
filters to that plan. Ranking uses symbol overlap, same plan, then recency.

Returns `{asOf,accountId,cases,lessons,omittedDueToBudget,note}`. Cases contain the
complete stored run and `review` (the newest review already known by `asOf`, or
null). Lessons contain `{runId,reviewId,reflection,knownAt,executionConfirmed}`.
The default result limit is 8, maximum 20, with a 256 KiB combined case/lesson
budget. Oversized cases are omitted whole and counted, never partially rewritten.

### `review({runId,asOf,evidence,reflection})`

Requires 1–16 evidence references and a reflection of at most 6,000 characters.
The dataset source must be registered external data with provider and `as_of`;
synthetic, forecast and manually entered provenance is rejected, including in
ancestry. Evidence must be observed at or after `decisionAt ?? createdAt` and
obtained by the requested review time. Every recorded `as_of` and `retrieved_at`
in the source ancestry is checked, including intermediate derived datasets.
A source snapshot and its hash are stored independently
of the live dataset. Repeated identical evidence and reflection is idempotent.
Different reflections append new records; earlier reviews remain intact.

```js
memory.review({
  runId: 'run-123',
  asOf: '2026-10-13T16:00:00Z',
  evidence: [{
    datasetId: 'dataset-123', // dataset_id is accepted as an alias
    rowIndex: 0,              // default 0
    kind: 'market',           // observation (default), market or execution
    observedAtField: 'observed_at',
    symbolField: 'symbol',    // optional; row.symbol is used if present
    accountIdField: 'account_id', // optional for market, required for execution
  }],
  reflection: 'The market invalidated the thesis. No confirmed fill is recorded.',
});
```

`kind: execution` additionally requires `executionIdField`, `quantityField`,
`priceField`, and `runIdField`, all pointing to actual source-row fields. The row
must bind the same account, run and symbol and contain a nonzero native fill ID,
positive quantity and price. Currently accepted native sources are
`mt5/<server>/history_deals_get` and `qmt/<server>/query_stock_trades`. An
uncorrelated broker row cannot be attributed to a particular decision.

Every review's `outcome` contains `executionConfirmed`, `realizedPnl: null`,
`actualTradeReturn: null` and a basis description. Even a verified opening fill
does not establish full portfolio P&L: closing fills, inventory and costs need
separate broker reconciliation. Source-reported values remain available in the
evidence row. Target weights, quotes and proposed trades never become fills or
profits. Reflection text is an agent interpretation, not validated performance.

## Existing history

The new judgment service does not automatically copy or merge the old package's
database. To retain historical judgment state during an intentional migration,
stop the old instance and use a consistent SQLite backup into the new private
`judgment-state/judgments.sqlite`; do not copy a live WAL database piecemeal.
Alternatively, configure the service to the intentionally migrated state root.
Keep the old package and its history until the migration is verified. Trading
episodes and judgment probability records are separate evidence stores.

## Design references

- [TradingAgents](https://github.com/TauricResearch/TradingAgents): durable decision,
  observed outcome and reflection records.
- [META paper](https://arxiv.org/abs/2609.28771) and
  [published implementation](https://github.com/KriXord/Agent-Memory-with-Episodic-Retrieval-for-Financial-Decision-Making):
  state/action/outcome/reflection episodes and selective historical retrieval.
- Local `judgment-evolution`: the full copied judgment implementation; see
  [references.md](references.md) for its evidence and calibration background.

The new memory module uses deterministic symbol/plan/recency retrieval rather
than reproducing META's indicator vectors. It makes no claim of reproducing
either project's experimental accuracy, returns or SOTA status.
