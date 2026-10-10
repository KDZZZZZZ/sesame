const s = description => ({ type: 'string', description });
const n = description => ({ type: 'number', description });
const i = description => ({ type: 'integer', description });
const b = description => ({ type: 'boolean', description });
const symbol = s('券商品种的精确名称');
const date = s('带时区的 ISO 8601 时间，传入官方 API 前转为 UTC datetime');
const ticket = s('MT5 uint64 ticket 的十进制字符串');
const enumeration = s('官方常量名，例如 TIMEFRAME_M5 / COPY_TICKS_ALL / ORDER_TYPE_BUY，也支持对应整数');
enumeration.type = ['string', 'integer'];
const request = { type: 'object', description: '官方 MqlTradeRequest 字段；action/type/type_time/type_filling 可用官方常量名，ticket 使用字符串。', additionalProperties: false,
  properties: { action: enumeration, magic: ticket, order: ticket, symbol, volume: n('手数'), price: n('价格'), stoplimit: n('StopLimit 价格'), sl: n('止损'), tp: n('止盈'), deviation: i('points'), type: enumeration, type_filling: enumeration, type_time: enumeration, expiration: i('UTC 秒'), comment: s('备注'), position: ticket, position_by: ticket } };
const executionGuard = { type: 'object', additionalProperties: false, description: 'Optional Sesame final-mile guard; checked inside the native worker immediately before order_send. Supports market/limit orders and position reduction only; no retry.', properties: {
  observed_at: i('Original observation UTC milliseconds'), expires_at: i('Decision expiry UTC milliseconds, at most 60 seconds after observation'),
  max_quote_age_ms: {type:'integer',minimum:1,maximum:5000}, max_quote_to_send_ms:{type:'integer',minimum:1,maximum:1000},
  price_limit:s('Maximum buy/minimum sell executable quote; positive decimal text'), side:{type:'string',enum:['buy','sell']}, expected_account:ticket, expected_server:s('Exact broker server'),
}, required:['observed_at','expires_at','max_quote_age_ms','max_quote_to_send_ms','price_limit','side','expected_account','expected_server'] };
const methods = [
  ['initialize', '连接配置的终端；账户和路径由用户设置，不接受 Agent 密码。', {}],
  ['login', '登录用户预先配置的账户。', {}],
  ['shutdown', '断开本应用 Python IPC；不会关闭 MT5 终端。', {}],
  ['version', '当前连接的终端版本。', {}], ['last_error', '上一次官方 API 错误；保持同一 Python 进程。', {}],
  ['account_info', '当前账户详情。', {}], ['terminal_info', '当前终端详情。', {}],
  ['symbols_total', '品种数量。', {}], ['symbols_get', '品种列表。', { group: s('可选组过滤') }],
  ['symbol_info', '品种合约规格。', { symbol }, ['symbol']], ['symbol_info_tick', '最新 tick。', { symbol }, ['symbol']],
  ['symbol_select', '添加或移除 Market Watch 品种。', { symbol, enable: b('是否显示') }, ['symbol', 'enable']],
  ['market_book_add', '订阅盘口，直到 release 或应用关闭。', { symbol }, ['symbol']],
  ['market_book_get', '读取已订阅盘口。', { symbol }, ['symbol']], ['market_book_release', '释放盘口订阅。', { symbol }, ['symbol']],
  ['copy_rates_from', '截至指定 UTC 时间的 K 线。', { symbol, timeframe: enumeration, date_from: date, count: i('1–100000') }, ['symbol', 'timeframe', 'date_from', 'count']],
  ['copy_rates_from_pos', '按位置读取 K 线。', { symbol, timeframe: enumeration, start_pos: i('从当前 bar=0 开始'), count: i('1–100000') }, ['symbol', 'timeframe', 'start_pos', 'count']],
  ['copy_rates_range', 'UTC 区间 K 线。', { symbol, timeframe: enumeration, date_from: date, date_to: date }, ['symbol', 'timeframe', 'date_from', 'date_to']],
  ['copy_ticks_from', '指定 UTC 时间之后的 tick。', { symbol, date_from: date, count: i('1–100000'), flags: enumeration }, ['symbol', 'date_from', 'count', 'flags']],
  ['copy_ticks_range', 'UTC 区间 tick。', { symbol, date_from: date, date_to: date, flags: enumeration }, ['symbol', 'date_from', 'date_to', 'flags']],
  ['orders_total', '当前挂单数量。', {}],
  ['orders_get', '当前挂单；symbol/group/ticket 按官方过滤规则使用。', { symbol, group: s('组过滤'), ticket }],
  ['order_calc_margin', '计算保证金，不发单。', { action: enumeration, symbol, volume: n('手数'), price: n('价格') }, ['action', 'symbol', 'volume', 'price']],
  ['order_calc_profit', '计算盈亏，不发单。', { action: enumeration, symbol, volume: n('手数'), price_open: n('入场价格'), price_close: n('退出价格') }, ['action', 'symbol', 'volume', 'price_open', 'price_close']],
  ['order_check', '检查交易请求；通过不代表订单会成交。', { request }, ['request']],
  ['order_send', '向实际账户提交交易请求；需用户交易意图与实际权限。可选 execution_guard 在原生进程中校验账户、有效期、最新 tick、数量与价格边界，先 order_check 再刷新报价并仅发送一次；返回执行耗时。unknown 不重发。通过 mt5_trade 调用。', { request, execution_guard:executionGuard }, ['request']],
  ['positions_total', '当前持仓数量。', {}], ['positions_get', '当前持仓。', { symbol, group: s('组过滤'), ticket }],
  ['history_orders_total', 'UTC 区间历史订单数量。', { date_from: date, date_to: date }, ['date_from', 'date_to']],
  ['history_orders_get', '历史订单：使用 UTC 起止时间、ticket 或 position。', { date_from: date, date_to: date, group: s('组过滤'), ticket, position: ticket }],
  ['history_deals_total', 'UTC 区间历史成交数量。', { date_from: date, date_to: date }, ['date_from', 'date_to']],
  ['history_deals_get', '历史成交：使用 UTC 起止时间、ticket 或 position。', { date_from: date, date_to: date, group: s('组过滤'), ticket, position: ticket }],
];
export const PYTHON_TOOLS = methods.map(([name, description, properties, required = []]) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }));
