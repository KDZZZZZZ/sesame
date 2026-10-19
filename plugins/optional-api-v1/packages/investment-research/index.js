import { capability } from '@sesame/plugin-sdk/capabilities';
import { researchWorkflow } from './src/runtime.js';
import { researchQuestion } from './src/qa.js';

export function createCapabilities(host) {
  return [
    capability('investment_research_analyze', (input, signal, execution) => researchWorkflow(host, input, signal, execution, 'analyze')),
    capability('investment_research_report', (input, signal, execution) => researchWorkflow(host, input, signal, execution, 'report')),
    capability('investment_research_ask', researchQuestion.bind(null, host)),
  ];
}
