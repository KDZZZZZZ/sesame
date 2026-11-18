import { artifactRef, canonical } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { SVL_SEMANTICS, validateSource } from '@sesame/plugin-sdk/svl';

const author = name => 'sesame/strategy-authoring#' + name;
const mining = name => 'sesame/auto-factor-mining#' + name;
const present = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pin = value => { try { artifactRef(value); return true; } catch { return false; } };
const gap = (code, component, missing, impact, next, capability) =>
  ({ code, component, missing, impact, next, ...(capability ? { capability } : {}) });
const settingError = (component, message) => Object.assign(new Error(message), { component });

const slots = {
  universe: { input: 'MarketSnapshot', output: 'Universe', capability: author('strategy_workflow'),
    models: { manual: ['instruments'], ranked: ['candidateSnapshotRef'] } },
  alpha: { input: 'Universe+Observations', output: 'Signal', capability: author('strategy_validate'),
    models: { close_threshold: ['marketDataRef'], moving_average: ['marketDataRef'], long_breakout: ['marketDataRef'], factor_signal: [] } },
  portfolio: { input: 'Universe+Signal', output: 'PortfolioTarget', capability: author('strategy_workflow'),
    models: { equal: [], confidence: ['confidenceRef'], inverse_volatility: ['volatilityRef'] } },
  risk: { input: 'PortfolioTarget+Policy', output: 'RiskDecision', capability: author('strategy_pipeline'),
    models: { mandate_limits: ['riskPolicyRef'] } },
  execution: { input: 'RiskDecision+AccountSnapshot', output: 'ExecutionPlan', capability: author('strategy_workflow'),
    models: { order_lifecycle: ['targetProfileRef', 'costModelRef'] } },
  stateMachine: { input: 'MarketEvent+State', output: 'RuleState', capability: author('strategy_replay'),
    models: { long_flat: ['marketDataRef'] } },
};
const framework = { universe: 'ranked', alpha: 'close_threshold', portfolio: 'equal', risk: 'mandate_limits', execution: 'order_lifecycle' };
const presets = {
  framework,
  state_machine: { universe: 'manual', stateMachine: 'long_flat', risk: 'mandate_limits', execution: 'order_lifecycle' },
  hybrid: { ...framework, stateMachine: 'long_flat' },
};
const bindingActions = {
  instruments: 'Bind the mandate’s instrument identities as {sourceId,instrumentId}.',
  marketDataRef: 'Freeze the closed-bar input and its observation and availability conventions.',
  candidateSnapshotRef: 'Freeze the point-in-time selection universe, fields and availability timestamps.',
  confidenceRef: 'Bind development evidence for comparable signal confidences, or select equal weighting.',
  volatilityRef: 'Bind point-in-time volatility estimates with their common window, or select equal weighting.',
  riskPolicyRef: 'Freeze the mandate’s hard limits, units and breach response.',
  targetProfileRef: 'Inspect the target backend and pin its supported order and position semantics.',
  costModelRef: 'Pin the fees, spread and slippage model for the selected target.',
};
const purposes = ['alpha', 'entry_filter', 'regime', 'sizing', 'exit', 'risk'];
const barSettings = ['timeframe', 'priceBasis', 'adjustment', 'session'];
const portfolioSettings = ['signalAggregation', 'inactiveSignalPolicy', 'removedInstrumentPolicy'];
const settingsFor = {
  ranked: ['topN', 'rank', 'filter', 'maxDataAgeMs'], close_threshold: [...barSettings, 'threshold'],
  moving_average: [...barSettings, 'fastPeriod', 'slowPeriod'], long_breakout: [...barSettings, 'lookback'], factor_signal: ['factorId'],
  equal: portfolioSettings, confidence: portfolioSettings, inverse_volatility: portfolioSettings,
  long_flat: [...barSettings, 'entryLevel', 'exitLevel'],
};
const capabilitiesBySlot = Object.fromEntries(Object.entries(slots).map(([name, { input, output, models, capability }]) =>
  [name, { input, output, models: [...Object.keys(models), 'custom'], capability }]));

