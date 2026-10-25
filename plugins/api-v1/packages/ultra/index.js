import { capability } from '@sesame/plugin-sdk/capabilities';
import { start, status, dispatch, wait, resume, close, stop, finish, cycle, beforeTurn, afterTurn } from './src/runtime.js';

export function createCapabilities(host) {
  return Object.entries({ ultra_start: start, ultra_status: status, ultra_dispatch: dispatch, ultra_wait: wait,
    ultra_resume: resume, ultra_close: close, ultra_stop: stop, ultra_finish: finish, ultra_cycle: cycle, ultra_before_turn: beforeTurn, ultra_after_turn: afterTurn })
    .map(([name, handler]) => capability(name, (input, signal, execution) => handler(host, input, signal, execution)));
}
