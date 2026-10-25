import { createService } from './service.js';
import { createExecution } from './bindings.js';
import { closeRecords } from './records.js';

export function createCapabilities(host) {
  const execution = (name, method) => ({ name, execute: (input, signal, context) => createExecution(host, { provenance: context.provenance, signal })[method](input, signal) });
  const direct = (name, method) => ({ name, execute: (input, signal) => createService(host)[method](input, signal) });
  return [
    execution('portfolio_execution_configure', 'configure'),
    execution('portfolio_execution_context', 'context'),
    execution('portfolio_execution_status', 'status'),
    execution('portfolio_execution_apply', 'apply'),
    { name: 'manual_trade_inspect', execute: () => createService(host).inspect() },
    direct('manual_trade_observe', 'observe'),
    direct('manual_trade_prepare', 'prepare'),
    direct('manual_trade_execute', 'execute'),
    direct('manual_trade_status', 'status'),
    direct('manual_trade_cancel', 'cancel'),
    { name: 'dispose', execute: () => { closeRecords(host); return {}; } },
  ];
}
