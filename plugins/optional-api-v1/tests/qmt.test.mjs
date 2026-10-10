import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { providerCapabilities, validateRead, validateFinancialData } from '@sesame/plugin-sdk/protocol';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { configure, inspect, environment } from '../packages/qmt/configuration.js';
import { createService, descriptors } from '../packages/qmt/service.js';
import { accountRef, instrumentRef, quote, accountSnapshot, orderStatus, dailyBar } from '../packages/qmt/mapping.js';
import { createTools } from '../packages/qmt/index.js';
import { execute } from '../packages/qmt/worker.js';

function storage(directory) {
  const rows = new Map(), operations = new Map();
  return { directory, get: (kind, id) => structuredClone(rows.get(`${kind}:${id}`)), put(kind, value) { rows.set(`${kind}:${value.id}`, structuredClone(value)); return structuredClone(value); },
    idempotent(key, fingerprint, action) { const prior = operations.get(key); if (prior) { assert.equal(prior.fingerprint, fingerprint, 'Idempotency conflict'); return structuredClone(prior.result); } const result = action(); operations.set(key, { fingerprint, result }); return result; },
  };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qmt-contract-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const python = join(directory, 'python.exe'), userdata = join(directory, 'userdata_mini'); await writeFile(python, 'fixture'); await mkdir(userdata);
  const host = { storage: storage(directory), configuration: { exclusive: fn => fn() }, environment: { executeWorker() { throw new Error('No real SDK calls in a contract fixture'); } } };
  const config = await configure(host, { operation_id: 'configure', expected_version: 1, changes: { python_path: python, userdata_directory: userdata, account_id: '001234567890', market_port: 58610, broker: 'Fixture broker' } });
  return { host, config };
}
const receipt = (result, from = 1700000000000) => ({ ok: true, result, sample: { from, to: from + 10 } });
async function bind(service, kind, id = kind) { return await service[kind].bind({}, { bindingId: id }); }
const tick = { time: '1700000000000', lastPrice: '10.125', bidPrice: ['10.12'], askPrice: ['10.13'], bidVol: ['25'], askVol: ['10'] };