function validBinding(key, value) {
  if (key === 'instruments') return Array.isArray(value) && value.length > 0
    && value.every(item => record(item) && present(item.sourceId) && present(item.instrumentId));
  if (key === 'targetProfileRef') return pin(value) && value.kind === 'strategy.target';
  return pin(value);
}

function factorEvidence(use, index) {
  if (!record(use)) throw new Error('Each factor use must be an object');
  const component = 'factors[' + index + ']';
  const feedback = (status, field, impact, next, capability) => ({
    status, gap: gap('factor_' + status, component, field, impact, next, capability),
  });
  if (!present(use.factorId)) return use.librarySearched === true
    ? feedback('search', 'factorId', 'The library returned no matching definition.', 'Search for a definition matching this use, or implement the rule directly.', mining('factor_search'))
    : feedback('lookup', 'factorId', 'The required factor has not been identified.', 'Query existing definitions before opening a factor search.', mining('factor_library'));
  if (!/^sha256:[a-f0-9]{64}$/.test(use.definitionDigest ?? '')) return feedback('lookup', 'definitionDigest',
    'The mathematical definition is not pinned.', 'Read the stored factor by ID and record its exact definition digest.', mining('factor_library'));
  if (!present(use.evaluationId) || use.sourcePartition !== 'development') return feedback('evaluate', 'development evaluationId',
    'The development evidence for this use is missing.', 'Read matching evaluations, then evaluate this fixed definition on development data if needed.', mining('factor_evaluate'));
  return { status: 'verify' };
}

/** Check how the strategy consumes a factor independently of its research evaluation. */
export function factorIntegrationGap(use, index) {
  const component = 'factors[' + index + ']';
  const missing = (field, impact, next) => gap('factor_binding_gap', component, field, impact, next);
  if (!purposes.includes(use?.purpose)) return gap('factor_design', component, 'purpose', 'The factor has no role in this strategy.',
    'Choose alpha, entry_filter, regime, sizing, exit or risk.');
  const c = use.consumption, impl = use.implementation;
  if (!record(c) || !Array.isArray(c.inputFields) || !c.inputFields.length || !c.inputFields.every(present)
    || ![c.decisionTime, c.transform, c.missingPolicy].every(present)) return missing('consumption',
    'A value has no defined decision rule or missing-data behavior.', 'Specify inputFields, decisionTime, transform and missingPolicy.');
  if (!record(impl) || !['svl_function', 'external_feed'].includes(impl.mode) || !pin(impl.ref) || !pin(impl.validationRef))
    return missing('implementation', 'Research values cannot yet be reproduced at decision time.',
      'Bind the tested SVL function or external feed and its numerical and timing comparison evidence.');
  if (impl.mode === 'external_feed' && (!present(c.observedAtField) || !present(c.availableAtField) || !present(c.revisionPolicy)))
    return missing('availability', 'Revisions or delayed observations could enter the strategy too early.',
      'Map observation and first-available timestamps and declare the revision policy.');
  if (c.timingSamples !== undefined) {
    const invalid = !Array.isArray(c.timingSamples) || c.timingSamples.some(sample => !record(sample) || ![sample.observedAt, sample.availableAt, sample.decisionAt].every(Number.isSafeInteger)
      || sample.observedAt > sample.availableAt || sample.availableAt > sample.decisionAt);
    if (invalid) return missing('timingSamples', 'An observation is unavailable at the proposed decision.',
      'Lag or rebuild the feature timeline and compare the corrected values with the pinned definition.');
  }
  return null;
}

function resolveFactor(use, index, evidence = factorEvidence(use, index)) {
  const integrationGap = factorIntegrationGap(use, index);
  const result = { ...evidence };
  for (const key of ['factorId', 'purpose', 'evaluationId']) if (present(use[key])) result[key] = use[key];
  if (integrationGap) {
    result.integrationGap = integrationGap;
    if (!evidence.gap) {
      result.status = integrationGap.code === 'factor_design' ? 'design' : 'binding_gap';
      result.gap = integrationGap;
    }
  }
  return result;
}

