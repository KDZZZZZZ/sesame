import { requireValue } from './support.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const epoch = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000;

/** Validate the native worker's clock proof; conversion and rule selection stay in Python. */
export function verifiedQuoteClock(tick, clock, account) {
  requireValue(object(clock) && clock.status !== 'unverified',
    'MT5 报价时间基准尚未验证；不能用原始服务器墙钟判断报价时效', 503, 'QUOTE_CLOCK_UNVERIFIED');
  requireValue(clock.status === 'verified' && clock.source === 'mt5/python/symbol_info_tick' && ['utc', 'server-wall'].includes(clock.basis)
    && text(clock.accountId) && text(clock.server) && text(clock.ruleId) && text(clock.ruleRevision) && clock.ruleRevision.length <= 128
    && epoch(tick?.time_msc) && clock.rawTimeMs === tick.time_msc && epoch(clock.sourceTimeMs)
    && Number.isInteger(clock.offsetMinutes) && Math.abs(clock.offsetMinutes) <= 840 && (clock.basis !== 'utc' || clock.offsetMinutes === 0)
    && clock.sourceTimeMs === clock.rawTimeMs - clock.offsetMinutes * 60000,
    'MT5 报价时间证明缺失必要来源或与原始 tick 不一致', 503, 'SOURCE_DATA_INVALID');
  requireValue(clock.accountId === account.accountId && clock.server === account.server,
    'MT5 报价时间证明与本次绑定的账户或服务器不一致', 409, 'ACCOUNT_MISMATCH');
  return clock;
}
