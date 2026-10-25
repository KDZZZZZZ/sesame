import { randomUUID } from 'node:crypto';
import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';
import { instrumentRef, summary, instrument, quote, dailyBar, metadata } from './mapping.js';

const warning = (code, message) => ({ code, message });
export const marketDescriptor = { id: 'market', contract: 'sesame.market', versions: ['1.0.0'], capabilities: ['instruments.search','instruments.describe','quotes.subscribe','bars.history','bars.subscribe'], limits: { transportMode: 'poll', minPollIntervalMs: 1000, maxPageSize: 200, maxInstrumentsPerSubscription: 50, resumable: false, catalogScope: 'configured native mainland stock sector', timeframes: ['1d'], priceBases: ['last'], adjustments: ['none'] } };

export function createMarket(transport, state, { now = Date.now, pollMs = 1000 } = {}) {
  const { current, connection, fixed, instrumentSymbol, read, paged, common } = transport;
  const { closedThrough, streams, lifetime, revised } = state;
  function rangeDate(time) {
    if(time?.basis === 'utc') { check(Number.isSafeInteger(time.unixMs), 'Invalid UTC bound', 'INVALID_ARGUMENT'); return new Date(time.unixMs+8*3600000).toISOString().slice(0,23); }
    check(time?.basis === 'wall' && time.authority === 'Asia/Shanghai' && time.fold === undefined && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(time.value), 'Use UTC or unambiguous Asia/Shanghai wall bounds', 'UNSUPPORTED_CAPABILITY');
    check(new Date(time.value+'Z').toISOString().slice(0,19) === time.value, 'Invalid wall bound', 'INVALID_ARGUMENT'); return time.value+'.000';
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
    check(closedThrough.has(seriesId)||closedThrough.size<2048,'Daily series state exceeds budget','RESOURCE_EXHAUSTED');
    if(!closedThrough.has(seriesId))closedThrough.set(seriesId,null);
    const r = await read(c,'bars',{symbols:[symbol],start:from.slice(0,10).replaceAll('-',''),end:to.slice(0,10).replaceAll('-',''),forming:true},context.signal);
    const native = [...r.result.items];
    if(input.includeForming && r.result.tick) {
      const tick = r.result.tick, sourceTime = quote(c,{symbol,tick}).time;
      check(sourceTime.basis === 'utc', 'Forming daily row needs native epoch time', 'UNSUPPORTED_CAPABILITY');
      const date = new Date(sourceTime.unixMs+8*3600000).toISOString().slice(0,10);
      const lastDate = native.length ? new Date(Math.max(...native.map(row=>Number(row.time)))+8*3600000).toISOString().slice(0,10) : null;
      const sameDay = native.find(row=>new Date(Number(row.time)+8*3600000).toISOString().slice(0,10)===date);
      if(date >= from.slice(0,10) && date <= to.slice(0,10) && (!lastDate || date >= lastDate) && sameDay?.is_closed !== true && !(closedThrough.get(seriesId) && date<=closedThrough.get(seriesId))) {
        const replacement={time:String(sourceTime.unixMs),open:tick.open,high:tick.high,low:tick.low,close:tick.lastPrice,volume:tick.volume};
        const at=native.findIndex(row=>new Date(Number(row.time)+8*3600000).toISOString().slice(0,10)===date);
        if(at>=0)native[at]=replacement;else native.push(replacement);
      }
    }
    native.sort((a,b)=>Number(a.time)-Number(b.time));
    const tickTime=r.result.tick?.time;
    for(let i=0;i<native.length;i++){const bar=dailyBar(native[i],seriesId,r.sample.to,{nextSourceTime:native[i+1]?.time ?? (/^\d{13}$/.test(tickTime??'')?tickTime:undefined)});const date=bar.openTime.value.slice(0,10);if(bar.isClosed && (!closedThrough.get(seriesId)||date>closedThrough.get(seriesId)))closedThrough.set(seriesId,date);}
    const rows=native.map((row,index)=>{let bar=dailyBar(row,seriesId,r.sample.to,{nextSourceTime:native[index+1]?.time ?? (/^\d{13}$/.test(tickTime??'')?tickTime:undefined)});if(closedThrough.get(seriesId)&&bar.openTime.value.slice(0,10)<=closedThrough.get(seriesId))bar={...bar,isClosed:true,closure:'source'};return revised(bar);}).filter(bar=>(bar.openTime.value+'.000')>=from && (bar.openTime.value+'.000')<to && (input.includeForming || bar.isClosed)).sort((a,b)=>a.openTime.value.localeCompare(b.openTime.value));
    check(new Set(rows.map(x=>x.id)).size===rows.length,'Duplicate native daily rows','SOURCE_DATA_INVALID');
    return {rows,meta:metadata(r,[warning('LOCAL_HISTORY','Only existing cached daily data is read. Empty data does not prove complete coverage; explicitly download missing ranges.'),warning('DAILY_POLL','Daily OHLC uses native source timestamps. No minute bars or native volume units are inferred.')]),extra:{seriesId,coverage:{requested:input.range,observedRange:rows.length?{from:rows[0].openTime,to:rows.at(-1).openTime}:null,complete:false,gaps:[{range:input.range,reason:'not_loaded'}]}}};
  }
  async function pollBars(input,context) {
    check(!input.resumeToken,'Resume requires a new snapshot','UNSUPPORTED_CAPABILITY');
    check(Number.isInteger(input.tailLimit)&&input.tailLimit>0&&input.tailLimit<=2000,'tailLimit must be 1–2000','INVALID_ARGUMENT');
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,lifetime.signal,...(context.signal?[context.signal]:[])]);
    const fetch=async()=> {const utc=now();const result=await barSnapshot({...input,includeForming:input.includeForming!==false,range:{from:{basis:'utc',unixMs:utc-Math.min(3660,Math.max(31,input.tailLimit*3))*86400000},to:{basis:'utc',unixMs:utc}}},{...context,signal});return {seriesId:result.extra.seriesId,instrument:input.instrument,spec:input.spec,bars:result.rows.slice(-input.tailLimit),coverage:result.extra.coverage,meta:result.meta};};
    const initial=await fetch(),position={streamId:randomUUID(),epoch:randomUUID(),seq:'0'};let task,timer,wake,ready=false,seq=0n;
    const handle={bindingId:context.bindingId,snapshot:initial,position,consistency:'bounded',recovery:'snapshot',ready(emit){if(ready||signal.aborted)return;ready=true;task=(async()=>{let prior=new Map(initial.bars.map(b=>[b.id,b.revision]));try{while(!signal.aborted){await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,pollMs)});if(signal.aborted)break;const next=await fetch();if(signal.aborted)break;const bars=next.bars.filter(b=>prior.get(b.id)!==b.revision);if(bars.length)emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',type:'bars.upsert',payload:{seriesId:next.seriesId,bars},observedAt:now()});prior=new Map(next.bars.map(b=>[b.id,b.revision]));}}catch(error){if(!signal.aborted)emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',type:'stream.gap',payload:{reason:{code:error.code??'SOURCE_UNAVAILABLE',message:error.message},recovery:'snapshot'},observedAt:now()})}})()},async close(){controller.abort();clearTimeout(timer);wake?.();await task;signal.removeEventListener('abort',abort);streams.delete(handle)}};
    const abort=()=>{clearTimeout(timer);wake?.()};signal.addEventListener('abort',abort,{once:true});streams.add(handle);return handle;
  }
  const market = { ...common,
    queryBars: async(input,context)=>{const c=fixed(context); const result=await paged(c,'bars',{...input,bindingId:context.bindingId},()=>barSnapshot(input,context));fixed(context);return {data:{seriesId:result.seriesId,instrument:input.instrument,spec:input.spec,page:result.data,coverage:result.coverage},meta:result.meta};},
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
  async function download(args,signal){const c=current();instrumentSymbol(c,instrumentRef(c,args.symbol));check(/^\d{8}$/.test(args.start)&&/^\d{8}$/.test(args.end)&&args.start<=args.end,'Use ordered YYYYMMDD bounds','INVALID_ARGUMENT');const dates=[args.start,args.end].map(x=>x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6,8));for(const date of dates)check(new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'Invalid download date','INVALID_ARGUMENT');check(Date.parse(dates[1])-Date.parse(dates[0])<=3660*86400000,'Download range exceeds ten years','INVALID_ARGUMENT');return read(c,'download_history',{symbols:[args.symbol],start:args.start,end:args.end},signal);}
  return { market, download };
}
