import { createService } from './service.js';
export function createTools(host) {
  const {define,Type}=host.tools,service=createService(host);
  const text=description=>Type.String({minLength:1,maxLength:100,description});
  const amount=description=>Type.String({pattern:'^(0|[1-9]\\d*)(\\.\\d+)?$',maxLength:40,description});
  return [
    define('manual_trade_inspect','Inspect supported manual trading channels and enforced latency policy. Does not connect, configure, install, or trade.',{},()=>service.inspect()),
    define('manual_trade_observe','Read current account, symbol conditions, positions and a source-timestamped executable quote from an already loaded MT5/QMT backend. Returns an observation_id that starts the model decision clock; no order is sent.',{backend:Type.Union([Type.Literal('mt5'),Type.Literal('qmt')]),symbol:text('Exact broker symbol')},(args,signal)=>service.observe(args,signal)),
    define('manual_trade_execute','Submit one explicitly user-authorized order from a recent observation. M5+ only. In the native process recheck account, available position/specification, deadline and latest quote, then send once without another model turn. Stable operation_id prevents duplicates; stale/slow preparation rejects. unknown must be queried, never resent.',{
      operation_id:Type.String({pattern:'^[A-Za-z0-9_-]{1,100}$'}),observation_id:text('ID from manual_trade_observe; one intent per observation'),user_authorized:Type.Literal(true),
      timeframe:Type.Optional(Type.Union(['5m','15m','30m','1h','4h','1d'].map(Type.Literal))),action:Type.Union(['market','limit','close'].map(Type.Literal)),side:Type.Union(['buy','sell'].map(Type.Literal)),quantity:amount('MT5 lots or QMT integer shares, based on the user intent'),price_limit:amount('Maximum buy/minimum sell executable quote. A market fill can still slip; use a limit order for a hard order-price limit'),limit_price:Type.Optional(amount('Required only for limit orders')),position_id:Type.Optional(Type.String({pattern:'^[1-9]\\d*$',description:'Required MT5 position ticket for close'})),stop_loss:Type.Optional(amount('Optional MT5 stop loss')),take_profit:Type.Optional(amount('Optional MT5 take profit')),
    },(args,signal)=>service.execute(args,signal)),
    define('manual_trade_status','Read a durable receipt; refresh reads the backend command and actual orders/fills for recovery. No matching record never proves a timed-out send failed. Does not replay or place orders.',{operation_id:text('Existing operation ID'),refresh:Type.Optional(Type.Boolean())},(args,signal)=>service.status(args,signal)),
    define('manual_trade_cancel','Request cancellation of a confirmed pending order created through this plugin, using a separate stable operation ID. Does not close a filled position. Query afterwards; cancel_requested is not confirmed cancellation.',{operation_id:Type.String({pattern:'^[A-Za-z0-9_-]{1,100}$'}),original_operation_id:text('Original manual_trade_execute operation'),user_authorized:Type.Literal(true)},(args,signal)=>service.cancel(args,signal)),
  ];
}