test('QMT manifest/tools agree and declare only implemented capabilities and explicit main tools', async t => {
  const { host } = await fixture(t);
  host.tools = { Type, string: description => Type.String({ description, minLength: 1, maxLength: 20000 }), define: (name, description, properties, execute) => ({ name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) };
  const tools = createTools(host), manifest = JSON.parse(await readFile(new URL('../packages/qmt/plugin.json', import.meta.url)));
  assert.deepEqual(tools.map(tool => tool.name), manifest.tool_names);
  const declared = JSON.parse(await readFile(new URL('../packages/qmt/tools.json', import.meta.url)));
  assert.deepEqual(tools.map(tool => JSON.parse(JSON.stringify(tool.parameters))), declared.map(tool => tool.parameters));
  for (const d of descriptors) providerCapabilities(d.contract, d.capabilities);
  const shape = tools.find(tool => tool.name === 'qmt_read').parameters;
  assert.equal(Value.Check(shape, { action: 'orders' }), true);
  assert.equal(Value.Check(shape, { action: 'order_stock', code: 'anything' }), false);
  assert.equal(Value.Check(shape, { action: 'quotes', symbols: ['600000.SH'] }), true);
});

test('configuration preserves native account IDs, is idempotent and rejects stale changes', async t => {
  const { host, config } = await fixture(t);
  assert.equal(config.account_id, '001234567890'); assert.equal(config.version, 2);
  const args = { operation_id: 'change-sector', expected_version: 2, changes: { sector: '沪深A股' } };
  const next = await configure(host, args); assert.deepEqual(await configure(host, args), next);
  await assert.rejects(configure(host, { ...args, operation_id: 'stale' }), { code: 'STALE_REVISION' });
  assert.equal(inspect(host).sdk_verified, false);
});

test('unsupported platform returns real prerequisites before any SDK process', async t => {
  const { host } = await fixture(t), service = createService(host, { platform: 'darwin' });
  await assert.rejects(bind(service, 'market'), { code: 'PREREQUISITE_REQUIRED' });
  if (process.platform !== 'win32') {
    await assert.rejects(environment(host, { action: 'verify' }), { code: 'PREREQUISITE_REQUIRED' });
    await assert.rejects(execute({ python: '/fixture', action: 'verify' }, { directory: host.storage.directory }), { code: 'PREREQUISITE_REQUIRED' });
  }
});

test('catalog pages freeze the native snapshot and bind cursors to exact filters', async t => {
  const { host, config } = await fixture(t); let calls = 0, clock = 0;
  const service = createService(host, { platform: 'win32', now: () => clock, request: async () => { calls++; return receipt({ items: [{ symbol: '600000.SH', name: '浦发' }, { symbol: '000001.SZ', name: '平安' }] }); } });
  t.after(() => service.dispose()); await bind(service, 'market');
  const first = await service.market.searchInstruments({ query: '', page: { limit: 1 } }, { bindingId: 'market' });
  assert.equal(first.data.items[0].ref.sourceId, `qmt:${config.connection_id}`); assert.equal(first.meta.warnings.some(x => x.code === 'PARTIAL_CATALOG'), true);
  const second = await service.market.searchInstruments({ query: '', page: { limit: 2, cursor: first.data.nextCursor } }, { bindingId: 'market' });
  assert.equal(calls, 1); assert.equal(second.data.snapshotId, first.data.snapshotId); assert.equal(second.data.items.length, 1);
  await assert.rejects(service.market.searchInstruments({ query: 'x', page: { limit: 1, cursor: first.data.nextCursor } }, { bindingId: 'market' }), { code: 'INVALID_CURSOR' });
  clock = 61000;
  await assert.rejects(service.market.searchInstruments({ query: '', page: { limit: 1, cursor: first.data.nextCursor } }, { bindingId: 'market' }), { code: 'CURSOR_EXPIRED' });
});

test('late responses and old bindings are rejected after account configuration changes', async t => {
  const { host } = await fixture(t); let finish;
  const service = createService(host, { platform: 'win32', request: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => service.dispose()); await bind(service, 'market');
  const pending = service.market.searchInstruments({ query: '', page: { limit: 20 } }, { bindingId: 'market' });
  await configure(host, { operation_id: 'switch', expected_version: 2, changes: { account_id: '009999' } });
  finish(receipt({ items: [] })); await assert.rejects(pending, { code: 'CONNECTION_CHANGED' });
  await assert.rejects(service.market.searchInstruments({ query: '', page: { limit: 20 } }, { bindingId: 'market' }), { code: 'CONNECTION_CHANGED' });
});

test('quote source time, zero prices and unverified depth units remain distinct', async t => {
  const { config } = await fixture(t);
  const q = quote(config, { symbol: '600000.SH', tick: { ...tick, bidPrice: ['0'] } });
  assert.equal(q.time.unixMs, 1700000000000); assert.equal(q.bid.status, 'unknown'); assert.equal(q.bidSize.status, 'unknown'); assert.equal(q.last.value, '10.125');
  const wall = quote(config, { symbol: '600000.SH', tick: { timetag: '20261009 10:01:02.003', lastPrice: '10' } });
  assert.equal(wall.time.basis, 'wall'); assert.equal(wall.time.value, '2026-10-09T10:01:02.003');
  assert.throws(() => quote(config, { symbol: '600000.SH', tick: { lastPrice: '10' } }), { code: 'SOURCE_DATA_INVALID' });
});

test('quote subscription emits only after ready, revises corrections, serializes reads and closes owned polling', async t => {
  const { host, config } = await fixture(t); let calls = 0, active = 0, peak = 0;
  const service = createService(host, { platform: 'win32', pollMs: 5, request: async () => {
    active++; peak = Math.max(peak, active); const price = calls++ < 2 ? '10' : '11';
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return receipt({ items: [{ symbol: '600000.SH', tick: { ...tick, lastPrice: price } }] });
  } });
  t.after(() => service.dispose()); await bind(service, 'market');
  const handle = await service.market.subscribeQuotes({ instruments: [instrumentRef(config, '600000.SH')] }, { bindingId: 'market' });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1);
  let delivered; const event = new Promise(resolve => { handle.ready(value => { delivered = value; resolve(); }); });
  await Promise.race([event, new Promise((_, reject) => setTimeout(() => reject(new Error('No quote correction')), 1000).unref())]);
  assert.equal(delivered.type, 'quotes.upsert'); assert.equal(delivered.seq, '1'); assert.equal(delivered.payload.quotes[0].revision, '1'); assert.equal(delivered.payload.quotes[0].time.unixMs, 1700000000000); assert.equal(peak, 1);
  await handle.close(); const count = calls; await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, count); assert.equal(active, 0);
});

