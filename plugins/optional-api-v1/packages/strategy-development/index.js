import { capability } from '@sesame/plugin-sdk/capabilities';
import { planProject, loadProject, validationSummary } from './project.js';
import { buildProject } from './implementation.js';
import { testProject } from './workflow.js';
import { compareProjects, diagnoseProject, loadTradeEvidence } from './methods.js';
import { verifyProject } from './temporal-verification.js';
import { evaluateTrialMeasure } from './revision-trial.js';
import { researchMethod } from './research-method.js';
import { studyProject } from './design-study.js';
import { readRecord } from './records.js';

export function createCapabilities(host) {
  return [
    capability('strategy_development_plan', (input, signal) => planProject(host, input, signal)),
    capability('strategy_development_build', (input, signal) => buildProject(host, input, signal)),
    capability('strategy_development_verify', (input, signal) => verifyProject(host, input, signal)),
    capability('strategy_development_method', input => researchMethod(input.method)),
    capability('strategy_development_study', (input, signal) => studyProject(host, input, signal)),
    capability('strategy_development_backtest', (input, signal, execution) => testProject(host, input, signal, execution)),
    capability('strategy_development_read', async ({ project_ref, trade_page }, signal) => {
      const project = await loadProject(host, project_ref);
      const [tradeEvidence, designEvidence] = await Promise.all([loadTradeEvidence(host, project, signal, trade_page),
        project.designStudy ? readRecord(host, project.designStudy.ref, 'strategy-development.design-study') : null]);
      return { project, ...(designEvidence ? { designEvidence } : {}), validation: validationSummary(project), diagnostics: diagnoseProject({ ...project, tradeEvidence }) };
    }),
    capability('strategy_development_compare', async (input, signal) => {
      const arms = {};
      for (const name of ['baseline', 'candidate', 'matched', 'ablation']) {
        if (!input[name]) continue;
        const project = await loadProject(host, input[name]);
        arms[name] = { ...project, projectRef: input[name], tradeEvidence: await loadTradeEvidence(host, project, signal) };
      }
      const comparison = compareProjects({ ...arms, retuned: input.retuned });
      const predicted = evaluateTrialMeasure(comparison);
      return predicted ? { ...comparison, interventionOutcome: predicted } : comparison;
    }),
  ];
}
