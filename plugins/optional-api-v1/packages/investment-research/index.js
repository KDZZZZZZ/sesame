import { capability } from '@sesame/plugin-sdk/capabilities';
import { researchWorkflow } from './src/runtime.js';
import { researchQuestion } from './src/qa.js';
import { eventOutcomes } from './src/event-outcomes.js';
import { startReportResearch } from './src/report-research.js';

export function createCapabilities(host) {
  return [
    capability('investment_research_start', startReportResearch.bind(null, host)),
    capability('investment_research_analyze', (input, signal, execution) => researchWorkflow(host, input, signal, execution, 'analyze')),
    capability('investment_research_report', (input, signal, execution) => researchWorkflow(host, input, signal, execution, 'report')),
    capability('investment_research_ask', researchQuestion.bind(null, host)),
    capability('investment_research_event_outcomes', eventOutcomes.bind(null, host)),
  ];
}

export { readPacket, checkedReport } from './src/artifacts.js';