test('zero cash is real while missing balance and P&L remain unknown; shares and integer account identities persist', async t => {
  const { host, config } = await fixture(t);
  const service = createService(host, { platform: 'win32', request: async args => args.action === 'asset' ? receipt({ asset: { account_id: config.account_id, cash: '0', total_asset: '123.456' } }) : receipt({ items: [{ account_id: config.account_id, stock_code: '600000.SH', volume: '9007199254740993', can_use_volume: '0', avg_price: '10.001' }] }) });
  t.after(() => service.dispose()); await bind(service, 'account');
  const result = await service.account.snapshot({ account: accountRef(config) }, { bindingId: 'account' });
  validateRead(result, descriptors[1], 'fixture', { id: config.connection_id, revision: '2' }); validateFinancialData(result.data);
  assert.deepEqual(result.data.available.value, { value: '0', currency: 'CNY' }); assert.equal(result.data.balance.status, 'unknown'); assert.equal(result.data.unrealizedPnl.status, 'unknown'); assert.equal(result.data.margin.used.status, 'not_applicable');
  const positions = await service.account.queryPositions({ account: accountRef(config), page: { limit: 20 } }, { bindingId: 'account' });
  validateFinancialData(positions.data); assert.equal(positions.data.items[0].quantity.value, '9007199254740993'); assert.equal(positions.data.items[0].availableQuantity.value.value, '0');
  await assert.rejects(service.account.snapshot({ account: { ...accountRef(config), accountId: 'other' } }, { bindingId: 'account' }), { code: 'INVALID_ARGUMENT' });
});

test('ambiguous native lists stay errors; raw orders preserve time, price type and day-only coverage', async t => {
  const { host } = await fixture(t);
  const service = createService(host, { platform: 'win32', request: async args => {
    if (args.action === 'positions') throw Object.assign(new Error('None is ambiguous'), { code: 'AMBIGUOUS_SOURCE_RESULT' });
    return receipt({ items: [{ order_id: '9007199254740993', order_time: '93001', price_type: '999' }], coverage: { scope: 'current_trading_day', complete_history: false, raw_time_unit: 'source_native_uninterpreted' } });
  } });
  t.after(() => service.dispose());
  await assert.rejects(service.native('positions', {}), { code: 'AMBIGUOUS_SOURCE_RESULT' });
  const result = await service.native('orders', {}); assert.equal(result.items[0].order_id, '9007199254740993'); assert.equal(result.items[0].order_time, '93001'); assert.equal(result.coverage.complete_history, false);
  assert.equal(result.nextCursor, null); assert.equal(result.consistency, 'snapshot');
  await assert.rejects(service.native('order_stock', {}), { code: 'UNSUPPORTED_CAPABILITY' });
});