function factorGaps(resolutions) {
  return resolutions.flatMap(({ gap, integrationGap }) => {
    if (gap && integrationGap && gap.code !== integrationGap.code) return [gap, integrationGap];
    return gap ? [gap] : [];
  });
}

async function readFactorEvidence(host, use, signal, pages) {
  const capability = mining('factor_library');
  let cursor;
  const seen = new Set();
  do {
    signal?.throwIfAborted();
    const key = canonical([use.factorId, cursor ?? null]);
    if (!pages.has(key)) {
      const result = await host.capabilities.invoke(capability, { action: 'read', factorId: use.factorId, limit: 100, ...(cursor ? { cursor } : {}) }, { signal });
      if (result?.type !== 'result' || !Array.isArray(result.value?.evaluations?.items)) throw new Error('Factor library returned an invalid read result');
      pages.set(key, result.value);
    }
    const { factor, evaluations } = pages.get(key);
    if (factor?.id !== use.factorId || factor.definitionDigest !== use.definitionDigest)
      return ['definitionDigest', 'The stored mathematical definition differs from the requested factor.', capability];
    const evaluation = evaluations.items.find(item => item.id === use.evaluationId);
    if (evaluation) {
      if (evaluation.partition !== 'development' || evaluation.eligibility !== 'supported')
        return ['evaluationId', 'The stored evaluation is outside development or lacks supported evidence.', mining('factor_evaluate')];
      if ((use.profileId && use.profileId !== evaluation.profile?.id) || (use.snapshotId && use.snapshotId !== evaluation.context?.snapshotId))
        return ['evaluationId', 'The stored evaluation does not match the requested profile or data snapshot.', mining('factor_evaluate')];
      return null;
    }
    cursor = evaluations.cursor;
    if (cursor && (!present(cursor) || seen.has(cursor))) throw new Error('Factor library evaluation cursor did not advance');
    seen.add(cursor);
  } while (cursor);
  return ['evaluationId', 'The requested evaluation does not exist for this factor.', capability];
}

export async function verifyFactorUses(host, structure, signal) {
  if (!structure.factors.length) return structure;
  const resolutions = [], pages = new Map();
  for (const [index, use] of structure.factors.entries()) {
    let evidence = factorEvidence(use, index);
    if (evidence.status === 'verify') {
      let issue;
      try { issue = await readFactorEvidence(host, use, signal, pages); }
      catch (error) {
        signal?.throwIfAborted();
        issue = ['factor_library', error.message, mining('factor_library')];
      }
      if (issue) {
        const [missing, impact, capability] = issue;
        evidence = { status: 'evidence_gap', gap: gap('factor_evidence_gap', 'factors[' + index + ']', missing, impact,
          'Read the matching stored definition and supported development evaluation, or evaluate it for this use.', capability) };
      } else evidence = { status: 'reuse', verification: 'factor_library_development_evaluation' };
    }
    resolutions.push(resolveFactor(use, index, evidence));
  }
  const gaps = structure.gaps.filter(item => !item.code.startsWith('factor_')).concat(factorGaps(resolutions));
  return { ...structure, factorResolutions: resolutions, gaps, status: gaps.length ? 'needs_inputs' : 'designed' };
}

