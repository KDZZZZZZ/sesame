import { createService, descriptors } from './service.js';
import { configure, environment } from './configuration.js';

const services = new Map();
function service(host) { const key = host.storage.directory; if (!services.has(key)) services.set(key, createService(host)); return services.get(key); }
export function activate(host) {
  const value = service(host);
  const disposers = descriptors.map(descriptor => host.providers.register(descriptor, value[descriptor.id]));
  return { async dispose() { await value.dispose(); await Promise.allSettled(disposers.map(dispose => dispose())); services.delete(host.storage.directory); } };
}
export function createTools(host) {
  const { define, Type, string } = host.tools;
  const maybePath = Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()]));
  return [
    define('qmt_environment', 'Inspect existing QMT configuration and Python paths without launching or downloading. verify imports the SDK explicitly; prepare first reuses an importable existing SDK and only then installs pinned wheels in a private Windows CPython 3.12 environment. Requires broker-authorized MiniQMT for later reads.', {
      action: Type.Union(['inspect','verify','prepare'].map(x => Type.Literal(x))), python_path: Type.Optional(string('Existing absolute Windows Python executable; prepare requires x64 CPython 3.12 if SDK is missing')), operation_id: Type.Optional(string('Required for explicit preparation; retry the same request with the same key')),
    }, (args, signal) => environment(host, args, signal)),
    define('qmt_configure', 'Save exact existing QMT connection paths and the authorized mainland STOCK account. Uses revision and operation ID; does not launch, log in to or change the broker terminal. Obtain the actual localhost market port from the existing MiniQMT settings.', {
      operation_id: string('Idempotency key'), expected_version: Type.Integer({ minimum: 1 }), changes: Type.Object({ python_path: maybePath, userdata_directory: maybePath, account_id: maybePath, broker: maybePath, market_port: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 65535 }), Type.Null()])), sector: Type.Optional(string('Existing native stock catalog sector; default 沪深京A股')) }, { additionalProperties: false }),
    }, args => configure(host, args)),
    define('qmt_read', 'Perform fixed read-only XtQuant calls on the configured Windows MiniQMT. search/describe/quotes map mainland stocks; asset/positions query the configured STOCK account. orders/fills preserve native fields and cover only the current trading day. None is ambiguous and raises an error. This tool never submits or cancels orders; explicit main-conversation trading tools are separate. No transfer, script execution or terminal launch exists.', {
      action: Type.Union(['search','describe','quotes','asset','positions','orders','fills'].map(x => Type.Literal(x))), query: Type.Optional(Type.String({ maxLength: 100 })), symbols: Type.Optional(Type.Array(Type.String({ pattern: '^\\d{6}\\.(SH|SZ|BJ)$' }), { minItems: 1, maxItems: 50, uniqueItems: true })),
      page: Type.Optional(Type.Object({ limit: Type.Integer({ minimum: 1, maximum: 200 }), cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, { additionalProperties: false, description: 'search/positions/orders/fills use a frozen 60-second snapshot; default 200 rows, repeat unchanged filters with nextCursor' })),
    }, (args, signal) => service(host).native(args.action, { query: args.query ?? '', ...(args.symbols ? { symbols: args.symbols } : {}), ...(args.page ? { page: args.page } : {}) }, signal)),
    define('qmt_download_history', 'Explicitly download a requested unadjusted daily stock range into the already configured MiniQMT data cache. This is a user-requested data preparation action, not an automatic startup download. Reuse local history first.', {
      symbol:Type.String({pattern:'^\\d{6}\\.(SH|SZ|BJ)$'}),start:Type.String({pattern:'^\\d{8}$'}),end:Type.String({pattern:'^\\d{8}$'}),
    },(args,signal)=>service(host).download(args,signal)),
    define('qmt_order', 'Only after an explicit user instruction: submit a limit buy or sell for integer STOCK shares on the exact configured account/revision. Broker permission, T+1 available shares, lot rules, price limits and session rules govern acceptance; submitted does not mean filled. No automatic retry after an unknown outcome. Reuse operation_id for the exact same intent, inspect orders/fills first on failure.', {
      operation_id:Type.String({pattern:'^[A-Za-z0-9_-]{1,100}$'}),user_authorized:Type.Literal(true),account_id:string('Exact authorized account ID'),connection_revision:string('Exact configured connection revision'),symbol:Type.String({pattern:'^\\d{6}\\.(SH|SZ|BJ)$'}),side:Type.Union([Type.Literal('buy'),Type.Literal('sell')]),shares:Type.String({pattern:'^[1-9]\\d*$'}),price:Type.String({pattern:'^(0|[1-9]\\d*)(\\.\\d+)?$'}),
    },(args,signal)=>service(host).command('order',args,signal,host.scope)),
    define('qmt_cancel', 'Only after an explicit user instruction: request cancellation of a previously accepted Sesame order from original_operation_id on the exact account/revision. The native current-day order must still match the original remark. A cancel request is not confirmation; query orders/fills. Unknown intents are never replayed.', {
      operation_id:Type.String({pattern:'^[A-Za-z0-9_-]{1,100}$'}),user_authorized:Type.Literal(true),account_id:string('Exact authorized account ID'),connection_revision:string('Exact configured connection revision'),original_operation_id:string('Accepted qmt_order operation ID'),order_id:Type.String({pattern:'^[1-9]\\d*$'}),
    },(args,signal)=>service(host).command('cancel',args,signal,host.scope)),
  ];
}
