// Research terms are merged at field level so a new cost estimate cannot replace
// the user's risk budget or the unaffected side of the cost model.
const text = { type: 'string', minLength: 1, maxLength: 2000 };
const strings = { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: text };
const ratio = { type: 'number', minimum: 0, description: 'Maximum exposure as a multiple of equity. Net exposure uses its absolute magnitude.' };
const decimal = { anyOf: [{ type: 'number', minimum: 0 }, { type: 'string', maxLength: 80, pattern: '^(0|[1-9][0-9]*)([.][0-9]+)?$' }] };
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const metrics = ['netReturn', 'finalEquity', 'maxDrawdown', 'closedTrades'];
const fieldSchema = object({
  goal: text, objective: object({ metric: { enum: metrics }, direction: { enum: ['maximize', 'minimize'] } }, ['metric', 'direction']),
  benchmark: text, hypothesis: text, instruments: strings, excludedInstruments: strings, sessions: strings,
  directions: { ...strings, maxItems: 2, items: { enum: ['long', 'short'] } },
  capital: object({ amount: decimal, currency: { type: 'string', pattern: '^[A-Z]{3}$' } }),
  horizon: text, frequency: text, target: text, costs: object({ commission: decimal, slippage: decimal, model: text }),
  maxDrawdown: { ...ratio, maximum: 1, description: 'Maximum peak-to-trough drawdown as a positive fraction; 0.10 = 10%.' },
  maxGrossExposure: ratio, maxNetExposure: ratio, maxPositionExposure: ratio, leverage: ratio,
  reviewConditions: strings, haltConditions: strings,
});
const grouped = new Set(['capital', 'costs']);
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const nullableFields = schema => object(Object.fromEntries(Object.entries(schema.properties)
  .map(([name, value]) => [name, nullable(grouped.has(name) ? nullableFields(value) : value)])));
const sourceRank = { assumption: 0, research: 1, project: 2, user: 3 };
export const mandateInputSchema = object({
  brief: { ...text, maxLength: 12000, description: 'Current user wording or objective. Supply existing facts through context.' },
  context: { type: 'array', maxItems: 64, items: object({
    source: { enum: Object.keys(sourceRank) }, evidence: { ...text, description: 'User quote, project revision, dataset/fee schedule or reason for a research assumption.' },
    fields: nullableFields(fieldSchema), amend: { type: 'boolean', description: 'An explicit user amendment superseding earlier terms for these fields. Null leaves a term unspecified.' },
  }, ['source', 'evidence', 'fields']) },
  assumptions: { ...strings, minItems: 0, description: 'Additional research assumptions to test.' },
});

const leafSchemas = Object.fromEntries(Object.entries(fieldSchema.properties).flatMap(([key, schema]) =>
  grouped.has(key) ? Object.entries(schema.properties).map(([leaf, leafSchema]) => [`${key}.${leaf}`, leafSchema]) : [[key, schema]]));
