import { check } from '@sesame/plugin-sdk/protocol';
import { accountRef, accountSummary, accountSnapshot, position, metadata } from './mapping.js';

const warning = (code, message) => ({ code, message });
export const accountDescriptor = { id: 'account', contract: 'sesame.account', versions: ['1.0.0'], capabilities: ['accounts.list','account.snapshot','positions.query'], limits: { maxPageSize: 200, accountTypes: ['STOCK'], currencies: ['CNY'], accountScope: 'one explicitly configured account', eventHistory: false } };

export function createAccount(transport, state) {
  const { fixed, account, instrumentSymbol, read, paged, common } = transport;
  const { revised } = state;
  const accounts = { ...common,
    listAccounts: async (input, context) => {
      const c = fixed(context); account(c, accountRef(c));
      return paged(c, 'accounts', {...input,bindingId:context.bindingId}, async () => { const r = await read(c, 'asset', {}, context.signal); return { rows: [accountSummary(c)], meta: metadata(r, [warning('CONFIGURED_ACCOUNT_ONLY', 'Only the explicitly configured account was queried; other logged-in accounts were not enumerated.')]) }; });
    },
    snapshot: async (input, context) => { const c = fixed(context); account(c, input.account); const r = await read(c, 'asset', {}, context.signal); return { data: accountSnapshot(c, r.result.asset, r.sample), meta: metadata(r, [warning('OBSERVATION_TIME', 'Asset asOf is the actual read time; the SDK does not provide a broker snapshot timestamp.')]) }; },
    queryPositions: async (input, context) => {
      const c = fixed(context); account(c, input.account); const symbols = input.instruments?.map(ref => instrumentSymbol(c, ref));
      return paged(c, 'positions', {...input,bindingId:context.bindingId}, async () => { const r = await read(c, 'positions', {}, context.signal); return { rows: r.result.items.filter(row => !symbols || symbols.includes(row.stock_code)).map(row => revised(position(c, row))).sort((a,b) => a.id.localeCompare(b.id)), meta: metadata(r) }; });
    },
  };
  accounts.queryOrders=async()=>check(false,'Native order_time unit is unverified; only raw current-day qmt_read orders is supported','UNSUPPORTED_CAPABILITY');
  accounts.queryFills=async()=>check(false,'Native traded_time unit is unverified; only raw current-day qmt_read fills is supported','UNSUPPORTED_CAPABILITY');
  return accounts;
}
