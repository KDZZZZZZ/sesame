export const parameterKey = values => JSON.stringify(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

export const selectionSchema = {
  type: 'object', additionalProperties: false, required: ['method'],
  properties: {
    method: { type: 'string', enum: ['point_best', 'neighborhood_worst'], description: 'Declare before development. neighborhood_worst ranks fully supported numeric interiors by their worst feasible measured score.' },
    max_step: { type: 'object', maxProperties: 12, additionalProperties: { type: 'number', exclusiveMinimum: 0 },
      description: 'Override the inclusive maximum distance to an adjacent level. Each varying numeric axis defaults to its smallest declared grid spacing.' },
    categorical_axes: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string', minLength: 1 },
      description: 'Hold these axes fixed during perturbation, including numeric codes for categories. String and Boolean axes are categorical by default.' },
  },
};

function valid(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'INVALID_SELECTION_RULE' });
}

// Use the declared JSON decimals for spacing. Subtracting binary floats would
// make an evenly spaced price grid such as 1000.1, 1000.2, 1000.3 look irregular.
function decimalParts(value) {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  return { digits: BigInt(whole + fraction), exponent: Number(exponent) - fraction.length };
}

function decimalGap(a, b) {
  const scale = Math.min(a.exponent, b.exponent);
  const gap = b.digits * 10n ** BigInt(b.exponent - scale) - a.digits * 10n ** BigInt(a.exponent - scale);
  return Number(gap + 'e' + scale);
}

export function prepareSelection(space, supplied) {
  const declaration = supplied === undefined ? { method: 'point_best' } : supplied;
  valid(declaration && typeof declaration === 'object' && !Array.isArray(declaration) &&
    Object.keys(declaration).every(key => Object.hasOwn(selectionSchema.properties, key)) &&
    ['point_best', 'neighborhood_worst'].includes(declaration.method), 'Choose point_best or neighborhood_worst before running the development search.');
  const robust = declaration.method === 'neighborhood_worst';
  valid(robust || declaration.max_step === undefined && declaration.categorical_axes === undefined, 'max_step and categorical_axes apply to neighborhood_worst only.');
  const labels = declaration.categorical_axes ?? [], maxStep = declaration.max_step ?? {};
  valid((declaration.categorical_axes === undefined || Array.isArray(declaration.categorical_axes)) &&
    labels.length <= 12 && labels.every(name => typeof name === 'string' && Object.hasOwn(space, name)) &&
    new Set(labels).size === labels.length, 'Every categorical_axes entry must name a different declared grid axis.');
  valid(declaration.max_step !== null && typeof maxStep === 'object' && !Array.isArray(maxStep), 'max_step must map varying numeric axes to positive distances.');
  const numeric = [], categorical = [], fixed = [];
  let strata = 1;
  const names = Object.keys(space);
  // An omitted selector preserves the neighbor list order in existing frozen selections.
  if (supplied !== undefined) names.sort();
  for (const name of names) {
    const values = space[name];
    if (values.length === 1) { fixed.push(name); continue; }
    if (!labels.includes(name) && values.every(value => typeof value === 'number')) {
      const levels = [...values].sort((a, b) => a - b);
      const decimals = robust ? levels.map(decimalParts) : [];
      const steps = decimals.slice(1).map((value, i) => decimalGap(decimals[i], value));
      numeric.push({ name, levels, steps, index: new Map(levels.map((value, i) => [value, i])) });
    } else {
      valid(!robust || labels.includes(name) || values.every(value => typeof value !== 'number'),
        'Declare the mixed numeric and categorical axis ' + name + ' in categorical_axes, or use uniformly numeric levels.');
      categorical.push(name); strata *= values.length;
    }
  }
  valid(Object.entries(maxStep).every(([name, step]) => numeric.some(axis => axis.name === name) && Number.isFinite(step) && step > 0),
    'Each max_step must be a positive finite distance for a varying numeric axis.');
  return { method: declaration.method, numeric, categorical, fixed, strata, maxStep };
}

export function coverageOf(plan, plannedPoints) {
  const effectiveMaxStep = Object.fromEntries(plan.numeric.map(({ name, steps }) => {
    const minimum = Math.min(...steps);
    return [name, plan.maxStep[name] ?? (Number.isFinite(minimum) ? minimum : null)];
  }));
  return {
    evaluated: false, plannedPoints, observedPoints: 0, eligiblePoints: 0,
    numericAxes: plan.numeric.map(axis => axis.name), categoricalAxes: plan.categorical, fixedAxes: plan.fixed, categoricalStrata: plan.strata,
    maxStep: plan.maxStep, effectiveMaxStep, requiredNeighbors: 2 * plan.numeric.length, supportedCenters: 0,
    excludedCenters: { ineligible: 0, boundary: 0, sparse: 0, missingObservation: 0, ineligibleNeighbor: 0 },
  };
}

// Axis-adjacent measured points in the same categorical stratum. Grid endpoints
// have one neighbor for diagnostics but cannot support a two-sided stability claim.
export function developmentNeighbors(plan, center, observed) {
  const neighbors = [];
  for (const { name, levels, index } of plan.numeric) {
    const i = index.get(center.parameters[name]);
    for (const value of [levels[i - 1], levels[i + 1]]) {
      if (value === undefined) continue;
      const point = observed.get(parameterKey({ ...center.parameters, [name]: value }));
      if (point) neighbors.push({ parameter: name, value, score: point.candidate.score, eligible: point.eligible,
        batchResultRef: point.candidate.batchResultRef, scoreDifference: point.candidate.score - center.score });
    }
  }
  return neighbors;
}

export function selectNeighborhood(plan, observed, direction, coverage) {
  let robustCandidate = null;
  coverage.evaluated = true;
  coverage.observedPoints = observed.size;
  const excluded = coverage.excludedCenters;
  for (const { candidate, eligible } of observed.values()) {
    if (!eligible) { excluded.ineligible++; continue; }
    coverage.eligiblePoints++;
    if (plan.numeric.some(({ name, levels, index }) => {
      const i = index.get(candidate.parameters[name]); return i === 0 || i === levels.length - 1;
    })) { excluded.boundary++; continue; }
    if (plan.numeric.some(({ name, steps, index }) => {
      const i = index.get(candidate.parameters[name]), limit = coverage.effectiveMaxStep[name];
      return steps[i - 1] > limit || steps[i] > limit;
    })) { excluded.sparse++; continue; }
    const neighbors = developmentNeighbors(plan, candidate, observed);
    if (neighbors.length !== coverage.requiredNeighbors) { excluded.missingObservation++; continue; }
    if (neighbors.some(point => !point.eligible)) { excluded.ineligibleNeighbor++; continue; }
    coverage.supportedCenters++;
    const scores = [candidate.score, ...neighbors.map(point => point.score)];
    const worstScore = direction === 'maximize' ? Math.min(...scores) : Math.max(...scores);
    if (!robustCandidate || (direction === 'maximize' ? worstScore > robustCandidate.worstScore : worstScore < robustCandidate.worstScore))
      robustCandidate = { ...candidate, worstScore, supportCount: scores.length };
  }
  return robustCandidate;
}
