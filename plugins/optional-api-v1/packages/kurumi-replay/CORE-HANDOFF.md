# CORE integration handoff (2026-10-12)
CORE owner is implementing lifecycle/profile now, no installed code or official run touched.

## Frozen run profiles
`experiment-profiles.js` exports `LEGACY_PROFILE_ID`, `ROUND2_PROFILE_ID`, `getExperimentProfile(id)`, `resolveExperimentProfile(state)`, `assertNativeRules(state)`. New named profile `informed-replay-50x-v1`: chapters leverage 50/50/50; original stopout .2/.5/.3, fees 3/1000/side, financing10/1000/day, FX60000ms unchanged. Legacy checkpoints with no profile retain500/25/25; selected new profile stored `engine.rules.experimentProfile` with digest+content, `chapterRules` frozen. Native snapshot returns current leverage/stopout/profile.

## Document selection
`service.getDocument()` selects `experiments/current` pointer if present, otherwise legacy `challenge/continuous`. New documents use `challenge/<newRunId>`; legacy continuous never replaced/reset. CORE will expose `archiveTerminal`, `createExperiment`, `experimentHistory`, `retryCommittedHooks`. Creation performs no model selection/request; model chosen only explicit start. Immutable terminal history stored `experiment-history/<runId>`.

## Hook contract (as agreed)
`replay-presentation.js`: export async `onReplayCommitted(host, service, context, signal)`
`weekly-reports.js`: export async `onWeeklyBoundary(host, service, context, signal)`
Both await after each atomic H1 commit + raw H1 archive, including chapter_end/terminal. CORE context: `{engine,previousEngine,runId,consumedTicks,chapterEnded,terminal,replayCutoffMs,closedThroughMs,consumedChapter,consumedIndex}`. `consumedTicks` from verified *last native journal* only, hash-checked immutable ticksRef if necessary; no unconsumed suffix. `replayCutoffMs` is last consumed quote time; `closedThroughMs` is interval exclusive end ONLY when journal coverage indicates full interval and not bankrupt. This avoids treating a single last quote as OHLC/closed H1. On chapter transition current engine.lastQuote may be null; derive cutoff from consumed journal, not next-chapter OHLC. New engine also supplies `lastConsumedInterval={chapter,index,from,toExclusive,lastTime,complete,rowCount}`. Weekly may use closedThroughMs as boundary when interval is complete, while market inputs cannot exceed replayCutoffMs.
CORE durable outbox saves previousEngine/current engine versions before hooks; failures pause scheduling, preserve committed ledger. Restart records pending hooks only, no model/task/trade call. `retryCommittedHooks` explicit command drains same versions. Hook implementations must idempotent by runId/version, avoid paid resubmission on restart. Please provide any pending-only recovery API in your handoff.

## Boundaries
Original-story metadata stays spectator-only. Do not put original markers/outcomes into roles. CORE adds explicit new-run whole-window FX binding tool; legacy import kept unchanged. Hook modules owned by UI must exist before integrated suite/import; CORE uses dynamic import at call time to avoid factory side effects. Please report new public exports/tools you need CORE to wire.
