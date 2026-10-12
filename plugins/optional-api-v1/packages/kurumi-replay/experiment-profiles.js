// Immutable experiment policy. No host, storage, model or environment effects.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
export const LEGACY_PROFILE_ID = 'legacy-500-25-25-v1';
export const ROUND2_PROFILE_ID = 'informed-replay-50x-v1';
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const sha256 = bytes => 'sha256:'+createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const fixed = (id,leverage) => ({schemaVersion:1,id,initialBalance:'300000',victoryBalance:'20000000',currency:'JPY',
  chapterRules:[{leverage:leverage[0],stopout:'0.2'},{leverage:leverage[1],stopout:'0.5'},{leverage:leverage[2],stopout:'0.3'}],
  commissionJpyPer1000PerSide:'3',simulatedFinancingJpyPer1000UtcDay:'10',fxMaxAgeMs:60000,
  engine:'nautilus-trader',engineVersion:'1.231.0',model:'native-quote-tick-v1',
  interpretation:id===ROUND2_PROFILE_ID?'informed replay of same history; not out-of-sample':'legacy continuous experiment'});
const profiles = new Map([fixed(LEGACY_PROFILE_ID,['500','25','25']),fixed(ROUND2_PROFILE_ID,['50','50','50'])].map(p=>[p.id,p]));
function fail(message) { throw Object.assign(new Error(message),{code:'RULES_MISMATCH'}); }
export function getExperimentProfile(id=LEGACY_PROFILE_ID) {
  const content=profiles.get(id); if(!content)fail('Unknown experiment profile; no caller-selectable leverage');
  return {id,digest:sha256(canonical(content)),content:copy(content)};
}
export function resolveExperimentProfile(state) {
  const selected=state?.rules?.experimentProfile;
  if(selected===undefined) return getExperimentProfile(LEGACY_PROFILE_ID);
  if(!selected||typeof selected!=='object'||Array.isArray(selected))fail('Malformed experiment profile; only absent field means legacy');
  const expected=getExperimentProfile(selected.id);
  if(!isDeepStrictEqual(selected,expected))fail('Frozen profile content/digest changed');
  return expected;
}
export function assertNativeRules(state) {
  const p=resolveExperimentProfile(state), r=state?.rules;
  if(!r || r.engine!==p.content.engine || r.engineVersion!==p.content.engineVersion || r.model!==p.content.model ||
     r.fxMaxAgeMs!==p.content.fxMaxAgeMs || !isDeepStrictEqual(r.chapterRules,p.content.chapterRules) ||
     r.initialBalance!==p.content.initialBalance || r.victoryBalance!==p.content.victoryBalance ||
     r.commissionJpyPer1000PerSide!==p.content.commissionJpyPer1000PerSide ||
     r.simulatedFinancingJpyPer1000UtcDay!==p.content.simulatedFinancingJpyPer1000UtcDay)
    fail('Fixed native engine, chapter profile, funding, costs and FX policy cannot change inside a run');
  return p;
}