function componentGaps(slot, selected, bindings, available) {
  const descriptor = slots[slot];
  if (!selected) return [gap('missing_component', slot, slot, 'This stage has no implementation.',
    'Select one of the available models (' + Object.keys(descriptor.models).join(', ') + ') or bind a custom model.')];
  const { model, settings } = selected;
  if (!Object.hasOwn(descriptor.models, model) && model !== 'custom') return [gap('unsupported_model', slot, model,
    'The selected model cannot produce ' + descriptor.output + '.', 'Choose a listed model or bind a custom implementation.')];
  if (model === 'custom' && (!pin(settings.sourceRef) || !present(settings.capability)
    || settings.inputContract !== descriptor.input || settings.outputContract !== descriptor.output))
    return [gap('interface_mismatch', slot, 'custom model contract', 'The adjacent stages cannot consume this implementation.',
      'Pin sourceRef and capability and declare inputContract ' + descriptor.input + ' and outputContract ' + descriptor.output + '.')];
  const capability = model === 'custom' ? settings.capability : descriptor.capability;
  const gaps = [];
  if (model !== 'custom') for (const key of Object.keys(settings)) {
    if (!(settingsFor[model] ?? []).includes(key)) gaps.push(gap('unsupported_setting', slot, key,
      'This model does not implement the supplied setting.', 'Use a declared model setting or a custom implementation.'));
  }
  if (available && !available.includes(capability)) gaps.push(gap('missing_capability', slot, capability,
    'The selected model cannot be invoked on this host.', 'Discover or enable the capability, or replace this component.', capability));
  for (const key of descriptor.models[model] ?? []) {
    if (!validBinding(key, bindings[key])) gaps.push(gap('missing_input', slot, key, 'Missing input for ' + model + '.', bindingActions[key]));
  }
  return gaps;
}