const coverageChecks = ['instruments', 'excludedInstruments', 'directions', 'sessions', 'maxGrossExposure', 'maxNetExposure', 'maxPositionExposure', 'leverage'];
const decisionFields = new Set([...coverageChecks, 'maxDrawdown', 'objective', 'capital.amount', 'capital.currency', 'costs.commission', 'costs.slippage', 'target', 'horizon']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'INVALID_MANDATE' });
}
function stringValue(value, max = 2000) {
  check(typeof value === 'string' && value.trim() && value.length <= max, 'Expected nonempty bounded mandate text.');
  return value.trim();
}
const fieldAt = (fields, key) => key.split('.').reduce((node, part) => node?.[part], fields);
function setField(fields, key, value) {
  const [group, leaf] = key.split('.');
  if (leaf) fields[group][leaf] = value;
  else fields[group] = value;
}
function decimalString(value) {
  check(typeof value === 'number' ? Number.isFinite(value) && value >= 0 : typeof value === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(value), 'Costs and capital require nonnegative decimal values.');
  const result = typeof value === 'number' ? value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 }) : value;
  check(result.length <= 80, 'Decimal value exceeds the supported mandate precision.');
  return result.includes('.') ? result.replace(/0+$/, '').replace(/\.$/, '') : result;
}
function rateFraction(raw, digits) {
  const [whole, decimal = ''] = raw.split('.');
  const padded = whole.padStart(digits + 1, '0');
  return decimalString(`${padded.slice(0, -digits).replace(/^0+(?=\d)/, '')}.${padded.slice(-digits)}${decimal}`);
}
function normalize(key, value) {
  const schema = leafSchemas[key];
  if (key === 'objective') {
    check(isObject(value) && Object.keys(value).length === 2 && metrics.includes(value.metric) && ['maximize', 'minimize'].includes(value.direction), 'Choose one supported objective metric and direction.');
    return { metric: value.metric, direction: value.direction };
  }
  if (schema === decimal) {
    const result = decimalString(value);
    check(key !== 'capital.amount' || Number(result) > 0, 'Research capital must be positive.');
    check(!key.startsWith('costs.') || Number(result) <= 1, 'Commission and slippage are fractions from zero to one.');
    return result;
  }
  if (schema.type === 'number') {
    check(typeof value === 'number' && Number.isFinite(value) && value >= 0 && (schema.maximum === undefined || value <= schema.maximum), `Invalid fraction or exposure multiple for ${key}.`);
    return value;
  }
  if (schema.type === 'array') {
    check(Array.isArray(value) && value.length && value.length <= schema.maxItems, `Expected a nonempty list for ${key}.`);
    const items = value.map(item => stringValue(item));
    check(new Set(items).size === items.length && (key !== 'directions' || items.every(item => ['long', 'short'].includes(item))), `Invalid or duplicate ${key}.`);
    return items.sort();
  }
  const result = stringValue(value);
  check(key !== 'capital.currency' || /^[A-Z]{3}$/.test(result), 'Currency must be an explicit three-letter currency code.');
  return result;
}

// Parse a small set of explicit unit-bearing facts. An Agent can pass other
// languages, dates, instruments or complex restrictions as attributed fields.
function briefContext(brief) {
  const rows = [];
  for (const raw of brief.split(/[。；;\n!?！？]/)) {
    const evidence = raw.trim();
    if (!evidence || /例如|举例|比如|假设|如果|假如|是否|待确认|或许|不要求|取消|撤销|不再|历史最大回撤|\b(?:for example|hypothetical|historical drawdown|maybe|remove|no longer)\b/i.test(evidence)) continue;
    const fields = {}, amend = /改为|改成|改到|调整为|调整至|收紧至|放宽至|\b(?:amend|change|revise)\b/i.test(evidence);
    const drawdown = evidence.match(/(?:(?:最大回撤|max(?:imum)?\s+drawdown)\s*(?:上限(?:为)?|不超过|不得超过|控制在|改为|调整为|收紧至|放宽至|设为|限制在|不高于|at most|up to|to|<=|[≤:=：])|(?:回撤上限|drawdown\s+(?:limit|cap))\s*(?:为|改为|调整为|of|to|is|<=|[≤:=：])?)\s*(\d+(?:\.\d+)?)\s*[%％]/i);
    if (drawdown && Number(drawdown[1]) <= 100) fields.maxDrawdown = Number(rateFraction(drawdown[1], 2));
    const long = /只做多|仅做多|禁止做空|不(?:允许)?做空|\blong[- ]only\b|\bno short(?:ing| sales)?\b/i.test(evidence);
    const short = /只做空|仅做空|禁止做多|不(?:允许)?做多|\bshort[- ]only\b/i.test(evidence);
    if (long !== short) fields.directions = [long ? 'long' : 'short'];
    for (const [key, name] of [['commission', '佣金|手续费|commission'], ['slippage', '滑点|slippage']]) {
      const match = evidence.match(new RegExp(`(?:${name})\\s*(?:率|为|为每边|is|of|=|[:：])?\\s*(\\d+(?:\\.\\d+)?)\\s*(bps?\\b|基点|[%％])`, 'i'));
      if (match) {
        const value = rateFraction(match[1], /[%％]/.test(match[2]) ? 2 : 4);
        if (Number(value) <= 1) (fields.costs ??= {})[key] = value;
      }
    }
    const instrument = evidence.match(/(?:标的|交易品种|交易代码|ticker|instrument)\s*(?:为|是|[:：=])?\s*([A-Z][A-Z0-9._/-]{0,15})(?![A-Za-z0-9._/-])/);
    // A multi-instrument list needs the Agent's structured list, never a partial allowlist.
    if (instrument && !/^(?:\s*[,，、和及或/&]|\s+(?:and|or)\b)\s*[A-Z][A-Z0-9._/-]*/.test(evidence.slice(instrument.index + instrument[0].length))) fields.instruments = [instrument[1]];
    const frequency = evidence.match(/日线|周线|月线|\b(?:daily|weekly|monthly)\s+bars?\b/i);
    if (frequency) fields.frequency = frequency[0];
    if (Object.keys(fields).length) rows.push({ source: 'user', evidence, fields, amend });
  }
  return rows;
}

