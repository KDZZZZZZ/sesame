import { randomUUID } from 'node:crypto';
import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';
import { configuration, prerequisite } from './configuration.js';
import { accountRef, accountSummary, accountSnapshot, instrumentRef, summary, instrument, quote, position, order, fill, dailyBar, metadata } from './mapping.js';

const warning = (code, message) => ({ code, message });
export const descriptors = [
  { id: 'market', contract: 'sesame.market', versions: ['1.0.0'], capabilities: ['instruments.search','instruments.describe','quotes.subscribe','bars.history','bars.subscribe'], limits: { transportMode: 'poll', minPollIntervalMs: 1000, maxPageSize: 200, maxInstrumentsPerSubscription: 50, resumable: false, catalogScope: 'configured native mainland stock sector', timeframes: ['1d'], priceBases: ['last'], adjustments: ['none'] } },
  { id: 'account', contract: 'sesame.account', versions: ['1.0.0'], capabilities: ['accounts.list','account.snapshot','positions.query','orders.query','fills.query'], limits: { maxPageSize: 200, accountTypes: ['STOCK'], currencies: ['CNY'], accountScope: 'one explicitly configured account', eventHistory: false } },
];

/** Test injection supplies only the fixed query boundary, never a runtime/store object. */
export function createService(host, { platform = process.platform, now = Date.now, pollMs = 1000, request } = {}) {
  const bindings = new Map(), pages = new Map(), revisions = new Map(), streams = new Set(), lifetime = new AbortController();
  request ??= (payload, signal) => host.environment.executeWorker('worker.js', payload, { signal, timeoutMs: 30000 });
  const storedCommand=id=>{try{return host.storage.get('qmt_commands',id)}catch(error){if(error.code==='not_found'||error.code==='NOT_FOUND')return undefined;throw error}};
  const current = () => {
    if (platform !== 'win32') prerequisite(host, 'Use this plugin on native Windows x64 with broker-authorized MiniQMT; macOS and Linux are not QMT hosts');
    const c = configuration(host);
    if (!c.connection_id || !c.python_path) prerequisite(host, 'Inspect and configure an existing compatible Windows Python first');
    return c;
  };
  const connection = c => ({ id: c.connection_id, revision: String(c.version) });
  const fixed = context => {
    const c = current(), bound = bindings.get(context.bindingId);
    check(bound && canonical(bound) === canonical(connection(c)), 'QMT connection configuration changed; bind again', 'CONNECTION_CHANGED');
    return c;
  };
  const instrumentSymbol = (c, ref) => { check(ref?.sourceId === `qmt:${c.connection_id}` && /^\d{6}\.(SH|SZ|BJ)$/.test(ref?.instrumentId ?? ''), 'Instrument belongs to a different source or unsupported market', 'INVALID_ARGUMENT'); return ref.instrumentId; };
  const account = (c, ref) => { check(c.account_id && c.userdata_directory, 'Configure the authorized STOCK account and userdata_mini directory', 'PREREQUISITE_REQUIRED'); check(canonical(ref) === canonical(accountRef(c)), 'Account does not match the configured connection', 'INVALID_ARGUMENT'); };
  async function read(c, action, args, signal) {
    const result = await request({ action, python: c.python_path, config: c, ...args }, AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]));
    check(canonical(connection(configuration(host))) === canonical(connection(c)), 'A late native response cannot cross a configuration change', 'CONNECTION_CHANGED');
    check(result.ok === true && Number.isFinite(result.sample?.from) && Number.isFinite(result.sample?.to) && result.sample.from <= result.sample.to, 'QMT returned an invalid read receipt', 'SOURCE_DATA_INVALID');
    return result;
  }
  function revised(item) {
    const hash = digest(item), key = item.id, prior = revisions.get(key);
    const revision = prior ? (prior.hash === hash ? prior.revision : String(BigInt(prior.revision) + 1n)) : '0';
    while(revisions.size >= 20000 && !revisions.has(key)) revisions.delete(revisions.keys().next().value);
    revisions.set(key, { hash, revision }); return { ...item, revision };
  }
  async function paged(c, method, input, load) {
    const limit = input.page?.limit;
    check(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'page.limit must be 1–200', 'INVALID_ARGUMENT');
    const filter = { ...input }; delete filter.page;
    const signature = digest({ method, connection: connection(c), filter });
    for (const [key, value] of pages) if (now() - value.at > 60000) pages.delete(key);
    let snapshot, offset = 0;
    if (input.page.cursor) {
      const cursor = pages.get(input.page.cursor);
      check(cursor, 'QMT cursor expired; request a new snapshot', 'CURSOR_EXPIRED');
      check(cursor.signature === signature, 'Cursor filters or connection changed', 'INVALID_CURSOR');
      ({ snapshot, offset } = cursor);
    } else {
      const { rows, meta, extra } = await load();
      check(rows.length <= 20000 && Buffer.byteLength(canonical(rows)) <= 8 * 1024 * 1024, 'Native snapshot exceeds budget', 'RESOURCE_EXHAUSTED');
      snapshot = { id: randomUUID(), rows, meta, extra };
    }
    let nextCursor = null;
    if (offset + limit < snapshot.rows.length) {
      while (pages.size >= 64) pages.delete(pages.keys().next().value);
      nextCursor = randomUUID(); pages.set(nextCursor, { bindingId:input.bindingId, at: now(), signature, snapshot, offset: offset + limit });
    }
    if(input.bindingId) fixed({bindingId:input.bindingId});
    return structuredClone({ data: { items: snapshot.rows.slice(offset, offset + limit), nextCursor, snapshotId: snapshot.id, consistency: 'snapshot' }, meta: snapshot.meta, ...(snapshot.extra ?? {}) });
  }
  function rangeDate(time) {
    if(time?.basis === 'utc') { check(Number.isSafeInteger(time.unixMs), 'Invalid UTC bound', 'INVALID_ARGUMENT'); return new Date(time.unixMs+8*3600000).toISOString().slice(0,19); }
    check(time?.basis === 'wall' && time.authority === 'Asia/Shanghai' && time.fold === undefined && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(time.value), 'Use UTC or unambiguous Asia/Shanghai wall bounds', 'UNSUPPORTED_CAPABILITY');
    check(new Date(time.value+'Z').toISOString().slice(0,19) === time.value, 'Invalid wall bound', 'INVALID_ARGUMENT'); return time.value;
  }
  function specCheck(input) {
    check(input.spec?.timeframe === '1d' && input.spec.priceBasis === 'last' && input.spec.adjustment === 'none' && ['regular','default'].includes(input.spec.session), 'Only unadjusted regular daily stock bars are supported', 'UNSUPPORTED_CAPABILITY');
    check(input.spec.calendarRevision?.status !== 'value', 'No fixed QMT calendar revision is provided', 'UNSUPPORTED_CAPABILITY');
  }
  async function barSnapshot(input, context) {
    const c = fixed(context); specCheck(input);
    const symbol = instrumentSymbol(c,input.instrument), from = rangeDate(input.range.from), to = rangeDate(input.range.to);
    check(from <= to && Date.parse(to)-Date.parse(from) <= 10*366*86400000, 'Daily range exceeds ten years', 'INVALID_ARGUMENT');
    const seriesId = digest({connection:connection(c),instrument:input.instrument,spec:input.spec});
    const r = await read(c,'bars',{symbols:[symbol],start:from.slice(0,10).replaceAll('-',''),end:to.slice(0,10).replaceAll('-',''),forming:!!input.includeForming},context.signal);
    const native = [...r.result.items];
    if(input.includeForming && r.result.tick) {
      const tick = r.result.tick, sourceTime = quote(c,{symbol,tick}).time;
      check(sourceTime.basis === 'utc', 'Forming daily row needs native epoch time', 'UNSUPPORTED_CAPABILITY');
      const date = new Date(sourceTime.unixMs+8*3600000).toISOString().slice(0,10);
      if(date >= from.slice(0,10) && date <= to.slice(0,10)) {
        const replacement={time:String(sourceTime.unixMs),open:tick.open,high:tick.high,low:tick.low,close:tick.lastPrice,volume:tick.volume};
        const at=native.findIndex(row=>new Date(Number(row.time)+8*3600000).toISOString().slice(0,10)===date);
        if(at>=0)native[at]=replacement;else native.push(replacement);
      }
    }
    const rows=native.map(row=>revised(dailyBar(row,seriesId,r.sample.to))).filter(bar=>bar.openTime.value>=from && bar.openTime.value<to && (input.includeForming || bar.isClosed)).sort((a,b)=>a.openTime.value.localeCompare(b.openTime.value));
    check(new Set(rows.map(x=>x.id)).size===rows.length,'Duplicate native daily rows','SOURCE_DATA_INVALID');
    return {rows,meta:metadata(r,[warning('LOCAL_HISTORY','Only existing cached daily data is read. Empty data does not prove complete coverage; explicitly download missing ranges.'),warning('DAILY_POLL','Daily OHLC uses native source timestamps. No minute bars or native volume units are inferred.')]),extra:{seriesId,coverage:r.result.coverage}};
  }
  async function pollBars(input,context) {
    check(!input.resumeToken,'Resume requires a new snapshot','UNSUPPORTED_CAPABILITY');
    check(Number.isInteger(input.tailLimit)&&input.tailLimit>0&&input.tailLimit<=2000,'tailLimit must be 1–2000','INVALID_ARGUMENT');
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,lifetime.signal,...(context.signal?[context.signal]:[])]);
    const fetch=async()=> {const utc=now();const result=await barSnapshot({...input,includeForming:input.includeForming!==false,range:{from:{basis:'utc',unixMs:utc-Math.min(3660,Math.max(31,input.tailLimit*3))*86400000},to:{basis:'utc',unixMs:utc}}},{...context,signal});return {seriesId:result.extra.seriesId,bars:result.rows.slice(-input.tailLimit),meta:result.meta};};
    const initial=await fetch(),position={streamId:randomUUID(),epoch:randomUUID(),seq:'0'};let task,timer,wake,ready=false,seq=0n;
    const handle={bindingId:context.bindingId,snapshot:initial,position,consistency:'bounded',recovery:'snapshot',ready(emit){if(ready||signal.aborted)return;ready=true;task=(async()=>{let prior=new Map(initial.bars.map(b=>[b.id,b.revision]));try{while(!signal.aborted){await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,pollMs)});if(signal.aborted)break;const next=await fetch();if(signal.aborted)break;const bars=next.bars.filter(b=>prior.get(b.id)!==b.revision);if(bars.length)emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',type:'bars.upsert',payload:{seriesId:next.seriesId,bars},observedAt:now()});prior=new Map(next.bars.map(b=>[b.id,b.revision]));}}catch(error){if(!signal.aborted)emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',type:'stream.gap',payload:{reason:{code:error.code??'SOURCE_UNAVAILABLE',message:error.message},recovery:'snapshot'},observedAt:now()})}})()},async close(){controller.abort();clearTimeout(timer);wake?.();await task;signal.removeEventListener('abort',abort);streams.delete(handle)}};
    const abort=()=>{clearTimeout(timer);wake?.()};signal.addEventListener('abort',abort,{once:true});streams.add(handle);return handle;
  }
  const common = {
    bind: async (input, context) => {
      const c = current(); if (input.connection) check(canonical(input.connection) === canonical(connection(c)), 'Selected QMT connection changed', 'CONNECTION_CHANGED');
      bindings.set(context.bindingId, connection(c));
      return { connection: connection(c), health: 'configured', sourceId: `qmt:${c.connection_id}`, limitations: ['Connection is verified on the first native read; no terminal is started.'] };
    },
    unbind: async ({ bindingId }) => { bindings.delete(bindingId);for(const [key,page]of pages)if(page.bindingId===bindingId)pages.delete(key);await Promise.allSettled([...streams].filter(x=>x.bindingId===bindingId).map(x=>x.close())); },
  };
  const market = { ...common,
    queryBars: async(input,context)=>{const c=fixed(context); const result=await paged(c,'bars',{...input,bindingId:context.bindingId},()=>barSnapshot(input,context));fixed(context);return {data:{seriesId:result.seriesId,page:result.data,coverage:{from:input.range.from,to:input.range.to,hasMore:{before:'unknown',after:'unknown'}}},meta:result.meta};},
    subscribeBars:pollBars,
    searchInstruments: async (input, context) => {
      const c = fixed(context);
      check(typeof input.query === 'string' && input.query.length <= 100, 'Invalid search query', 'INVALID_ARGUMENT');
      return paged(c, 'search', {...input,bindingId:context.bindingId}, async () => {
        const r = await read(c, 'search', { query: input.query }, context.signal);
        const rows = r.result.items.map(row => summary(c, row)).filter(item => (!input.assetClasses || input.assetClasses.includes(item.assetClass)) && (!input.venues || input.venues.includes(item.venue.value)));
        return { rows, meta: metadata(r, [warning('PARTIAL_CATALOG', `Only the native local sector ${c.sector} is available; no download or global directory completeness is inferred.`)]) };
      });
    },
    describeInstrument: async (input, context) => {
      const c = fixed(context), r = await read(c, 'describe', { symbols: [instrumentSymbol(c, input.instrument)] }, context.signal);
      return { data: instrument(c, r.result.items[0]), meta: metadata(r) };
    },
    subscribeQuotes: async (input, context) => {
      check(!input.resumeToken, 'Quote recovery requires a new snapshot', 'UNSUPPORTED_CAPABILITY');
      check(Array.isArray(input.instruments) && input.instruments.length >= 1 && input.instruments.length <= 50, 'Select 1–50 instruments', 'INVALID_ARGUMENT');
      const c = fixed(context), symbols = input.instruments.map(ref => instrumentSymbol(c, ref));
      check(new Set(symbols).size === symbols.length, 'Duplicate quote instruments', 'INVALID_ARGUMENT');
      const controller = new AbortController(), signal = AbortSignal.any([controller.signal, lifetime.signal, ...(context.signal ? [context.signal] : [])]);
      const fetch = async () => { fixed(context); const r = await read(c, 'quotes', { symbols }, signal); return { quotes: r.result.items.map(row => revised(quote(c, row))), meta: metadata(r, [warning('POLLING_SNAPSHOT', 'Native get_full_tick is polled without overlapping reads; source timestamps determine quote age, not poll time.')]) }; };
      const initial = await fetch(), position = { streamId: randomUUID(), epoch: randomUUID(), seq: '0' };
      let ready = false, task, timer, wake, sequence = 0n;
      const handle = { bindingId:context.bindingId, snapshot: initial, position, consistency: 'bounded', recovery: 'snapshot',
        ready: emit => {
          if (ready || signal.aborted) return; ready = true;
          const event = (type, payload) => { sequence++; emit({ ...position, seq: String(sequence), eventId: randomUUID(), schemaVersion: '1.0.0', type, payload, observedAt: now() }); };
          task = (async () => {
            let prior = canonical(initial.quotes);
            try {
              while (!signal.aborted) {
                await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, pollMs); });
                if (signal.aborted) break;
                const next = await fetch(); if(signal.aborted)break; const body = canonical(next.quotes);
                if (body !== prior) { event('quotes.upsert', next); prior = body; }
              }
            } catch (error) { if (!signal.aborted) event('stream.gap', { reason: { code: error.code ?? 'SOURCE_UNAVAILABLE', message: error.message }, recovery: 'snapshot' }); }
          })();
        },
        close: async () => { controller.abort(); clearTimeout(timer); wake?.(); if (task) await task; signal.removeEventListener('abort', abort); streams.delete(handle); },
      };
      const abort = () => { clearTimeout(timer); wake?.(); };
      signal.addEventListener('abort', abort, { once: true }); streams.add(handle); return handle;
    },
  };
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
  for(const [method,action,map] of [['queryOrders','orders',order],['queryFills','fills',fill]]) accounts[method]=async(input,context)=>{
    const c=fixed(context);account(c,input.account);
    check(Object.keys(input).every(k=>['account','instruments','page'].includes(k)),'Unsupported account query filter; only current-day data is available','UNSUPPORTED_CAPABILITY');
    check(!input.range,'Native QMT supports current-trading-day orders/fills only, not requested historical ranges','UNSUPPORTED_CAPABILITY');
    const symbols=input.instruments?.map(ref=>instrumentSymbol(c,ref));
    check(!input.statuses && !input.orderIds,'These filters are not supported by this QMT query','UNSUPPORTED_CAPABILITY');
    return paged(c,action,{...input,bindingId:context.bindingId},async()=>{const r=await read(c,action,{},context.signal);return{rows:r.result.items.filter(row=>!symbols||symbols.includes(row.stock_code)).map(row=>revised(map(c,row))).sort((a,b)=>a.id.localeCompare(b.id)),meta:metadata(r,[warning('CURRENT_TRADING_DAY_ONLY','Only the native current trading day is queried; historical completeness and native order time units are unknown.')]),extra:{coverage:{scope:'current_trading_day',completeHistory:false,hasMore:{before:'unknown',after:'unknown'}}}}});
  };
  return { market, account: accounts,
    async download(args,signal){const c=current();instrumentSymbol(c,instrumentRef(c,args.symbol));check(/^\d{8}$/.test(args.start)&&/^\d{8}$/.test(args.end)&&args.start<=args.end,'Use ordered YYYYMMDD bounds','INVALID_ARGUMENT');const dates=[args.start,args.end].map(x=>x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6,8));for(const date of dates)check(new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'Invalid download date','INVALID_ARGUMENT');check(Date.parse(dates[1])-Date.parse(dates[0])<=3660*86400000,'Download range exceeds ten years','INVALID_ARGUMENT');return read(c,'download_history',{symbols:[args.symbol],start:args.start,end:args.end},signal);},
    async command(action,args,signal,scope=host.scope){
      check(scope?.kind==='main','Trading tools are only available in the main user conversation','FORBIDDEN');
      check(args.user_authorized===true,'Require an explicit user trading instruction','FORBIDDEN');
      const c=current();account(c,accountRef(c));check(args.account_id===c.account_id&&args.connection_revision===String(c.version),'Explicit account/revision changed','CONNECTION_CHANGED');
      check(typeof args.operation_id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(args.operation_id),'Invalid operation ID','INVALID_ARGUMENT');
      if(action==='order'){instrumentSymbol(c,instrumentRef(c,args.symbol));check(['buy','sell'].includes(args.side)&&typeof args.shares==='string'&&/^[1-9]\d*$/.test(args.shares)&&BigInt(args.shares)<=2147483647n,'Use explicit buy/sell and positive integer shares','INVALID_ARGUMENT');check(typeof args.price==='string'&&/^(0|[1-9]\d*)(\.\d+)?$/.test(args.price)&&Number(args.price)>0&&Number.isFinite(Number(args.price)),'Invalid positive limit price','INVALID_ARGUMENT');}
      return host.configuration.exclusive(async()=>{
        check(canonical(connection(current()))===canonical(connection(c)),'Connection changed before submission','CONNECTION_CHANGED');
        const fingerprint=digest({action,args,connection:connection(c)}),old=storedCommand(args.operation_id);
        if(old){check(old.fingerprint===fingerprint,'Operation ID already used for different input','IDEMPOTENCY_CONFLICT');return old;}
        let payload={...args,remark:'S'+digest(args.operation_id).slice(7,30)};
        if(action==='cancel'){const original=storedCommand(args.original_operation_id);check(original?.action==='order'&&original.status==='submitted'&&original.result?.order_id===args.order_id&&canonical(original.connection)===canonical(connection(c)),'Cancel must reference an accepted Sesame order on this connection','INVALID_ARGUMENT');payload.remark=original.remark;}
        let record={id:args.operation_id,action,fingerprint,connection:connection(c),remark:payload.remark,status:'outcome_unknown',createdAt:now()};
        host.storage.put('qmt_commands',record); // durable boundary before native submission; never replay unknown intent.
        try{signal?.throwIfAborted();const r=await read(c,action,payload,signal);check(r.result.status===(action==='order'?'submitted':'cancel_requested')&&/^[1-9]\d*$/.test(r.result.order_id??''),'Native submission receipt is invalid','SOURCE_DATA_INVALID');check(action!=='cancel'||r.result.order_id===args.order_id,'Cancel receipt order ID differs','SOURCE_DATA_INVALID');record={...record,status:r.result.status,result:r.result,meta:metadata(r)};host.storage.put('qmt_commands',record);return record;}
        catch(error){record={...record,status:error.code==='BROKER_REJECTED'?'rejected':'outcome_unknown',error:{code:error.code??'SOURCE_UNAVAILABLE',message:'Submission outcome is unconfirmed; inspect native orders/fills before taking another action.'}};host.storage.put('qmt_commands',record);throw error;}
      });
    },
    async native(action, args, signal) {
      check(['search','describe','quotes','asset','positions','orders','fills'].includes(action), 'Only fixed reads are supported', 'UNSUPPORTED_CAPABILITY');
      const c = current(); if (['asset','positions','orders','fills'].includes(action)) account(c, accountRef(c));
      if (['search','positions','orders','fills'].includes(action)) {
        const input = { ...args, page: args.page ?? { limit: 200 } };
        const r = await paged(c, `native:${action}`, input, async () => {
          const result = await read(c, action, { query: args.query ?? '' }, signal);
          return { rows: result.result.items, meta: metadata(result), extra: { coverage: result.result.coverage ?? { scope: 'configured_native_sector', complete_history: false }, ...(result.result.source ? { source: result.result.source } : {}) } };
        });
        return { ...r.data, meta: r.meta, coverage: r.coverage, ...(r.source ? { source: r.source } : {}), connection: connection(c), nativeFieldPolicy: 'Original native fields; order timestamps and price_type are not reinterpreted. Current-day data is not full history.' };
      }
      const r = await read(c, action, args, signal);
      return { ...r.result, connection: connection(c), meta: metadata(r), nativeFieldPolicy: 'Integer IDs and SDK float values remain text. Native order timestamps/price_type are not reinterpreted. No strategy correlation or all-history completeness is claimed.' };
    },
    async dispose() { lifetime.abort(); await Promise.allSettled([...streams].map(stream => stream.close())); bindings.clear(); pages.clear(); revisions.clear(); },
  };
}
