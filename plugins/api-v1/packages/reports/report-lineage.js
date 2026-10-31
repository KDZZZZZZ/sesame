// Agent-facing provenance checks. No source-type badges are added to reports.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 1200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const kinds = new Set(['acquired', 'derived', 'inferred', 'user_supplied', 'mixed']);
const natures = new Set(['fact', 'statistic', 'interpretation', 'prediction', 'plan', 'metadata', 'mixed']);
const fixed = value => object(value) && ['id','revision','kind','schemaVersion'].every(key => text(value[key],20000)) && /^sha256:[a-f0-9]{64}$/.test(value.digest);
const hasInference = origin => origin?.kind === 'inferred' || origin?.parts?.some(part => part.kind === 'inferred');
const hasPrediction = origin => origin?.nature === 'prediction' || origin?.parts?.some(part => part.nature === 'prediction');

/** Actual origin is supplied by the researcher, never guessed from a template. */
export function validateOrigin(origin, row, name = 'Result') {
  if (origin === undefined) return [];
  const refs = [];
  const validate = (item, part = false) => {
    const allowed = ['kind','nature','source','note','refs',...(part ? ['path','method_ref'] : ['parts'])];
    check(object(item) && Object.keys(item).every(key => allowed.includes(key)), `${name}: invalid origin fields`);
    check(kinds.has(item.kind) && natures.has(item.nature), `${name}: origin needs a declared kind and content nature`);
    check(item.note === undefined || text(item.note), `${name}: origin.note must be concise text`);
    check(item.source === undefined || text(item.source), `${name}: origin.source must be text`);
    check(item.refs === undefined || Array.isArray(item.refs) && item.refs.length <= 32 && item.refs.every(fixed), `${name}: origin refs must be fixed references`);
    if (part) check(text(item.path,300) && item.path.startsWith('/'), `${name}: mixed origin parts need a value path`);
    const inputs = [...item.refs ?? [], ...row.evidence_refs ?? []];
    if (item.kind === 'acquired') check(text(item.source) && inputs.length > 0, `${name}: acquired values need a source identity and fixed evidence`);
    if (['derived','inferred'].includes(item.kind)) check(text(item.method_ref ?? row.method_ref,20000), `${name}: computed or inferred values need their actual method_ref`);
    if (item.kind === 'mixed') {
      check(!part && Array.isArray(item.parts) && item.parts.length >= 2 && item.parts.length <= 32, `${name}: mixed origins need 2–32 non-nested parts`);
      check(new Set(item.parts.map(entry => entry.path)).size === item.parts.length, `${name}: mixed origin paths must be unique`);
      item.parts.forEach(entry => validate(entry,true));
    } else check(item.parts === undefined, `${name}: only mixed origins have parts`);
    refs.push(...item.refs ?? []);
  };
  validate(origin);
  if (hasInference(origin) && (row.status === undefined || row.status === 'provided')) check(row.reasoning !== undefined, `${name}: inferred values need concise reasoning and a historical comparison status`);
  return refs;
}

/** Verify the explanation shape and evidence links; do not judge or infer a method. */
export function validateReasoning(reasoning, row, name = 'Result', prediction = false) {
  if (reasoning === undefined) return;
  check(object(reasoning) && Object.keys(reasoning).every(key => ['observations','steps','conclusion','history'].includes(key)), `${name}: invalid reasoning fields`);
  for (const key of ['observations','steps']) check(Array.isArray(reasoning[key]) && reasoning[key].length >= 1 && reasoning[key].length <= 4 && reasoning[key].every(value => text(value,600)), `${name}: reasoning.${key} requires 1–4 concise statements`);
  check(text(reasoning.conclusion,1000), `${name}: reasoning needs a concise conclusion`);
  const history = reasoning.history;
  check(object(history) && Object.keys(history).every(key => ['status','note'].includes(key)) && ['linked','pending','unavailable','not_applicable'].includes(history.status) && text(history.note,800), `${name}: reasoning needs an explicit historical comparison status and note`);
  if (history.status === 'linked') check(object(row.historical_basis), `${name}: linked historical reasoning needs its own historical_basis`);
  if (history.status === 'not_applicable') check(!prediction && !hasPrediction(row.origin), `${name}: a prediction cannot declare historical comparison not applicable`);
  if (row.historical_basis !== undefined) check(history.status === 'linked', `${name}: supplied historical evidence must be linked by the reasoning`);
}

/** Internal completeness, separate from business field completeness and reader UI. */
export function lineageAudit(field, row) {
  if (row.status !== 'provided') return { status:'not_supplied', issues:[] };
  const issues = [];
  if (!row.origin) issues.push('actual_origin_not_declared');
  const suggested = field.agent_guidance?.lineage;
  const inference = hasInference(row.origin) || !row.origin && suggested?.suggested_kind === 'inferred';
  const steps = field.type === 'inferences' ? row.value : null;
  if (inference && !row.reasoning && !steps?.every(step => step.reasoning)) issues.push('concise_reasoning_not_supplied');
  return { status:issues.length ? 'needs_review' : 'documented', issues };
}