const gapActions = {
  objective: 'Choose a comparable metric and direction for the development period.',
  instruments: 'Resolve the tradable instruments from the project, then freeze their data snapshots.',
  benchmark: 'Choose and label a research benchmark comparable to the selected universe and horizon.',
  hypothesis: 'Write a falsifiable hypothesis and its observable signal before running trials.',
  'capital.amount': 'Read project research capital or specify a labeled simulation assumption.',
  'capital.currency': 'Resolve the quote/account currency from instrument and dataset metadata.',
  'costs.commission': 'Read the fee schedule or specify a labeled research cost scenario.',
  'costs.slippage': 'Derive a slippage scenario from the market and execution assumptions.',
  horizon: 'Read the available history and propose ordered development and holdout windows.',
  target: 'Identify an available backtest backend and a compatible independent implementation.',
};

export function buildMandate(input = {}, previous) {
  check(isObject(input) && Object.keys(input).every(key => Object.hasOwn(mandateInputSchema.properties, key)), 'Unknown mandate input field.');
  check(!previous || previous.schemaVersion === 1 && previous.researchOnly && isObject(previous.fields) && isObject(previous.provenance), 'Invalid prior research mandate.');
  const fields = { capital: {}, costs: {} }, provenance = {}, conflicts = new Map();
  for (const key of Object.keys(leafSchemas)) {
    setField(fields, key, previous ? structuredClone(fieldAt(previous.fields, key) ?? null) : null);
    if (previous?.provenance[key]) provenance[key] = structuredClone(previous.provenance[key]);
  }
  for (const conflict of previous?.conflicts ?? []) conflicts.set(conflict.field, structuredClone(conflict));
  function merge(key, raw, row) {
    if (raw === null && !row.amend) return;
    const value = raw === null ? null : normalize(key, raw), prior = provenance[key];
    if (prior && sourceRank[row.source] < sourceRank[prior.source]) return;
    const source = { source: row.source, evidence: row.evidence };
    const previousValue = fieldAt(fields, key);
    if (decisionFields.has(key) && prior?.source === 'user' && row.source === 'user' && !row.amend && previousValue !== null && !equal(value, previousValue)) {
      const conflict = conflicts.get(key) ?? { field: key, alternatives: [{ value: previousValue, evidence: prior.evidence }] };
      if (!conflict.alternatives.some(option => equal(option.value, value))) conflict.alternatives.push({ value, evidence: row.evidence });
      conflicts.set(key, conflict);
      return;
    }
    if (row.source === 'user' && row.amend) conflicts.delete(key);
    setField(fields, key, value);
    provenance[key] = source;
  }
  const brief = input.brief === undefined ? '' : stringValue(input.brief, 12000);
  const context = input.context ?? [];
  check(Array.isArray(context) && context.length <= 64, 'Provide at most 64 attributed mandate context entries.');
  if (brief && !fields.goal) merge('goal', brief.slice(0, 2000), { source: 'user', evidence: brief.slice(0, 2000) });
  for (const row of [...briefContext(brief), ...context]) {
    check(isObject(row) && Object.keys(row).every(key => ['source', 'evidence', 'fields', 'amend'].includes(key)) && Object.hasOwn(sourceRank, row.source), 'Invalid mandate context source or field.');
    check(row.amend === undefined || typeof row.amend === 'boolean' && (!row.amend || row.source === 'user'), 'Only an explicit user amendment can supersede user terms.');
    const evidence = stringValue(row.evidence), values = row.fields;
    check(isObject(values) && Object.keys(values).length > 0, 'An attributed context entry needs fields.');
    for (const [key, value] of Object.entries(values)) {
      if (grouped.has(key)) {
        if (value === null) {
          for (const leaf of Object.keys(fieldSchema.properties[key].properties)) merge(`${key}.${leaf}`, null, { ...row, evidence });
          continue;
        }
        check(isObject(value) && Object.keys(value).length > 0, `Expected fields for ${key}.`);
        for (const [leaf, item] of Object.entries(value)) {
          const path = `${key}.${leaf}`;
          check(Object.hasOwn(leafSchemas, path), `Unknown mandate field ${path}.`);
          merge(path, item, { ...row, evidence });
        }
      } else {
        check(Object.hasOwn(leafSchemas, key), `Unknown mandate field ${key}.`);
        merge(key, value, { ...row, evidence });
      }
    }
  }
  const assume = (field, value, reason) => {
    if (fieldAt(fields, field) === null || provenance[field]?.source === 'assumption' && provenance[field].evidence === reason) {
      merge(field, value, { source: 'assumption', evidence: reason });
    }
  };
  assume('objective', { metric: 'netReturn', direction: 'maximize' }, 'Use cost-adjusted return as the initial research comparison.');
  const passiveBaseline = 'Use passive exposure to the same instrument over the same window as the research benchmark.';
  if (fields.instruments?.length === 1) assume('benchmark', `Buy and hold ${fields.instruments[0]} over the same period and cost assumptions.`, passiveBaseline);
  else if (provenance.benchmark?.source === 'assumption' && provenance.benchmark.evidence === passiveBaseline) {
    fields.benchmark = null;
    delete provenance.benchmark;
  }
  const initialHypothesis = 'Make the comparison against the proposed benchmark testable on the development window.';
  if (fields.goal && fields.benchmark && fields.objective)
    assume('hypothesis', `Test whether the proposed rules achieve ${fields.objective.direction === 'minimize' ? 'lower' : 'higher'} ${fields.objective.metric} than the benchmark: ${fields.benchmark}`, initialHypothesis);
  else if (provenance.hypothesis?.source === 'assumption' && provenance.hypothesis.evidence === initialHypothesis) {
    fields.hypothesis = null;
    delete provenance.hypothesis;
  }
  assume('reviewConditions', ['Review once after the selected parameters are frozen and the holdout completes.'], 'Research review checkpoint.');
  assume('haltConditions', ['Stop selection when a mandated limit is breached or the required evidence is unavailable.'], 'Research stop condition.');
  const assumptions = input.assumptions ?? [];
  check(Array.isArray(assumptions) && assumptions.length <= 100, 'Invalid research assumptions.');
  const gaps = Object.entries(gapActions).filter(([key]) => fieldAt(fields, key) === null)
    .map(([field, next]) => ({ field, action: 'resolve_in_research', next }));
  const disputes = [...conflicts.values()];
  const constraints = fields.maxDrawdown === null ? [] : [{ metric: 'maxDrawdown', op: '<=', value: fields.maxDrawdown }];
  return {
    schemaVersion: 1, status: disputes.length ? 'needs_clarification' : 'draft', researchOnly: true, deploymentAuthorized: false,
    fields, provenance, assumptions: [...new Set([...(previous?.assumptions ?? []), ...assumptions.map(item => stringValue(item))])],
    gaps, conflicts: disputes, questions: disputes.map(({ field, alternatives }) =>
      `委托书中 ${field} 有两项互相冲突的明确要求（${alternatives.map(option => JSON.stringify(option.value)).join(' / ')}），本次以哪项为准？`),
    experiment: {
      objective: fields.objective, constraints,
      config: Object.fromEntries([['capital', fields.capital.amount], ['commission', fields.costs.commission], ['slippage', fields.costs.slippage]].filter(([, value]) => value !== null)),
      unverifiedConstraints: coverageChecks.filter(key => fields[key] !== null),
    },
  };
}