// The editable source owns signal/state semantics. Target sizes, risk decisions and order
// management remain delegated to their selected modules and require separate evidence.
function starter(strategyId, mode, components, factor) {
  const alpha = components.alpha, machine = components.stateMachine;
  if (mode !== 'state_machine' && !['close_threshold', 'moving_average', 'long_breakout', 'factor_signal'].includes(alpha?.model)) return null;
  if (mode !== 'framework' && machine?.model !== 'long_flat') return null;
  const external = alpha?.model === 'factor_signal';
  const breakout = alpha?.model === 'long_breakout';
  if (external && !factor) return null;
  const settings = { ...machine?.settings, ...alpha?.settings };
  for (const key of barSettings) if (machine?.settings[key] !== undefined && alpha?.settings[key] !== undefined && machine.settings[key] !== alpha.settings[key])
    throw settingError('stateMachine', 'Hybrid starter needs the same ' + key + ' for both closed-bar models; use a custom source for multiple clocks');
  const bars = { kind: 'bars', instrument: { parameter: 'instrument' }, timeframe: settings.timeframe ?? '1d', barPolicy: 'closed',
    priceBasis: settings.priceBasis ?? 'last', adjustment: settings.adjustment ?? 'none', session: settings.session ?? 'regular', lookback: 1 };
  const marketClock = !external || Boolean(machine);
  const source = { language: 'svl/1', schemaVersion: external || breakout ? '1.1.0' : '1.0.0', strategyId, semantics: structuredClone(SVL_SEMANTICS),
    parameters: marketClock ? { instrument: { type: 'instrument' } } : {}, inputs: marketClock ? { bars } : {},
    state: {}, nodes: [], handlers: [], functions: [], extensions: [] };
  const steps = [];
  const series = { input: 'bars', field: 'close' };
  const add = (id, op, inputs) => { source.nodes.push({ id, op, inputs: structuredClone(inputs) }); return { node: id }; };
  const price = alpha?.model === 'close_threshold' || breakout || machine ? add('close', 'series.value', { series, offset: 0 }) : null;
  const parameter = (name, spec) => { source.parameters[name] = spec; return { parameter: name }; };
  const decimal = (name, value) => parameter(name, { type: 'decimal', ...(value === undefined ? {} : { default: value }) });
  function stateActions(key) {
    source.state[key] = { type: { kind: 'boolean' }, initial: false };
    return [true, false].map(value => add(key + (value ? '-on' : '-off'), 'state.set', { stateId: key, value }).node);
  }
  if (external) {
    const { consumption, implementation } = factor;
    source.inputs.factor = { kind: 'external', schema: structuredClone(implementation.schemaRef), availabilityPolicy: structuredClone(implementation.availabilityPolicyRef) };
    source.state.positiveSignal = { type: { kind: 'boolean' }, initial: false };
    const field = name => ({ input: 'factor', field: name });
    const compareTime = (id, a, b) => add(id, 'time.compare', { left: field(a), right: field(b) });
    const observed = compareTime('observation-order', consumption.observedAtField, consumption.availableAtField);
    const released = compareTime('availability-order', consumption.availableAtField, consumption.decisionAtField);
    const observationKnown = add('observed-before-release', 'compare.lte', { left: observed, right: 0 });
    const releaseKnown = add('released-by-decision', 'compare.lte', { left: released, right: 0 });
    add('usable-factor', 'logic.all', { values: [observationKnown, releaseKnown] });
    add('accept-factor', 'state.set', { stateId: 'positiveSignal', value: field(implementation.signalField) });
    source.handlers.push({ id: 'on-factor', event: { type: 'external.input', input: 'factor' },
      steps: [{ id: 'accept-timely-signal', when: 'usable-factor', actions: ['accept-factor'] }] });
  } else if (alpha) {
    let left = price, right;
    if (alpha.model === 'moving_average') {
      const fast = settings.fastPeriod ?? 5, slow = settings.slowPeriod ?? 20;
      if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 1 || fast >= slow || slow > 500)
        throw new Error('moving_average requires integer periods 1 <= fastPeriod < slowPeriod <= 500');
      // The replay can override defaults anywhere within the declared period ranges.
      bars.lookback = 500;
      const fastSeries = add('fast-average', 'series.sma', { series, period: parameter('fastPeriod', { type: 'integer', default: fast, min: 1, max: 499 }) });
      const slowSeries = add('slow-average', 'series.sma', { series, period: parameter('slowPeriod', { type: 'integer', default: slow, min: 2, max: 500 }) });
      left = add('latest-fast', 'series.value', { series: fastSeries, offset: 0 });
      right = add('latest-slow', 'series.value', { series: slowSeries, offset: 0 });
    } else if (breakout) {
      const { lookback = 20 } = settings;
      if (!Number.isInteger(lookback) || lookback < 1 || lookback > 500) throw settingError('alpha', 'long_breakout requires integer lookback between 1 and 500');
      bars.lookback = 501;
      const count = parameter('lookback', { type: 'integer', default: lookback, min: 1, max: 500 });
      const highs = add('previous-highs', 'series.window', { series: { input: 'bars', field: 'high' }, count, offset: 1 });
      const ready = add('breakout-inputs-ready', 'value.isReady', { value: { record: { close: price, highs } } });
      source.state.signalReady = { type: { kind: 'boolean' }, initial: false };
      const writeReady = add('set-signal-ready', 'state.set', { stateId: 'signalReady', value: ready });
      steps.push({ id: 'check-breakout-history', actions: [writeReady.node] });
      right = add('previous-high', 'math.max', { values: highs });
    } else right = decimal('threshold', settings.threshold);
    const positive = add('positive', 'compare.gt', { left, right });
    const trigger = breakout ? add('confirmed-breakout', 'logic.all', { values: [{ state: 'signalReady' }, positive] }) : positive;
    const [on, off] = stateActions('positiveSignal');
    steps.push({ id: 'update-signal', when: trigger.node, actions: [on], elseActions: [off] });
  }
  if (machine) {
    const { entryLevel, exitLevel } = machine.settings;
    try {
      if (entryLevel !== undefined) Decimal.normalize(entryLevel);
      if (exitLevel !== undefined) Decimal.normalize(exitLevel);
      if (entryLevel !== undefined && exitLevel !== undefined && Decimal.compare(entryLevel, exitLevel) <= 0) throw new Error('long_flat requires entryLevel above exitLevel');
    } catch (error) { throw settingError('stateMachine', error.message); }
    const on = decimal('entryLevel', machine.settings.entryLevel), off = decimal('exitLevel', machine.settings.exitLevel);
    const validBand = add('valid-band', 'compare.gt', { left: on, right: off });
    const enter = add('above-entry', 'compare.gt', { left: price, right: on });
    const leave = add('below-exit', 'compare.lt', { left: price, right: off });
    add('enter-regime', 'logic.all', { values: [validBand, enter] });
    add('exit-regime', 'logic.all', { values: [validBand, leave] });
    const [long, flat] = stateActions('longRegime');
    steps.push({ id: 'enter', when: 'enter-regime', actions: [long] }, { id: 'exit', when: 'exit-regime', actions: [flat] });
  }
  if (marketClock) source.handlers.push({ id: 'on-closed-bar', event: { type: 'bar.closed', input: 'bars' }, steps });
  if (alpha && machine) {
    add('hybrid-eligible', 'logic.all', { values: [{ state: 'positiveSignal' }, { state: 'longRegime' }] });
    const [on, off] = stateActions('eligible');
    for (const handler of source.handlers) handler.steps.push({ id: 'combine-' + handler.id, when: 'hybrid-eligible', actions: [on], elseActions: [off] });
  }
  validateSource(source);
  return source;
}

