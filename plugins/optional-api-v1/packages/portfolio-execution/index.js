import { createService } from './service.js';
import { createExecution, migrateLegacy } from './bindings.js';

export function createTools(host) {
  const { define, Type } = host.tools, service = createService(host), execution = createExecution(host);
  const text = description => Type.String({ minLength: 1, maxLength: 100, description });
  const amount = description => Type.String({ pattern: '^(0|[1-9]\\d*)(\\.\\d+)?$', maxLength: 40, description });
  const binding = { binding_id: text('Immutable binding from portfolio_execution_configure') };
  const backend = Type.Union(['mt5', 'qmt'].map(Type.Literal));
  const direct = method => async (args, signal) => { await migrateLegacy(host, signal); return service[method](args, signal); };
  return [
    define('portfolio_execution_configure', 'Bind an already configured execution adapter to its exact account and revision. Returns the execution capability reference for any workflow. Does not load, configure or connect a backend, or place an order. Imports legacy receipts when the old manual-trading package is installed.', {
      id: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9_-]{1,100}$' })), backend,
    }, (args, signal) => execution.configure(args, signal)),
    define('portfolio_execution_context', 'Read the bound account identity/capability contract, or its full account snapshot including strategy positions, retained history and mounted strategies. Delegated reads require the frozen execution binding.', {
      ...binding, action: Type.Union(['identity', 'snapshot'].map(Type.Literal)), history_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
    }, (args, signal) => execution.context(args, signal)),
    define('portfolio_execution_status', 'Read this main owner\'s retained workflow execution applications and their operation IDs, including interrupted runs. Does not submit, resume or replay execution. Query individual order receipts with manual_trade_status.', {
      binding_id: Type.Optional(binding.binding_id), run_id: Type.Optional(text('Saved workflow run ID')),
      offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, args => execution.status(args)),
    define('portfolio_execution_apply', 'Apply one saved target portfolio through the bound execution adapter. Requires a live workflow tool calling for its matching executor task; direct model calls fail. Exact native units, all-origin close/reduction, guarded strategy stops and durable no-replay receipts are preserved.', {
      ...binding,
      run: Type.Object({ id: text('Saved workflow run ID'), decidedAt: Type.Integer({ minimum: 1 }),
        plan: Type.Object({ id: text('Frozen workflow plan ID'), account: Type.Object({}, { additionalProperties: true }), ownerConversationId: text('Frozen parent conversation'), slippageBps: Type.Integer({ minimum: 0, maximum: 500 }) }, { additionalProperties: false }),
        decision: Type.Object({ unchanged: Type.Boolean(), targets: Type.Array(Type.Object({ symbol: text('Exact native symbol'), quantity: Type.String({ pattern: '^-?(0|[1-9]\\d*)(\\.\\d+)?$', maxLength: 40 }), unit: Type.Union(['lots', 'shares'].map(Type.Literal)) }, { additionalProperties: false }), { maxItems: 100 }),
          pause_strategies: Type.Array(Type.Object({ deployment_id: text('Observed deployment ID'), reason: Type.String({ minLength: 10, maxLength: 2000 }) }, { additionalProperties: false }), { maxItems: 30 }),
          rationale: Type.Optional(Type.String({ maxLength: 8000 })), evidence_dataset_ids: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 30 })),
        }, { additionalProperties: false }),
      }, { additionalProperties: false }),
    }, (args, signal) => execution.apply(args, signal)),
    define('manual_trade_inspect', 'Inspect supported direct execution channels and enforced latency policy. Does not connect, configure, install, or trade.', {}, () => service.inspect()),
    define('manual_trade_observe', 'Read current account, symbol conditions, positions and a source-timestamped executable quote from an already loaded MT5/QMT backend. Returns an observation_id that starts the model decision clock; no order is sent.', {
      backend, symbol: text('Exact broker symbol'),
    }, direct('observe')),
    define('manual_trade_execute', 'Submit one explicitly user-authorized order from a recent observation. M5+ only. In the native process recheck account, available position/specification, deadline and latest quote, then send once without another model turn. Stable operation_id prevents duplicates; stale/slow preparation rejects. unknown must be queried, never resent.', {
      operation_id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,100}$' }), observation_id: text('ID from manual_trade_observe; one intent per observation'), user_authorized: Type.Literal(true),
      timeframe: Type.Optional(Type.Union(['5m', '15m', '30m', '1h', '4h', '1d'].map(Type.Literal))), action: Type.Union(['market', 'limit', 'close'].map(Type.Literal)), side: Type.Union(['buy', 'sell'].map(Type.Literal)),
      quantity: amount('MT5 lots or QMT integer shares, based on the user intent'), price_limit: amount('Maximum buy/minimum sell executable quote. A market fill can still slip; use a limit order for a hard order-price limit'),
      limit_price: Type.Optional(amount('Required only for limit orders')), position_id: Type.Optional(Type.String({ pattern: '^[1-9]\\d*$', description: 'Required MT5 position ticket for close' })), stop_loss: Type.Optional(amount('Optional MT5 stop loss')), take_profit: Type.Optional(amount('Optional MT5 take profit')),
    }, direct('execute')),
    define('manual_trade_status', 'Read a durable receipt; refresh reads the backend command and actual orders/fills for recovery. No matching record never proves a timed-out send failed. Does not replay or place orders.', {
      operation_id: text('Existing operation ID'), refresh: Type.Optional(Type.Boolean()),
    }, direct('status')),
    define('manual_trade_cancel', 'Request cancellation of a confirmed pending order created through this plugin, using a separate stable operation ID. Does not close a filled position. Query afterwards; cancel_requested is not confirmed cancellation.', {
      operation_id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,100}$' }), original_operation_id: text('Original manual_trade_execute operation'), user_authorized: Type.Literal(true),
    }, direct('cancel')),
  ];
}