test('raw order pagination preserves a frozen list and its current-day coverage', async t => {
  const { host } = await fixture(t); let reads = 0;
  const service = createService(host, { platform: 'win32', request: async () => { reads++; return receipt({ items: [{ order_id: '1' }, { order_id: '2' }], coverage: { scope: 'current_trading_day', complete_history: false } }); } });
  t.after(() => service.dispose());
  const first = await service.native('orders', { page: { limit: 1 } });
  const next = await service.native('orders', { page: { limit: 1, cursor: first.nextCursor } });
  assert.equal(reads, 1); assert.equal(next.items[0].order_id, '2'); assert.equal(next.snapshotId, first.snapshotId); assert.deepEqual(next.coverage, first.coverage);
});

const dailySpec={timeframe:'1d',priceBasis:'last',adjustment:'none',session:'regular',calendarRevision:{status:'unknown'}};
const at=text=>Date.parse(text+'+08:00');
const dailyRow=(date,close='10')=>({time:String(at(date+'T00:00:00')),open:'9',high:'11',low:'8',close,volume:'100'});
test('daily history uses fixed source OHLC, exact half-open bounds and frozen pages; no implicit downloads',async t=>{
  const {host,config}=await fixture(t);const calls=[];
  const service=createService(host,{platform:'win32',request:async p=>{calls.push(p);return receipt({items:[dailyRow('2026-10-08'),dailyRow('2026-10-09')],tick:{...tick,time:String(at('2026-10-09T10:00:00')),open:'9',high:'11',low:'8',lastPrice:'10.5',volume:'150'},coverage:{complete_history:false}},at('2026-10-09T10:00:00'));}});t.after(()=>service.dispose());await bind(service,'market');
  const input={instrument:instrumentRef(config,'600000.SH'),spec:dailySpec,range:{from:{basis:'wall',authority:'Asia/Shanghai',value:'2026-10-08T09:30:00'},to:{basis:'wall',authority:'Asia/Shanghai',value:'2026-10-10T00:00:00'}},includeForming:true,page:{limit:1}};
  const first=await service.market.queryBars(input,{bindingId:'market'});assert.equal(first.data.page.items[0].isClosed,true);assert.equal(calls[0].action,'bars');
  const second=await service.market.queryBars({...input,page:{limit:1,cursor:first.data.page.nextCursor}},{bindingId:'market'});
  assert.equal(calls.length,1);assert.equal(second.data.page.items[0].close,'10.5');assert.equal(second.data.page.items[0].isClosed,false);assert.equal(second.data.page.items[0].volume.real.status,'unknown');validateFinancialData(second.data);
  await bind(service,'market','other');await assert.rejects(service.market.queryBars({...input,page:{limit:1,cursor:first.data.page.nextCursor}},{bindingId:'other'}),{code:'INVALID_CURSOR'});
  await assert.rejects(service.market.queryBars({...input,spec:{...dailySpec,timeframe:'1m'}},{bindingId:'market'}),{code:'UNSUPPORTED_CAPABILITY'});
  const excluded=await service.market.queryBars({...input,includeForming:false,page:{limit:200}},{bindingId:'market'});assert.equal(excluded.data.page.items.length,1);
});
test('daily polling produces real forming corrections and unbind closes only that binding',async t=>{
  const {host,config}=await fixture(t);let calls=0;
  const service=createService(host,{platform:'win32',now:()=>at('2026-10-09T10:00:00'),pollMs:5,request:async()=>receipt({items:[dailyRow('2026-10-08')],tick:{...tick,time:String(at('2026-10-09T10:00:00')),open:'9',high:'11',low:'8',lastPrice:calls++?'10.5':'10',volume:'100'}},at('2026-10-09T10:00:00'))});t.after(()=>service.dispose());await bind(service,'market');
  const stream=await service.market.subscribeBars({instrument:instrumentRef(config,'600000.SH'),spec:dailySpec,tailLimit:2,includeForming:true},{bindingId:'market'});
  assert.equal(stream.snapshot.bars.length,2);let event;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No bar correction')),1000);stream.ready(e=>{event=e;clearTimeout(timer);resolve()})});
  assert.equal(event.type,'bars.upsert');assert.equal(event.payload.bars.at(-1).close,'10.5');await service.market.unbind({bindingId:'market'});const before=calls;await new Promise(r=>setTimeout(r,20));assert.equal(calls,before);
});
test('unverified native order/fill time rejects normalized contracts; raw day-only reads remain available',async t=>{
 const {host,config}=await fixture(t);let calls=0;const service=createService(host,{platform:'win32',request:async()=>{calls++;return receipt({items:[{order_id:'9007199254740993',order_time:'93001'}],coverage:{scope:'current_trading_day',complete_history:false}})}});t.after(()=>service.dispose());
 assert.equal(descriptors[1].capabilities.includes('orders.query'),false);assert.equal(descriptors[1].capabilities.includes('fills.query'),false);
 for(const method of ['queryOrders','queryFills'])await assert.rejects(service.account[method]({account:accountRef(config),page:{limit:1}}),{code:'UNSUPPORTED_CAPABILITY'});
 assert.equal(calls,0);const raw=await service.native('orders',{});assert.equal(raw.items[0].order_time,'93001');assert.equal(raw.coverage.complete_history,false);
 for(const status of ['51','52'])assert.equal(orderStatus(status),'cancel_pending');
});
test('explicit trading intents persist before transport, reuse exact results and never replay unknown outcomes',async t=>{
  const {host,config}=await fixture(t);host.scope={kind:'main'};let calls=0,fail=false;
  const service=createService(host,{platform:'win32',request:async p=>{calls++;assert.equal(host.storage.get('qmt_commands',p.operation_id).status,'outcome_unknown');if(fail)throw Object.assign(Error('socket disconnected'),{code:'SOURCE_UNAVAILABLE'});return receipt({status:p.action==='order'?'submitted':'cancel_requested',order_id:'123',execution_confirmed:false})}});t.after(()=>service.dispose());
  const args={operation_id:'buy1',user_authorized:true,account_id:config.account_id,connection_revision:'2',symbol:'600000.SH',side:'buy',shares:'100',price:'10.1'};
  const result=await service.command('order',args);assert.equal(result.status,'submitted');assert.deepEqual(await service.command('order',args),result);assert.equal(calls,1);
  await assert.rejects(service.command('order',{...args,shares:'200'}),{code:'IDEMPOTENCY_CONFLICT'});
  const cancel=await service.command('cancel',{operation_id:'cancel1',user_authorized:true,account_id:config.account_id,connection_revision:'2',original_operation_id:'buy1',order_id:'123'});assert.equal(cancel.status,'cancel_requested');
  fail=true;await assert.rejects(service.command('order',{...args,operation_id:'unknown'}));assert.equal((await service.command('order',{...args,operation_id:'unknown'})).status,'outcome_unknown');assert.equal(calls,3);
  const reopened=createService(host,{platform:'win32',request:async()=>{throw Error('MUST NOT REPLAY')}});t.after(()=>reopened.dispose());assert.equal((await reopened.command('order',{...args,operation_id:'unknown'})).status,'outcome_unknown');
  for(const changes of [{shares:'1.5'},{shares:'0'},{shares:'2147483648'},{price:'NaN'},{side:'short'},{user_authorized:false},{account_id:'other'}])await assert.rejects(service.command('order',{...args,operation_id:'bad',...changes}));assert.equal(calls,3);
  host.scope.kind='child';await assert.rejects(service.command('order',{...args,operation_id:'child'}),{code:'FORBIDDEN'});
});

