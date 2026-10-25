import { Decimal } from '@sesame/plugin-sdk/decimal';
import { invoke } from './calls.js';
import { adapterOperation, adapterResult } from './adapter-contract.js';

export const check = (ok, code, message) => { if (!ok) throw Object.assign(new Error(message), { code }); };
export const sameAccount = (a, b) => a?.accountId === b?.accountId && typeof a?.accountId === 'string' && (typeof a.server === 'string' ? a.server === b.server && b.connectionId === undefined : typeof a.connectionId === 'string' && a.connectionId === b.connectionId && b.server === undefined);
export const decimal = value => { const text = String(value); check(text.length <= 40 && /^(0|[1-9]\d*)(\.\d+)?$/.test(text) && Decimal.compare(text, '0') > 0, 'SOURCE_DATA_INVALID', 'Expected a positive decimal amount'); return text; };

/** Only the declared native service crosses this boundary. No SDK enums,
 * permission toggles, order selectors or broker-history inference live here. */
export function createAdapters(host, { now = Date.now, authorizeRequest } = {}) {
  async function call(backend, operation, input, signal) {
    signal?.throwIfAborted();
    const selected = await adapterOperation(host, backend, operation);
    if (host.context?.kind === 'subagent' && ['submit', 'cancel'].includes(operation)) {
      check(typeof authorizeRequest === 'function', 'FORBIDDEN', 'Backend write requires a live portfolio executor intent');
      input = authorizeRequest(selected.id, input);
    }
    const value = await invoke(host, selected.pluginId, selected.id, input, signal);
    signal?.throwIfAborted();
    return adapterResult(value, backend);
  }
  async function observation(backend, operation, input, signal) {
    const began = now(), value = await call(backend, operation, input, signal), receivedAt = now();
    check(Number.isSafeInteger(value.capturedAt) && value.capturedAt <= receivedAt && Number.isSafeInteger(value.readStartedAt) && value.capturedAt >= value.readStartedAt,
      'SOURCE_DATA_INVALID', 'Adapter snapshot has invalid capture timing');
    check(value.account && Array.isArray(value.projection?.positions) && Array.isArray(value.projection?.orders) && value.quote,
      'SOURCE_DATA_INVALID', 'Adapter snapshot omitted its normalized projection');
    return { ...value, capturedAt: receivedAt, captureMs: receivedAt - began, quote: { ...value.quote, receivedAt,
      ...(operation === 'prepare' ? { preparationRequestMs: receivedAt - began } : {}) } };
  }
  function orderRequest(observed, args) {
    decimal(args.quantity); decimal(args.price_limit);
    check(['buy', 'sell'].includes(args.side) && ['market', 'limit', 'close'].includes(args.action), 'INVALID_ARGUMENT', 'Choose a supported order action and side');
    check(args.action === 'limit' || args.limit_price === undefined, 'INVALID_ARGUMENT', 'limit_price is only valid for limit orders');
    check(args.action === 'close' || args.position_id === undefined, 'INVALID_ARGUMENT', 'position_id is only valid for close');
    if (args.action === 'limit') {
      const price = decimal(args.limit_price);
      check(args.side === 'buy' ? Decimal.compare(price, args.price_limit) <= 0 : Decimal.compare(price, args.price_limit) >= 0, 'INVALID_ARGUMENT', 'Limit price crossed authorized boundary');
    }
    return { observation: observed, intent: args };
  }
  return {
    identity: async (backend, signal) => (await call(backend, 'identity', {}, signal)).account,
    snapshot: (backend, symbol, signal) => observation(backend, 'snapshot', { symbol }, signal),
    prepare: (backend, symbol, args, signal) => observation(backend, 'prepare', { symbol, ...args }, signal),
    orderRequest,
    submit: (observed, args, signal) => call(observed.backend, 'submit', orderRequest(observed, args), signal),
    status: (record, signal, expectedCurrent) => call(record.backend, 'recover', { record, ...(expectedCurrent ? { expectedCurrent } : {}) }, signal),
    command: (record, signal) => call(record.backend, 'command', { record }, signal),
    cancel: (record, operationId, signal) => call(record.backend, 'cancel', { record, operationId }, signal),
  };
}