function methodFixture(mode, selected, bindings) {
  const input = bindings.workflowFixture;
  if (!input || mode === 'state_machine' || Object.entries(selected).some(([slot, value]) => !value || !Object.hasOwn(slots[slot].models, value.model))) return null;
  if (input.schemaVersion !== '1.1.0' || !record(input.universe) || !record(input.portfolio)) throw new Error('workflowFixture must be a strategy_workflow 1.1 fixture');
  const fixture = structuredClone(input);
  fixture.portfolio.method = selected.portfolio.model;
  for (const key of portfolioSettings) if (Object.hasOwn(selected.portfolio.settings, key)) fixture.portfolio[key] = structuredClone(selected.portfolio.settings[key]);
  if (selected.universe.model === 'ranked') for (const key of settingsFor.ranked) {
    if (Object.hasOwn(selected.universe.settings, key)) fixture.universe[key] = structuredClone(selected.universe.settings[key]);
  }
  if (selected.universe.model === 'manual') {
    if (!validBinding('instruments', bindings.instruments) || !Array.isArray(fixture.universe.candidates)) return null;
    const key = instrument => JSON.stringify([instrument.sourceId, instrument.instrumentId]);
    const ordered = new Map(bindings.instruments.map((instrument, index) => [key(instrument), index]));
    fixture.universe.candidates = fixture.universe.candidates.filter(row => ordered.has(key(row.instrument)));
    for (const row of fixture.universe.candidates) row.fields.manualOrder = String(ordered.get(key(row.instrument)));
    delete fixture.universe.filter;
    fixture.universe.rank = [{ field: 'manualOrder', type: 'decimal', order: 'asc', missing: 'exclude' }];
    fixture.universe.topN = ordered.size;
  }
  return fixture;
}

function factorSource(alpha, factors, resolutions, gaps) {
  if (alpha?.model !== 'factor_signal') return;
  const matches = factors.filter(use => use.purpose === 'alpha' && (!alpha.settings.factorId || alpha.settings.factorId === use.factorId));
  if (matches.length !== 1) {
    gaps.push(gap('missing_input', 'alpha', 'factor use', 'This signal needs one identified alpha factor.',
      'Choose an existing factorId, or provide a custom source for a combined forecast.', mining('factor_library')));
    return;
  }
  const use = matches[0], impl = use.implementation;
  if (resolutions[factors.indexOf(use)].integrationGap) return;
  if (impl.mode !== 'external_feed') {
    gaps.push(gap('source_binding', 'alpha', 'SVL function integration', 'The factor function still needs a call site in the selected strategy.',
      'Read the pinned implementation, wire its input/output into an authored SVL source and publish that source.', author('strategy_publish')));
    return;
  }
  if (!pin(impl.schemaRef) || !pin(impl.availabilityPolicyRef) || !present(impl.signalField) || !present(use.consumption.decisionAtField)) {
    gaps.push(gap('source_binding', 'alpha', 'external signal schema', 'The adapter must expose a decision-ready boolean and the decision clock.',
      'Supply schemaRef, availabilityPolicyRef, signalField and consumption.decisionAtField, or author a custom transformation.'));
    return;
  }
  return use;
}