test('activation service context cannot authorize trading; current tool scope is checked explicitly',async t=>{
 const {host,config}=await fixture(t);host.scope={kind:'service'};let calls=0;const service=createService(host,{platform:'win32',request:async()=>{calls++;return receipt({status:'submitted',order_id:'1'})}});t.after(()=>service.dispose());const args={operation_id:'scope',user_authorized:true,account_id:config.account_id,connection_revision:'2',symbol:'600000.SH',side:'buy',shares:'100',price:'10'};await assert.rejects(service.command('order',args),{code:'FORBIDDEN'});assert.equal((await service.command('order',args,undefined,{kind:'main'})).status,'submitted');assert.equal(calls,1);await assert.rejects(service.command('order',{...args,operation_id:'child'},undefined,{kind:'child'}),{code:'FORBIDDEN'});
});
test('cancelling an unknown QMT order carries only its retained original intent for native recovery',async t=>{
 const {host,config}=await fixture(t);host.scope={kind:'main'};let orders=0,cancels=0;
 const service=createService(host,{platform:'win32',request:async payload=>{
   if(payload.action==='order'){orders++;throw Object.assign(Error('lost receipt'),{code:'SOURCE_UNAVAILABLE'});}
   cancels++;assert.deepEqual(payload.original_intent,{symbol:'600000.SH',side:'buy',shares:'100',price:'10'});
   assert.equal(payload.remark,host.storage.get('qmt_commands','unknown').remark);
   return receipt({status:'cancel_requested',order_id:'123'});
 }});t.after(()=>service.dispose());
 const original={operation_id:'unknown',user_authorized:true,account_id:config.account_id,connection_revision:'2',symbol:'600000.SH',side:'buy',shares:'100',price:'10'};
 await assert.rejects(service.command('order',original));
 const args={operation_id:'recovered-cancel',user_authorized:true,account_id:config.account_id,connection_revision:'2',original_operation_id:'unknown',order_id:'123'};
 const result=await service.command('cancel',args);assert.equal(result.status,'cancel_requested');assert.deepEqual(await service.command('cancel',args),result);assert.equal(orders,1);assert.equal(cancels,1);
 const prior=host.storage.get('qmt_commands','unknown');delete prior.intent;host.storage.put('qmt_commands',prior);
 await assert.rejects(service.command('cancel',{...args,operation_id:'unverifiable-legacy'}),{code:'INVALID_ARGUMENT'});assert.equal(cancels,1);
});
test('QMT cancellation survives a same-account configuration revision but cannot cross account ownership',async t=>{
 const {host,config}=await fixture(t);host.scope={kind:'main'};let cancels=0;
 const service=createService(host,{platform:'win32',request:async payload=>{
   if(payload.action==='order')throw Object.assign(Error('lost receipt'),{code:'SOURCE_UNAVAILABLE'});
   cancels++;assert.equal(payload.account_id,config.account_id);assert.equal(payload.config.version,3);
   return receipt({status:'cancel_requested',order_id:'123'});
 }});t.after(()=>service.dispose());
 const original={operation_id:'unknown-account',user_authorized:true,account_id:config.account_id,connection_revision:'2',symbol:'600000.SH',side:'buy',shares:'100',price:'10'};
 await assert.rejects(service.command('order',original));
 assert.equal(service.commandRecord(original.operation_id).accountId,config.account_id);
 await configure(host,{operation_id:'same-account-update',expected_version:2,changes:{sector:'沪深A股'}});
 const cancel={operation_id:'new-revision-cancel',user_authorized:true,account_id:config.account_id,connection_revision:'3',original_operation_id:original.operation_id,order_id:'123'};
 assert.equal((await service.command('cancel',cancel)).status,'cancel_requested');assert.equal(cancels,1);
 const saved=host.storage.get('qmt_commands',original.operation_id),legacy={...saved};delete legacy.accountId;host.storage.put('qmt_commands',legacy);
 await assert.rejects(service.command('cancel',{...cancel,operation_id:'legacy-without-account'}),{code:'INVALID_ARGUMENT'});assert.equal(cancels,1);
 host.storage.put('qmt_commands',saved);
 await configure(host,{operation_id:'different-account',expected_version:3,changes:{account_id:'009999999999'}});
 await assert.rejects(service.command('cancel',{...cancel,operation_id:'foreign-account',account_id:'009999999999',connection_revision:'4'}),{code:'INVALID_ARGUMENT'});assert.equal(cancels,1);
});

