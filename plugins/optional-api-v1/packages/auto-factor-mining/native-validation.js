import { mkdir, writeFile, realpath, lstat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { invokeValue } from '@sesame/plugin-sdk/capabilities';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { check, digest, canonical } from './workflow-mechanics.js';
import { nativePlugins } from './native-plan.js';
import { boundMT5Arguments, optimizerPasses } from './native-mt5.js';

const active = status => ['queued', 'running', 'canceling', 'cancelling'].includes(status);
const numeric = value => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value);
const at = (value, path) => path.split('.').reduce((v, key) => v?.[key], value);
const err = error => ({ code: error?.code ?? 'NATIVE_EXECUTION', message: String(error?.message ?? error).slice(0, 1500) });
export function chooseParameters(passes, objective) {
  const measured = passes.filter(pass => pass.status === 'completed' && numeric(at(pass.statistics, objective.metric)));
  check(measured.length, 'NATIVE_OBJECTIVE_UNAVAILABLE', 'No completed pass has the predeclared numeric objective; do not choose by another metric or holdout');
  // Stable ties preserve the predeclared input order, not a post-hoc preference.
  return measured.reduce((best, pass) => {
    const order = Decimal.compare(String(at(pass.statistics, objective.metric)), String(at(best.statistics, objective.metric)));
    return (objective.direction === 'max' ? order > 0 : order < 0) ? pass : best;
  });
}