/** Resolve bindings against the supplied capability inventory. An omitted inventory is unknown. */
export function buildStructure({ strategyId = 'research.strategy', mode = 'framework', components = {}, factors = [], bindings = {}, availableCapabilities } = {}) {
  if (!Object.hasOwn(presets, mode)) throw new Error('Choose framework, state_machine or hybrid');
  if (!present(strategyId) || !record(components) || !record(bindings) || !Array.isArray(factors)
    || (availableCapabilities !== undefined && (!Array.isArray(availableCapabilities) || !availableCapabilities.every(present))))
    throw new Error('Invalid strategy structure inputs');
  for (const slot of Object.keys(components)) if (!Object.hasOwn(presets[mode], slot)) throw new Error('Unknown component for ' + mode + ': ' + slot);
  const selected = {}, gaps = [];
  for (const [slot, fallback] of Object.entries(presets[mode])) {
    const supplied = Object.hasOwn(components, slot) ? components[slot] : fallback;
    const value = typeof supplied === 'string' ? { model: supplied } : supplied;
    if (value !== null && (!record(value) || !present(value.model) || (value.settings !== undefined && !record(value.settings))))
      throw new Error('Invalid model for ' + slot);
    selected[slot] = value && { model: value.model, settings: structuredClone(value.settings ?? {}) };
    gaps.push(...componentGaps(slot, selected[slot], bindings, availableCapabilities));
  }
  const factorResolutions = factors.map((use, index) => resolveFactor(use, index));
  gaps.push(...factorGaps(factorResolutions));
  const factor = factorSource(selected.alpha, factors, factorResolutions, gaps);
  let starterSource = null;
  try { starterSource = starter(strategyId, mode, selected, factor); } catch (error) {
    gaps.push(gap('source_settings', error.component ?? (mode === 'state_machine' ? 'stateMachine' : 'alpha'), 'settings', error.message, 'Correct the model settings and rebuild the source.', author('strategy_validate')));
  }
  let workflowFixture = null;
  try { workflowFixture = methodFixture(mode, selected, bindings); } catch (error) {
    gaps.push(gap('workflow_fixture', 'portfolio', 'workflowFixture', error.message, 'Supply the complete fixed-input method fixture.', author('strategy_workflow')));
  }
  return { strategyId, mode, components: selected, factors: structuredClone(factors), bindings: structuredClone(bindings),
    ...(availableCapabilities ? { availableCapabilities: [...availableCapabilities] } : {}),
    interfaces: Object.fromEntries(Object.keys(selected).map(slot => [slot, structuredClone(capabilitiesBySlot[slot])])),
    status: gaps.length ? 'needs_inputs' : factorResolutions.some(item => item.status === 'verify') ? 'needs_verification' : 'designed', gaps, factorResolutions, starterSource, workflowFixture,
    sourceScope: starterSource ? 'svl_signal_and_rule_state' : null };
}

export function replaceComponent(structure, slot, replacement) {
  if (!Object.hasOwn(structure.components, slot)) throw new Error('Unknown active component: ' + slot);
  const next = buildStructure({ ...structure, components: { ...structure.components, [slot]: replacement } });
  const order = Object.keys(presets[next.mode]);
  // A hybrid state rule also feeds sizing/risk. Its position in the display order is independent.
  const downstream = slot === 'stateMachine' ? ['stateMachine', ...(next.mode === 'hybrid' ? ['portfolio'] : []), 'risk', 'execution']
    : order.slice(order.indexOf(slot)).filter(name => name !== 'stateMachine' || slot === 'universe');
  return { ...next, invalidated: canonical(next.components[slot]) === canonical(structure.components[slot]) ? [] : downstream };
}
