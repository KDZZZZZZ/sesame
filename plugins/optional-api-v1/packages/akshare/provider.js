import { Decimal } from '@sesame/plugin-sdk/decimal';
import { check, digest, canonical, decimal } from '@sesame/plugin-sdk/protocol';
import { randomUUID } from 'node:crypto';
const authority = 'Asia/Shanghai';
const timeBasis = Object.freeze({ kind: 'wall', authority, zone: authority });
const wallFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: authority, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23' });
const wallTime = value => ({ basis: 'wall', authority, zone: authority, value });
const legacyWallRange = range => range.from.basis === 'wall' && range.to.basis === 'wall' && range.from.zone === undefined && range.to.zone === undefined;
function legacyBar(bar) {
    // The old request explicitly omits the optional zone. Project only the
    // response, after canonical revision calculation; do not mutate cached bars.
    const withoutZone = ({ zone, ...time }) => time;
    return { ...bar, openTime: withoutZone(bar.openTime), endTime: withoutZone(bar.endTime) };
}
export const descriptor = { id: 'market', contract: 'sesame.market', versions: ['1.0.0'], capabilities: ['instruments.search', 'instruments.describe', 'bars.history', 'quotes.subscribe', 'bars.subscribe'] };
const clone = value => structuredClone(value);
const unknown=reason=>({status:'unknown',reason});
const instrumentSummary=(binding,row)=>{const code=String(row.code).replace(/^(sh|sz|bj)/,'').padStart(6,'0');const venue=/^(920|[48])/.test(code)?'BJ':/^[69]/.test(code)?'SH':/^[03]/.test(code)?'SZ':null;return{ref:{sourceId:binding.sourceId,instrumentId:code},symbol:code,name:row.name,assetClass:'equity',venue:venue?{status:'value',value:venue}:unknown('No verified exchange prefix'),timeBasis:{...timeBasis},features:{timeframes:['1d'],priceBases:['last'],adjustments:['none','forward','backward']}};};
const instrumentDetail=(binding,row)=>({...instrumentSummary(binding,row),currency:{status:'value',value:'CNY'},price:{tickSize:unknown('No verified instrument tick rule'),displayDecimals:2},quantity:{unit:'share',min:unknown('No broker quantity rule'),max:unknown('No broker quantity rule'),step:unknown('No broker quantity rule'),contractMultiplier:unknown('No native contract multiplier')},volume:{realUnit:{status:'value',value:binding.source==='eastmoney'?'lot':'share'},hasReal:true,hasTick:false},calendar:unknown('No fixed exchange calendar'),native:{symbol:String(row.code),sourceCode:String(row.code),...(instrumentSummary(binding,row).venue.status==='value'?{market:instrumentSummary(binding,row).venue.value}:{})}});
export class AKShareProvider {
    constructor(host) { this.host = host; this.bindings = new Map(); this.snapshots = new Map(); this.revisions = new Map(); this.closedThrough=new Map();
        this.sequence = 0n; this.streams=new Set(); this.quoteCache=null; }
    bind(input, context) { const source = input.configuration?.source ?? (input.connection?.id?.split(':')[1] ?? 'eastmoney'); check(['eastmoney', 'sina','tencent'].includes(source), 'source must be eastmoney, sina or tencent'); const connection = { id: 'akshare:' + source, revision: '1.19.1' }; check(!input.connection || canonical(input.connection) === canonical(connection), 'Connection source/version changed', 'CONNECTION_CHANGED'); const value = { source, connection, sourceId: `akshare:${source}:a-share` }; this.bindings.set(context.bindingId, value); return { connection, sourceIds: [value.sourceId], health: 'ready', timeBasis: { ...timeBasis } }; }
    dispose() { for(const stream of this.streams)void stream.close(); this.bindings.clear(); this.snapshots.clear(); this.revisions.clear(); this.closedThrough.clear(); }
    unbind(context) { this.bindings.delete(context.bindingId); for (const [id, s] of this.snapshots)
        if (s.bindingId === context.bindingId)
            this.snapshots.delete(id); }
    bound(context, instrument) { check(this.bindings.has(context.bindingId), 'Binding no longer exists', 'CONNECTION_CHANGED'); const value = this.bindings.get(context.bindingId); if (instrument) {
        check(instrument.sourceId === value.sourceId && /^\d{6}$/.test(instrument.instrumentId), 'Wrong source or A-share code', 'INSTRUMENT_MISMATCH');
    } return value; }
    async fetch(name, args, context) { return this.host.environment.executeWorker('worker.js', { operation: 'query', interface: name, arguments: args }, { signal: context.signal, timeoutMs: 120000 }); }
    async page(input, context, load) {
        const { page = {}, ...filters } = input, limit = page.limit ?? 100;
        check(Number.isInteger(limit) && limit > 0 && limit <= 2000, 'page.limit must be 1..2000');
        check(input.direction===undefined||['forward','backward'].includes(input.direction),'Invalid page direction');
        const key = digest([context.bindingId, filters]);
        let snapshot, offset = 0;
        if (page.cursor) {
            try {
                const cursor = JSON.parse(Buffer.from(page.cursor, 'base64url'));
                snapshot = this.snapshots.get(cursor.id);
                offset = cursor.offset;
            }
            catch {
                check(false, 'Invalid cursor', 'INVALID_CURSOR');
            }
            check(snapshot && snapshot.key === key && snapshot.expires > Date.now() && Number.isSafeInteger(offset) && offset >= 0 && offset <= snapshot.items.length, 'Cursor expired or belongs to different binding/query', 'INVALID_CURSOR');
        }
        else {
            const data = await load();
            check(data.items.length <= 100000 && Buffer.byteLength(JSON.stringify(data)) <= 32 * 1024 * 1024, 'Snapshot exceeds budget');
            this.bound(context);
            for (const [id, s] of this.snapshots)
                if (s.expires < Date.now())
                    this.snapshots.delete(id);
            while (this.snapshots.size >= 32)
                this.snapshots.delete(this.snapshots.keys().next().value);
            snapshot = { ...data, key, id: randomUUID(), bindingId: context.bindingId, expires: Date.now() + 300000 };
            this.snapshots.set(snapshot.id, snapshot);
        }
        const end = Math.min(snapshot.items.length, offset + limit);
        return { data: { items: clone(input.direction==='backward'?snapshot.items.slice(Math.max(0,snapshot.items.length-end),snapshot.items.length-offset):snapshot.items.slice(offset,end)), snapshotId: snapshot.id, consistency: 'snapshot', nextCursor: end < snapshot.items.length ? Buffer.from(JSON.stringify({ id: snapshot.id, offset: end })).toString('base64url') : null }, meta: clone(snapshot.meta), extra: clone(snapshot.extra ?? {}) };
    }
    meta(result, source) { return { observedAt: result.observedAt, freshness: 'delayed', origin: 'observed', consistency: 'best_effort', warnings: ['Historical/public data is not a streaming or broker execution feed.', 'AKShare upstream numeric values are represented as Decimal strings; upstream float precision cannot be recovered.'], source: { library: 'akshare', version: result.akshareVersion, interface: result.interface, upstream: source, url: source === 'sina' ? 'https://finance.sina.com.cn' : source === 'eastmoney' ? 'https://quote.eastmoney.com' : source === 'tencent' ? 'https://stockapp.finance.qq.com' : 'https://akshare.akfamily.xyz/data/stock/stock.html' } }; }
    async searchInstruments(input,context){const binding=this.bound(context);const result=await this.page(input,context,async()=>{const response=await this.fetch(binding.source==='tencent'?'stock_zh_a_spot_tx':'stock_info_a_code_name',{},context);const query=String(input.query??'').toLowerCase();return{items:response.rows.map(row=>instrumentSummary(binding,row)).filter(item=>(item.symbol+' '+item.name).toLowerCase().includes(query)&&(!input.assetClasses||input.assetClasses.includes(item.assetClass))&&(!input.venues||item.venue.status==='value'&&input.venues.includes(item.venue.value))),meta:this.meta(response,binding.source)};});return{data:result.data,meta:result.meta};}
    async describeInstrument(input,context){const binding=this.bound(context,input.instrument);const response=await this.fetch(binding.source==='tencent'?'stock_zh_a_spot_tx':'stock_info_a_code_name',{},context);const row=response.rows.find(row=>instrumentSummary(binding,row).ref.instrumentId===input.instrument.instrumentId);check(row,'Unknown A-share instrument','NOT_FOUND');return{data:instrumentDetail(binding,row),meta:this.meta(response,binding.source)};}
    revise(bar) { const hash = digest({ ...bar, revision: null }), old = this.revisions.get(bar.id); const revision = old?.hash === hash ? old.revision : (++this.sequence).toString(); this.revisions.set(bar.id, { hash, revision }); while (this.revisions.size > 100000)
        this.revisions.delete(this.revisions.keys().next().value); bar.revision = revision; return bar; }
    async tencentQuotes(context){if(this.quoteCache&&Date.now()-this.quoteCache.observedAt<60000)return clone(this.quoteCache);const response=await this.fetch('stock_zh_a_spot_tx',{},context);this.quoteCache=response;return clone(response);}
    async subscribeQuotes(input, context) {
        check(!input.resumeToken,'Polling requires a fresh snapshot','UNSUPPORTED_CAPABILITY');
        check(Array.isArray(input.instruments)&&input.instruments.length>0&&input.instruments.length<=5,'Select 1–5 instruments');
        const binding=this.bound(context);check(['eastmoney','tencent'].includes(binding.source),'Quote polling requires explicit Eastmoney or Tencent binding','UNSUPPORTED_CAPABILITY');
        const read=async signal=>{const quotes=[];let meta;const batch=binding.source==='tencent'?await this.tencentQuotes({...context,signal:signal??context.signal}):null;for(const instrument of input.instruments){this.bound(context,instrument);const result=batch??await this.fetch('stock_bid_ask_em',{symbol:instrument.instrumentId},{...context,signal:signal??context.signal});const tx=batch?.rows.find(r=>String(r.code).replace(/^(sh|sz|bj)/,'')===instrument.instrumentId);if(batch)check(tx,'Tencent snapshot has no requested code','NOT_FOUND');const values=batch?{'最新':tx.zxj,name:tx.name,...tx}:Object.fromEntries(result.rows.map(r=>[r.item,r.value]));const price=name=>values[name]===null||values[name]===undefined||Number(values[name])<=0?{status:'unknown'}:{status:'value',value:decimal(values[name])};quotes.push({instrument,id:`${binding.sourceId}:${instrument.instrumentId}:observation`,revision:String(result.observedAt),time:{basis:'utc',unixMs:result.observedAt},last:price('最新'),bid:price('buy_1'),ask:price('sell_1'),bidSize:{status:'unknown'},askSize:{status:'unknown'},nativeId:{status:'unknown'},native:{observationTimeOnly:true,exchangeTimeUnavailable:true,values}});meta=this.meta(result,binding.source);meta.freshness='unknown';meta.warnings.push('Quote time is HTTP observation time, not an exchange tick timestamp. Upstream freshness cannot be proved. Poll interval: 60 seconds.');}return{quotes,meta}};
        return this.poll(await read(),read,context,(old,next)=>[{type:'quotes.upsert',payload:next}]);
    }
    async subscribeBars(input, context) {
        check(!input.resumeToken,'Polling requires a fresh snapshot','UNSUPPORTED_CAPABILITY');check(Number.isInteger(input.tailLimit)&&input.tailLimit>0&&input.tailLimit<=2000,'tailLimit must be 1..2000');
        const read=async signal=>{const now=Date.now(),from={basis:'utc',unixMs:now-Math.min(3660,Math.max(31,input.tailLimit*3))*86400000},to={basis:'utc',unixMs:now+86400000};let cursor,result;const collected=[];do{result=await this.queryBars({...input,range:{from,to},page:{limit:2000,...(cursor?{cursor}:{})},includeForming:input.includeForming!==false,direction:'forward'},{...context,signal:signal??context.signal});collected.push(...result.data.page.items);cursor=result.data.page.nextCursor;}while(cursor);return{seriesId:result.data.seriesId,instrument:input.instrument,spec:input.spec,coverage:result.data.coverage,bars:collected.slice(-input.tailLimit),meta:{...result.meta,warnings:[...result.meta.warnings,'Daily public history is polled every 60 seconds. Latest rows stay forming unless later source-dated rows or explicit source evidence prove closure; no minute bars are fabricated.']}}};
        return this.poll(await read(),read,context,(old,next)=>{const prior=new Map(old.bars.map(b=>[b.id,b.revision]));const bars=next.bars.filter(b=>prior.get(b.id)!==b.revision);return bars.length?[{type:'bars.upsert',payload:{seriesId:next.seriesId,bars}}]:[]});
    }
    poll(snapshot,read,context,events){const position={streamId:randomUUID(),epoch:randomUUID(),seq:'0'};let closed=false,started=false,timer,seq=0n,prior=snapshot,pending=Promise.resolve();const controller=new AbortController();const abort=()=>{closed=true;clearTimeout(timer);controller.abort()};context.signal?.addEventListener('abort',abort,{once:true});const handle={snapshot,position,consistency:'best_effort',recovery:'snapshot',close:async()=>{abort();context.signal?.removeEventListener('abort',abort);await pending.catch(()=>{});this.streams.delete(handle)},ready:emit=>{if(started||closed)return;started=true;const poll=()=>{if(closed)return;pending=(async()=>{try{const next=await read(AbortSignal.any([controller.signal,...(context.signal?[context.signal]:[])]));if(!closed){for(const event of events(prior,next))emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',observedAt:Date.now(),...event});prior=next}}catch(error){if(!closed)emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',type:'stream.gap',payload:{code:error.code??'SOURCE_UNAVAILABLE',message:error.message,recovery:'snapshot'},observedAt:Date.now()});abort()}finally{if(!closed){timer=setTimeout(poll,60000);timer.unref?.()}}})();};timer=setTimeout(poll,60000);timer.unref?.()}};this.streams.add(handle);return handle;}
    async queryBars(input, context) {
        const binding = this.bound(context, input.instrument);
        check(input.spec?.timeframe === '1d' && input.spec.priceBasis === 'last', 'Only 1d last-price bars are supported', 'UNSUPPORTED_CAPABILITY');
        check(['none','forward','backward'].includes(input.spec.adjustment), 'adjustment must be none/forward/backward', 'UNSUPPORTED_CAPABILITY');
        check(input.spec.calendarRevision?.status === 'unknown', 'No pinned exchange calendar is supplied', 'UNSUPPORTED_CAPABILITY');
        check(['all', 'regular'].includes(input.spec.session), 'Unsupported session', 'UNSUPPORTED_CAPABILITY');
        const from = wall(input.range?.from), to = wall(input.range?.to), legacy = legacyWallRange(input.range);
        const utc = input.range.from.basis === 'utc' || input.range.to.basis === 'utc';
        // A historical rollback makes projected wall endpoints non-injective.
        // Keep UTC ordering and duration in UTC, then compare actual bar instants.
        const instant = time => time.basis === 'utc' ? time.unixMs : wallInstant(time);
        const lower = utc ? instant(input.range.from) : Date.parse(from + 'Z');
        const upper = utc ? instant(input.range.to) : Date.parse(to + 'Z');
        check(lower < upper, 'Range must be ascending');
        check(upper - lower <= 366 * 30 * 86400000, 'Maximum history range is 30 years');
        const result = await this.page(input, context, async () => { const name = binding.source === 'sina' ? 'stock_zh_a_daily' : binding.source==='tencent'?'stock_zh_a_hist_tx':'stock_zh_a_hist'; const args = { symbol: binding.source !== 'eastmoney' ? (/^(920|[48])/.test(input.instrument.instrumentId)?'bj':/^[69]/.test(input.instrument.instrumentId)?'sh':'sz')+input.instrument.instrumentId : input.instrument.instrumentId, start_date: (from < to ? from : to).slice(0, 10).replaceAll('-', ''), end_date: (from > to ? from : to).slice(0, 10).replaceAll('-', ''), adjust: {none:'',forward:'qfq',backward:'hfq'}[input.spec.adjustment], ...(binding.source === 'eastmoney' ? { period: 'daily' } : {}) }; check(binding.source !== 'sina' || /^[036]/.test(input.instrument.instrumentId), 'Sina adapter supports Shanghai/Shenzhen codes only', 'UNSUPPORTED_CAPABILITY'); const response = await this.fetch(name, args, context), seriesId = digest([input.instrument, input.spec]); check(this.closedThrough.has(seriesId)||this.closedThrough.size<2048,'Daily series state exceeds budget','RESOURCE_EXHAUSTED');
            const mapped=response.rows.map(r=>mapBar(r,binding.source,seriesId,response.observedAt)).sort((a,b)=>a.openTime.value.localeCompare(b.openTime.value));
            check(new Set(mapped.map(bar=>bar.id)).size===mapped.length,'Duplicate upstream daily dates','SOURCE_DATA_INVALID');
            for(let i=0;i<mapped.length;i++)if(mapped[i].isClosed||mapped[i+1]?.openTime.value>mapped[i].openTime.value){const date=mapped[i].openTime.value.slice(0,10);if(!this.closedThrough.get(seriesId)||date>this.closedThrough.get(seriesId))this.closedThrough.set(seriesId,date);}
            if(!this.closedThrough.has(seriesId))this.closedThrough.set(seriesId,null);
            const bars=mapped.map(bar=>this.revise(this.closedThrough.get(seriesId)&&bar.openTime.value.slice(0,10)<=this.closedThrough.get(seriesId)?{...bar,isClosed:true,closure:'source'}:bar)).filter(bar=>{const instant=utc?wallInstant(bar.openTime):Date.parse(bar.openTime.value+'Z');return instant>=lower&&instant<upper&&(input.includeForming!==false||bar.isClosed);}).map(bar => legacy ? legacyBar(bar) : bar);
            const meta=this.meta(response,binding.source);
            meta.source.timeBasis = { ...timeBasis };
            if (legacy) meta.warnings.push('Wall times are represented without zone for this legacy request; the source time basis remains Asia/Shanghai, retained in meta.source.timeBasis. No clock conversion was performed.');
            return {items:bars,meta,extra:{seriesId,coverage:{requested:input.range,observedRange:bars.length?{from:bars[0].openTime,to:bars.at(-1).endTime}:null,complete:false,gaps:[{range:input.range,reason:'not_loaded'}]}}}; });
        return { data: { seriesId: result.extra.seriesId, instrument:input.instrument,spec:input.spec,page: result.data, coverage: result.extra.coverage }, meta: result.meta };
    }
}
export function wall(time) {
 if(time?.basis==='utc'){
  check(Number.isSafeInteger(time.unixMs),'Invalid UTC range');
  const date = new Date(time.unixMs);
  check(Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999, 'Invalid UTC date');
  // Asia/Shanghai included historical DST; its known IANA zone is not a fixed
  // +08:00 offset. Keep milliseconds when projecting an exact UTC boundary.
  const parts = Object.fromEntries(wallFormatter.formatToParts(date).map(part => [part.type, part.value]));
  const value = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
  check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/.test(value), 'Unsupported wall date');
  return value;
 }
 check(time?.basis==='wall'&&time.authority===authority&&(!time.zone||time.zone===authority)&&time.fold===undefined&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(time.value),'Range requires unambiguous Asia/Shanghai wall or UTC time','UNSUPPORTED_CAPABILITY');
 const value=time.value.includes('.')?time.value.padEnd(23,'0'):time.value+'.000';check(Number.isFinite(Date.parse(value+'Z'))&&new Date(value+'Z').toISOString().slice(0,23)===value,'Invalid date');return value;
}
function wallInstant(time) {
 const value = wall(time), nominal = Date.parse(value + 'Z'), offsets = new Set();
 // Sample the declared zone on both sides of the source date. Only an exact
 // round trip is accepted; an ambiguous or nonexistent source clock is not
 // silently assigned a fold. Daily 09:30 bars have a unique Shanghai instant.
 for (const days of [-2, -1, 0, 1, 2]) {
  const sample = nominal + days * 86400000;
  offsets.add(Date.parse(wall({ basis: 'utc', unixMs: sample }) + 'Z') - sample);
 }
 const matches = [...offsets].map(offset => nominal - offset).filter(unixMs => wall({ basis: 'utc', unixMs }) === value);
 check(matches.length === 1, 'Wall time has no unique Asia/Shanghai instant', 'UNSUPPORTED_CAPABILITY');
 return matches[0];
}
export function mapBar(row, source, seriesId, observedAt) { const em = source === 'eastmoney', date = String(row[em ? '日期' : 'date']).slice(0, 10); check(/^\d{4}-\d\d-\d\d$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, 'Invalid upstream trading date'); const openTime = wallTime(date + 'T09:30:00'), endTime = wallTime(date + 'T15:00:00'), prices = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) => [key, decimal(row[em ? ['开盘', '最高', '最低', '收盘'][i] : key])])); check(Decimal.compare(prices.high,prices.low)>=0&&['open','close'].every(k=>Decimal.compare(prices[k],prices.low)>=0&&Decimal.compare(prices[k],prices.high)<=0),'Upstream OHLC is inconsistent','SOURCE_DATA_INVALID');const volume = row[em ? '成交量' : 'volume'];if(volume!==null&&volume!==undefined)check(Decimal.compare(decimal(volume),'0')>=0,'Upstream volume is negative','SOURCE_DATA_INVALID'); const quantity = volume === null || volume === undefined ? { status: 'unknown' } : { status: 'value', value: { value: decimal(volume), unit: em ? 'lot' : 'share' } }; return { id: `${seriesId}:${date}`, revision: '1', openTime, endTime, ...prices, isClosed:row.is_closed===true,closure:row.is_closed===true?'source':'unknown',turnover:{status:'unknown',reason:'Upstream turnover currency and coverage are not established'},volume: { default:quantity.status==='value'?'real':'none', tick: { status: 'unsupported' }, real: quantity } }; }
