import { check, digest } from './shared.js';

export const isSingle = run => run.config.executionMode === 'single';
export const initialSingle = () => ({ step: { mode: 'plan', key: 'r0:plan', round: 0 }, steps: [], directions: [], directionIndex: 0 });
export const singleStep = run => (run.single ?? initialSingle()).step;
const keyFor = (round, direction) => `r${round}:${digest(direction).slice(7, 19)}`;
const setStep = (single, mode, round, extra = {}) => { single.step = { mode, round, key: mode === 'selection' ? 'selection' : `r${round}:${mode}`, ...extra }; };

// One logical Agent owns all stages. This state machine only advances accepted
// structured submissions; candidate/selection receipts come from the evaluator.
export function advanceSingle(run, stage, input, output, now) {
  const value = structuredClone(run), single = value.single ?? initialSingle(); value.single = single;
  check(single.step.key === stage.key, 'STALE_STEP', 'The current single-Agent stage changed. Read context before submitting.');
  single.steps.push({ ...stage, input, output, submittedAt: now }); delete single.pending;
  const trial = () => value.trials.find(item => item.id === stage.trialId);
  const nextBranch = round => {
    if (single.directionIndex >= single.directions.length || value.trials.length >= value.config.maxTrials) { setStep(single, 'reflection', round); return; }
    const direction = single.directions[single.directionIndex], key = keyFor(round, direction), trialId = `trial_${key.replace(':', '_')}`;
    check(!value.trials.some(item => item.id === trialId), 'DUPLICATE_TRIAL', 'A single-Agent stage cannot recreate a completed trial.');
    value.trials.push({ id: trialId, round, direction, status: 'proposing', createdAt: now });
    setStep(single, 'hypothesis', round, { direction, trialId, key: `${key}:hypothesis` });
  };
  switch (stage.mode) {
    case 'plan':
      single.directions = output.directions; single.directionIndex = 0; single.stopAfterRound = output.stop;
      if (output.stop) setStep(single, 'reflection', stage.round); else nextBranch(stage.round);
      break;
    case 'hypothesis':
      if (output.skip) { Object.assign(trial(), { status: 'rejected', hypothesis: '未提出假设', review: { verdict: 'reject', reason: output.reason } }); single.directionIndex++; nextBranch(stage.round); }
      else { Object.assign(trial(), output, { status: 'implementing' }); setStep(single, 'code', stage.round, { direction: stage.direction, trialId: stage.trialId, key: `${keyFor(stage.round, stage.direction)}:code` }); }
      break;
    case 'code': {
      const measured = output.evaluation;
      Object.assign(trial(), { candidate: measured.candidate, candidateDigest: measured.candidateDigest, explanation: output.explanation, metrics: measured.metrics, redundancy: measured.redundancy, evaluationReceipt: measured, ...(measured.evaluation ? { evaluation: measured.evaluation } : {}), eligible: measured.eligible, gate: measured.gate ?? '', status: 'reviewing' });
      setStep(single, 'review', stage.round, { direction: stage.direction, trialId: stage.trialId, key: `${keyFor(stage.round, stage.direction)}:review` });
      break;
    }
    case 'review':
      Object.assign(trial(), { review: output, ...(output.applicability ? { applicability: output.applicability } : {}), status: ['accept', 'conditional'].includes(output.verdict) && trial().eligible ? 'accepted' : 'rejected' }); single.directionIndex++; nextBranch(stage.round);
      break;
    case 'reflection':
      value.reflections.push({ round: stage.round, ...output });
      if (output.stop || single.stopAfterRound || stage.round + 1 >= value.config.rounds || value.trials.length >= value.config.maxTrials) setStep(single, 'selection', stage.round);
      else setStep(single, 'plan', stage.round + 1);
      break;
    case 'selection':
      value.selection = { ...output, ...Object.fromEntries(['diagnostics', 'evaluations', 'failedTrials', 'planDigest'].filter(key => output.evaluation[key] !== undefined).map(key => [key, output.evaluation[key]])), frozenAt: now, digest: output.evaluation.selectionDigest };
      setStep(single, 'complete', stage.round, { key: 'complete' });
      break;
    default: check(false, 'INVALID_OUTPUT', 'This single-Agent stage accepts no output.');
  }
  value.round = single.step.round; value.phase = single.step.mode === 'complete' ? 'selection' : single.step.mode;
  return value;
}