test('native execution guard is passed unchanged, durable pre-send rejection is queryable and never replayed',async t=>{
 const {host,config}=await fixture(t);host.scope={kind:'service'};let calls=0;
 const execution_guard={observed_at:1700000000000,expires_at:1700000060000,max_quote_age_ms:5000,max_quote_to_send_ms:1000,price_limit:'10.2'};
 const service=createService(host,{platform:'win32',request:async payload=>{calls++;assert.deepEqual(payload.execution_guard,execution_guard);throw Object.assign(Error('expired fixture'),{code:'SIGNAL_EXPIRED',details:{submission_attempted:false}});}});t.after(()=>service.dispose());
 const args={operation_id:'expired-guard',user_authorized:true,account_id:config.account_id,connection_revision:'2',symbol:'600000.SH',side:'buy',shares:'100',price:'10',execution_guard};
 await assert.rejects(service.command('order',args,undefined,{kind:'main'}),{code:'SIGNAL_EXPIRED'});
 assert.equal(service.commandRecord(args.operation_id,{kind:'main'}).status,'rejected');
 assert.equal((await service.command('order',args,undefined,{kind:'main'})).status,'rejected');assert.equal(calls,1);
 assert.throws(()=>service.commandRecord(args.operation_id,{kind:'child'}),{code:'FORBIDDEN'});
});