/** Runs only in the native controller, after all research Agents have ended. */
export async function executeNative(host, { runId, plan, state: initial, factorSelectionDigest, onChange, now = Date.now, signal }) {
  if (!plan) return initial;
  check(initial && digest(plan) === initial.planDigest, 'NATIVE_PLAN_CHANGED', 'Native plan differs from its admission digest; do not dispatch or reuse a changed result');
  check(!initial.factorSelectionDigest || initial.factorSelectionDigest === factorSelectionDigest, 'NATIVE_SELECTION_CHANGED', 'Native validation belongs to a different frozen factor selection');
  if (initial.selection) {
    const { digest: selectionDigest, frozenAt: _frozenAt, ...body } = initial.selection;
    check(selectionDigest === digest(body) && body.planDigest === initial.planDigest && body.factorSelectionDigest === factorSelectionDigest && body.developmentEvidenceDigest === digest(initial.development?.passes),
      'NATIVE_SELECTION_CHANGED', 'Frozen native parameters/objective/evidence changed; no holdout or result reuse');
  }
  if (['completed', 'unavailable', 'failed', 'unverified', 'partial'].includes(initial.status)) return initial;
  let state = structuredClone(initial);
  const save = async patch => { state = { ...state, ...structuredClone(patch) }; await onChange(structuredClone(state)); return state; };
  const saveAttempt = async (key, patch) => save({ attempts: state.attempts.map(a => a.key === key ? { ...a, ...structuredClone(patch) } : a) });
  const plugin = nativePlugins[plan.engine];
  const call = (tool, args, extra = {}) => invokeValue(host, `${plugin}#${tool}`, args, { signal, ...extra });
  const capability = id => declaration.capabilities.find(cap => cap.id === id && cap.consumers?.includes('host'));
  let declaration;
  try {
    signal?.throwIfAborted();
    declaration = host.plugins.read(plugin, { part: 'manifest' });
    check(canonical({ id: declaration.id, version: declaration.version, digest: declaration.revision }) === canonical(state.descriptor), 'NATIVE_CHANGED', 'Restore the frozen native plugin version; the optional validation is unavailable for this run');
    check(factorSelectionDigest, 'NATIVE_PHASE', 'Factor selection must already be frozen');
    await host.plugins.setEnabled(plugin, true, { scope: 'session' });
    const backtestTool = `${plan.engine}_backtest`, operationTool = plan.engine === 'mt5' ? 'mt5_backtest_operation' : `${plan.engine}_operation`;
    check(capability(backtestTool) && capability(operationTool), 'NATIVE_UNAVAILABLE', 'A declared backtest and read-only operation reconciler are required');
    await save({ status: 'running', factorSelectionDigest, startedAt: state.startedAt ?? now() });
    if (!state.environment || plan.engine === 'mt5') {
      if (plan.engine === 'mt5') {
        check(capability('mt5_catalog'), 'NATIVE_UNAVAILABLE', 'MT5 native methods must be discovered from its actual catalog');
        const catalog = await call('mt5_catalog', { server: 'tester' });
        const tools = (catalog.items ?? []).flatMap(item => item.tools ?? []);
        await save({ environment: { checkedAt: catalog.checked_at ?? now(), nativeOptimizer: tools.filter(t => t.name === 'tester_run_optimization' && t.callable).map(t => ({ name: t.name, inputSchema: t.inputSchema, agentTool: t.agent_tool })), status: (catalog.items ?? []).map(item => ({ server: item.server, status: item.status, reason: item.reason ?? null })) } });
      } else {
        check(capability(`${plan.engine}_environment`), 'NATIVE_UNAVAILABLE', 'A declared native environment inspector is required');
        const environment = await call(`${plan.engine}_environment`, { action: 'inspect', ...(plan.environment?.pythonPath ? { python_path: plan.environment.pythonPath } : {}) });
        await save({ environment: { ready: environment.ready, library: environment.library ?? null, version: environment.version ?? null, required: environment.required ?? null, failures: (environment.failures ?? []).map(item => ({ code: item.code })) } });
        check(environment.ready, 'NATIVE_UNAVAILABLE', environment.required ?? 'An existing configured native engine is required; workflow does not download dependencies');
      }
    }
    check(state.environment.ready !== false, 'NATIVE_UNAVAILABLE', 'The frozen native environment was unavailable');
    if (plan.search.mode === 'auto') check(plan.engine === 'backtrader' && capability('backtrader_optimize') || plan.engine === 'mt5' && plan.search.nativeOptimizer && capability('mt5_test') && capability('mt5_command') && state.environment.nativeOptimizer?.length, 'NATIVE_OPTIMIZER_UNAVAILABLE', plan.engine === 'mt5' && state.environment.nativeOptimizer?.length
      ? 'Catalog exposes a native optimizer; supply nativeOptimizer with that exact inputSchema, actual arguments and explicit window/configuration binding. The managed MT5 grid is not a native optimizer.'
      : 'This installed adapter has no declared native optimizer. Provide explicit hypothesis groups or retain fixed parameters; no replacement optimizer is invented.');
    let sourcePath;
    if (plan.engine !== 'mt5') {
      check(digest(state.source) === state.sourceDigest, 'NATIVE_SOURCE_CHANGED', 'Frozen strategy source changed');
      const root = await realpath(host.context.workspaceRoot), directory = join(root, `.factor-native-${runId}`);
      await mkdir(directory, { recursive: true });
      check((await realpath(directory)).startsWith(root + sep), 'NATIVE_SOURCE_CHANGED', 'Native scratch directory escaped the workflow workspace');
      sourcePath = join(directory, 'strategy.py');
      try { check(!(await lstat(sourcePath)).isSymbolicLink(), 'NATIVE_SOURCE_CHANGED', 'Native source cannot be a symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(sourcePath, state.source, { mode: 0o600 });
    }

    const settleMT5 = async (key, value) => {
      if (!value?.id || !active(value.status)) return value;
      const end = now() + (plan.timeout ?? 120) * 1000;
      let current = value;
      try {
        while (active(current.status) && now() < end) {
          signal?.throwIfAborted(); current = await call('mt5_backtest', { action: 'wait', backtest_id: value.id });
          await saveAttempt(key, { nativeJobId: value.id, lastReceipt: current });
        }
        if (active(current.status)) {
          const stop = await call('mt5_backtest', { action: 'stop', backtest_id: value.id });
          await saveAttempt(key, { stopReceipt: stop });
          return { ...stop, status: 'unknown', reason: 'Native job exceeded the bounded wait; stop requested, outcome not confirmed.' };
        }
        return current;
      } catch (error) {
        if (signal?.aborted) {
          try { const stop = await invokeValue(host, `${plugin}#mt5_backtest`, { action: 'stop', backtest_id: value.id }); await saveAttempt(key, { stopReceipt: stop }); } catch { /* Host revocation or its lifecycle cleanup may own the cancellation. */ }
        }
        throw error;
      }
    };
    const operation = async (key, tool, args) => {
      const operationId = `factor_${digest([runId, state.planDigest, key]).slice(7, 55)}`;
      let prior = state.attempts.find(a => a.key === key), value;
      if (prior?.result && prior.result.status !== 'unknown' && !active(prior.result.status)) return prior.result;
      if (prior) {
        // Read the original adapter receipt even after a host restart or a gap
        // between native dispatch and the workflow's accepted-Run checkpoint.
        let receipt;
        try { receipt = await call(tool === 'mt5_test' ? 'mt5_command' : operationTool, plan.engine === 'mt5' ? { command_id: operationId } : { operation_id: operationId }); }
        catch (error) { if (['NOT_FOUND', 'not_found'].includes(error.code)) receipt = { status: 'not-found' }; else throw error; }
        await saveAttempt(key, { reconciledAt: now(), reconciliation: receipt });
        value = tool === 'mt5_test' ? receipt.status === 'not-found' ? undefined : receipt : receipt.result;
        if (!value) {
          const unknown = { status: 'unknown', operationId, reason: 'Original native operation has no confirmed result. It is not resent, including when its record is absent.' };
          await saveAttempt(key, { status: 'unknown', result: unknown }); return unknown;
        }
      } else {
        await save({ attempts: [...state.attempts, { key, tool, operationId, status: 'dispatching', inputDigest: digest(args), startedAt: now() }] });
        try {
          const accepted = await host.capabilities.invoke(`${plugin}#${tool}`, { ...args, ...(plan.engine === 'mt5' ? { command_id: operationId } : { operation_id: operationId }) }, { operationId, signal });
          if (accepted.type === 'result') value = accepted.value;
          else {
            await saveAttempt(key, { status: 'running', hostRun: accepted.run });
            const abort = () => { void Promise.resolve().then(() => host.runs.cancel(accepted.run, { reason: 'Native validation caller stopped' })).catch(() => {}); };
            signal?.addEventListener('abort', abort, { once: true });
            try {
              if (signal?.aborted) abort();
              for (;;) {
                const reply = await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000, signal });
                if (reply.reason === 'timeout') continue;
                check(reply.run.status === 'completed', 'NATIVE_OUTCOME_UNKNOWN', reply.run.error?.message ?? `Native host run ${reply.run.status}`);
                value = reply.run.output; break;
              }
            } finally { signal?.removeEventListener('abort', abort); }
          }
        } catch (error) {
          await saveAttempt(key, { status: 'unknown', error: err(error) }); signal?.throwIfAborted();
          // Reconcile even a failed dispatch before classifying it. The adapter
          // may have persisted a confirmed business failure before host teardown.
          try { const receipt = await call(tool === 'mt5_test' ? 'mt5_command' : operationTool, plan.engine === 'mt5' ? { command_id: operationId } : { operation_id: operationId }); await saveAttempt(key, { reconciliation: receipt }); value = tool === 'mt5_test' ? receipt : receipt.result; } catch { /* Retain the original owned attempt. */ }
          value ??= { status: 'unknown', operationId, error: err(error) };
        }
      }
      if (plan.engine === 'mt5' && tool !== 'mt5_test') value = await settleMT5(key, value);
      if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) value = { status: 'uninterpreted', operationId, nativeCommandId: value.id ?? null, reason: 'Native receipt exceeds the workflow 8 MiB budget; the original adapter operation is retained for direct reading. No selection is inferred.' };
      await saveAttempt(key, { status: value.status, result: value, completedAt: now() }); return value;
    };
    const input = (which, parameters) => {
      const window = plan[which];
      if (plan.engine === 'mt5') return { action: 'start', build_id: plan.strategy.buildId, config: { ...plan.config, from_date: window.start, to_date: window.end, parameters } };
      return { title: `${runId} native ${which}`, strategy_path: sourcePath, class_name: plan.strategy.className, data: window.data,
        config: { ...plan.config, ...(plan.engine === 'vnpy' ? { start: window.tradingStart ?? state.windows[which].first, end: state.windows[which].last } : {}) },
        parameters, ...(plan.columns ? { columns: plan.columns } : {}), ...(plan.timeout ? { timeout: plan.timeout } : {}) };
    };
    const summarize = (value, parameters, group) => {
      const mt5 = plan.engine === 'mt5', pass = mt5 ? value.passes?.[0] : value;
      return { ...(group ? { groupId: group.id, hypothesis: group.hypothesis } : {}), parameters,
        status: (mt5 ? pass?.status === 'succeeded' && value.status === 'succeeded' : value.status === 'completed') ? 'completed' : value.status,
        statistics: mt5 ? pass?.metrics ?? {} : value.statistics ?? {}, ...(value.ref ? { ref: value.ref } : {}), operationId: value.operationId ?? null };
    };
    if (!state.selection) {
      const parameters = plan.parameters ?? {}; let passes;
      if (plan.search.mode === 'auto') {
        let result;
        if (plan.engine === 'mt5') {
          const binding = plan.search.nativeOptimizer, actual = state.environment.nativeOptimizer.find(item => item.agentTool === 'mt5_test' && digest(item.inputSchema) === state.mt5Optimizer.schemaDigest);
          check(actual && digest(binding.inputSchema) === state.mt5Optimizer.schemaDigest, 'NATIVE_CHANGED', 'MT5 optimizer schema differs from the frozen actual catalog; no guessed method or argument is dispatched');
          const args = await boundMT5Arguments(host, runId, plan, state.mt5Optimizer);
          const command = await operation('development-native-optimizer', 'mt5_test', { server: 'terminal', tool: 'tester_run_optimization', arguments: args });
          result = optimizerPasses(command, binding);
          await save({ development: { result }, windowVerification: state.mt5Optimizer.windowVerification });
          if (state.mt5Optimizer.windowVerification === 'unverified' || result.status === 'uninterpreted') return save({ status: 'unverified',
            reason: state.mt5Optimizer.windowVerification === 'unverified' ? 'Exact native optimizer was called under explicit prepared-configuration acknowledgement; its development window could not be verified. No parameter selection or holdout is run.' : result.reason,
            parameterSelection: { status: 'not-run' }, holdout: { status: 'not-run', reason: 'Native window and completed pass evidence must be verified before automatic selection/holdout' } });
        } else result = await operation('development-optimizer', 'backtrader_optimize', { ...input('development', parameters), parameter_space: plan.search.parameterSpace });
        passes = result.passes ?? [];
        // A failed/unknown search is retained but cannot silently narrow the
        // experiment universe to only the successful prefix.
        if (result.status !== 'completed') return save({ status: result.status === 'unknown' ? 'unknown' : 'failed', development: { result, passes }, reason: 'Native optimization did not complete the frozen search plan; no parameter selection or holdout was run.' });
      } else {
        const groups = plan.search.mode === 'groups' ? plan.search.groups : [{ id: 'fixed', hypothesis: 'Predeclared fixed parameters; no selection search', parameters: {} }];
        passes = [];
        for (const [index, group] of groups.entries()) {
          const values = { ...parameters, ...group.parameters }, result = await operation(`development-${index}`, backtestTool, input('development', values));
          passes.push(summarize(result, values, group)); await save({ development: { passes } });
          if (result.status === 'unknown' || active(result.status)) return save({ status: 'unknown', reason: 'An original native attempt is uncertain; no additional groups or holdout are dispatched.' });
        }
      }
      await save({ development: { ...state.development, passes } });
      let selected;
      if (plan.search.mode === 'none') { check(passes[0]?.status === 'completed', 'NATIVE_FAILED', 'The fixed development backtest failed'); selected = passes[0]; }
      else selected = chooseParameters(passes, plan.search.objective);
      const body = { parameters: selected.parameters, objective: plan.search.objective ?? null, tieBreak: 'first-in-frozen-input-order',
        developmentEvidenceDigest: digest(passes), factorSelectionDigest, planDigest: state.planDigest };
      await save({ selection: { ...body, digest: digest(body), frozenAt: now() } });
    }
    if (plan.engine === 'mt5' && plan.search.nativeOptimizer && plan.holdout && !state.mt5Optimizer.buildIdentityVerified) return save({ status: 'partial', holdout: { status: 'not-run', reason: 'Native optimizer strategy identity is not bound to the frozen managed build; do not silently validate a different EA' } });
    if (plan.holdout && (!state.holdout || state.holdout.status === 'unknown')) {
      const result = await operation('holdout-fixed', backtestTool, input('holdout', state.selection.parameters));
      await save({ holdout: { ...summarize(result, state.selection.parameters), result, selectionDigest: state.selection.digest } });
    }
    return save({ status: state.holdout && state.holdout.status !== 'completed' ? state.holdout.status === 'unknown' ? 'unknown' : 'failed' : 'completed', completedAt: now(),
      interpretation: 'These are measured native development/holdout outcomes for the frozen plan, not predicted probabilities or a requirement that every diagnostic pass. Applicability and counterexamples remain in the factor selection.' });
  } catch (error) {
    signal?.throwIfAborted();
    return save({ status: ['NATIVE_UNAVAILABLE', 'NATIVE_CHANGED', 'NATIVE_OPTIMIZER_UNAVAILABLE'].includes(error.code) ? 'unavailable' : 'failed', error: err(error), reason: error.message });
  }
}
