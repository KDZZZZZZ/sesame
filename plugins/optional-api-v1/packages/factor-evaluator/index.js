import { capability } from '@sesame/plugin-sdk/capabilities';
import { evaluate } from './evaluator.js';
export const createCapabilities = host => [capability('factor_evaluate', (input, signal, execution) => evaluate(host, input, signal, execution))];