test('backward pages select newest data but stay ascending, published wall authority works and stale source never proves closure',async t=>{
 const {host,config}=await fixture(t);const data={items:[dailyRow('2026-10-01'),dailyRow('2026-10-08')],tick:{...tick,time:String(at('2026-10-09T14:00:00')),open:'9',high:'11',low:'8',lastPrice:'10',volume:'100'}};
 const service=createService(host,{platform:'win32',request:async()=>receipt(data,at('2026-10-09T15:05:00'))});t.after(()=>service.dispose());await bind(service,'market');
 const wall=value=>({basis:'wall',authority:'Asia/Shanghai',zone:'Asia/Shanghai',value});const args={instrument:instrumentRef(config,'600000.SH'),spec:dailySpec,range:{from:wall('2026-10-01T00:00:00'),to:wall('2026-10-10T00:00:00')},includeForming:true,direction:'backward',page:{limit:2}};
 const first=await service.market.queryBars(args,{bindingId:'market'});assert.deepEqual(first.data.page.items.map(b=>b.openTime.value.slice(0,10)),['2026-10-08','2026-10-09']);assert.equal(first.data.page.items[1].isClosed,false);assert.equal(first.data.page.items[1].closure,'unknown');assert.equal(first.data.page.items[1].volume.default,'none');assert.equal(first.data.page.items[1].turnover.status,'unknown');assert.deepEqual(first.data.instrument,args.instrument);assert.deepEqual(first.data.spec,args.spec);assert.equal(first.data.coverage.complete,false);assert.deepEqual(first.data.coverage.requested,args.range);
 const second=await service.market.queryBars({...args,page:{limit:1,cursor:first.data.page.nextCursor}},{bindingId:'market'});assert.equal(second.data.page.items[0].openTime.value,'2026-10-01T09:30:00');
 assert.equal(dailyBar(dailyRow('2026-10-08'),'sample',at('2026-10-10T00:00:00')).isClosed,false);
});

test('old full-tick cannot replace a completed historical day and UTC fractional bounds stay exact',async t=>{
 const {host,config}=await fixture(t);const service=createService(host,{platform:'win32',request:async p=>receipt({items:p.end==='20261009'?[dailyRow('2026-10-08','10.8')]:[dailyRow('2026-10-08','10.8'),dailyRow('2026-10-09','11')],tick:{...tick,time:String(at('2026-10-08T14:00:00')),open:'9',high:'10',low:'8',lastPrice:'9.2',volume:'100'}},at('2026-10-09T15:05:00'))});t.after(()=>service.dispose());await bind(service,'market');
 const args={instrument:instrumentRef(config,'600000.SH'),spec:dailySpec,range:{from:{basis:'utc',unixMs:at('2026-10-08T09:30:00')},to:{basis:'utc',unixMs:at('2026-10-10T00:00:00')}},includeForming:true,page:{limit:20}};
 const all=await service.market.queryBars(args,{bindingId:'market'});assert.equal(all.data.page.items[0].close,'10.8');assert.equal(all.data.page.items[0].isClosed,true);
 const after=await service.market.queryBars({...args,range:{...args.range,from:{basis:'utc',unixMs:at('2026-10-09T09:30:00')+1}}},{bindingId:'market'});assert.equal(after.data.page.items.length,0);
 const narrow=await service.market.queryBars({...args,range:{...args.range,to:{basis:'utc',unixMs:at('2026-10-09T00:00:00')}}},{bindingId:'market'});assert.equal(narrow.data.page.items[0].close,'10.8');
});

test('bounded revision cache never rewinds a live revision or loses a confirmed closed-day boundary',async t=>{
 const {host,config}=await fixture(t);let price='10',history=false,empty=false,corrected=false;
 const service=createService(host,{platform:'win32',request:async p=>receipt({items:empty?[]:history?Array.from({length:2100},(_,i)=>dailyRow(new Date(Date.UTC(2018,0,1+i)).toISOString().slice(0,10))):[dailyRow('2026-10-08',corrected?'10.9':'10.8'),...(corrected?[]:[dailyRow('2026-10-09')])],tick:{...tick,time:String(at(empty?'2026-10-08T14:00:00':'2026-10-09T14:00:00')),open:'9',high:'11',low:'8',lastPrice:price,volume:'100'}},at('2026-10-09T15:05:00'))});t.after(()=>service.dispose());await bind(service,'market');
 const args={instrument:instrumentRef(config,'600000.SH'),spec:dailySpec,range:{from:{basis:'utc',unixMs:at('2018-01-01T00:00:00')},to:{basis:'utc',unixMs:at('2027-01-01T00:00:00')}},includeForming:true,direction:'backward',page:{limit:2}};
 await service.market.queryBars(args,{bindingId:'market'});price='10.5';const prior=(await service.market.queryBars(args,{bindingId:'market'})).data.page.items.at(-1).revision;
 history=true;for(let i=0;i<10;i++)await service.market.queryBars({...args,instrument:instrumentRef(config,`${600001+i}.SH`)},{bindingId:'market'});
 history=false;price='10.7';const after=await service.market.queryBars(args,{bindingId:'market'});assert.ok(BigInt(after.data.page.items.at(-1).revision)>BigInt(prior));
 corrected=true;const correction=await service.market.queryBars({...args,includeForming:false,range:{from:{basis:'utc',unixMs:at('2026-10-08T00:00:00')},to:{basis:'utc',unixMs:at('2026-10-09T00:00:00')}}},{bindingId:'market'});assert.equal(correction.data.page.items[0].close,'10.9');assert.equal(correction.data.page.items[0].isClosed,true);
 empty=true;const narrow=await service.market.queryBars({...args,range:{from:{basis:'utc',unixMs:at('2026-10-08T00:00:00')},to:{basis:'utc',unixMs:at('2026-10-09T00:00:00')}}},{bindingId:'market'});assert.equal(narrow.data.page.items.length,0,'an evicted closed row is not fabricated from an old tick');
});
