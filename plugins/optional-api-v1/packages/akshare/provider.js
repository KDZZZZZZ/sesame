import { check, digest, canonical, decimal } from '@sesame/plugin-sdk/protocol';
import { randomUUID } from 'node:crypto';
const authority = 'Asia/Shanghai';
export const descriptor = { id: 'market', contract: 'sesame.market', versions: ['1.0.0'], capabilities: ['instruments.search', 'instruments.describe', 'bars.history', 'quotes.subscribe', 'bars.subscribe'] };
const clone = value => structuredClone(value);
export class AKShareProvider {
    constructor(host) { this.host = host; this.bindings = new Map(); this.snapshots = new Map(); this.revisions = new Map();
        this.sequence = 0n; this.streams=new Set(); this.quoteCache=null; }
    bind(input, context) { const source = input.configuration?.source ?? (input.connection?.id?.split(':')[1] ?? 'eastmoney'); check(['eastmoney', 'sina','tencent'].includes(source), 'source must be eastmoney, sina or tencent'); const connection = { id: 'akshare:' + source, revision: '1.19.1' }; check(!input.connection || canonical(input.connection) === canonical(connection), 'Connection source/version changed', 'CONNECTION_CHANGED'); const value = { source, connection, sourceId: `akshare:${source}:a-share` }; this.bindings.set(context.bindingId, value); return { connection, sourceIds: [value.sourceId], health: 'ready', timeBasis: { kind: 'wall', authority } }; }
    dispose() { for(const stream of this.streams)void stream.close(); this.bindings.clear(); this.snapshots.clear(); this.revisions.clear(); }
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
        return { data: { items: clone(snapshot.items.slice(offset, end)), snapshotId: snapshot.id, consistency: 'snapshot', nextCursor: end < snapshot.items.length ? Buffer.from(JSON.stringify({ id: snapshot.id, offset: end })).toString('base64url') : null }, meta: clone(snapshot.meta), extra: clone(snapshot.extra ?? {}) };
    }
    meta(result, source) { return { observedAt: result.observedAt, freshness: 'delayed', origin: 'observed', consistency: 'best_effort', warnings: ['Historical/public data is not a streaming or broker execution feed.', 'AKShare upstream numeric values are represented as Decimal strings; upstream float precision cannot be recovered.'], source: { library: 'akshare', version: result.akshareVersion, interface: result.interface, upstream: source, url: source === 'sina' ? 'https://finance.sina.com.cn' : source === 'eastmoney' ? 'https://quote.eastmoney.com' : source === 'tencent' ? 'https://stockapp.finance.qq.com' : 'https://akshare.akfamily.xyz/data/stock/stock.html' } }; }
    async searchInstruments(input, context) { const binding = this.bound(context), result = await this.page(input, context, async () => { const response = await this.fetch(binding.source==='tencent'?'stock_zh_a_spot_tx':'stock_info_a_code_name', {}, context); const query = String(input.query ?? '').toLowerCase(); return { items: response.rows.filter(r => (r.code + ' ' + r.name).toLowerCase().includes(query)).map(r => ({ ref: { sourceId: binding.sourceId, instrumentId: String(r.code).replace(/^(sh|sz|bj)/,'').padStart(6,'0') }, symbol: String(r.code).replace(/^(sh|sz|bj)/,'').padStart(6,'0'), name: r.name, timeBasis: { kind: 'wall', authority }, features: { timeframes: ['1d'], priceBases:['last'],adjustments:['none','forward','backward'] } })), meta: this.meta(response,binding.source) }; }); return { data: result.data, meta: result.meta }; }
    async describeInstrument(input, context) { const binding = this.bound(context, input.instrument); const result = await this.fetch(binding.source==='tencent'?'stock_zh_a_spot_tx':'stock_info_a_code_name', {}, context), row = result.rows.find(r => String(r.code).replace(/^(sh|sz|bj)/,'') === input.instrument.instrumentId); check(row, 'Unknown A-share instrument', 'NOT_FOUND'); return { data: { ref: input.instrument, symbol: input.instrument.instrumentId, name: row.name, timeBasis: { kind: 'wall', authority }, features: { timeframes: ['1d'], priceBases:['last'],adjustments:['none','forward','backward'] }, price: { currency: 'CNY' } }, meta: this.meta(result,binding.source) }; }
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
        const read=async signal=>{const now=Date.now(),from={basis:'utc',unixMs:now-Math.min(3660,Math.max(31,input.tailLimit*3))*86400000},to={basis:'utc',unixMs:now+86400000};let cursor,result;const collected=[];do{result=await this.queryBars({...input,range:{from,to},page:{limit:2000,...(cursor?{cursor}:{})},includeForming:true},{...context,signal:signal??context.signal});collected.push(...result.data.page.items);cursor=result.data.page.nextCursor;}while(cursor);return{seriesId:result.data.seriesId,bars:collected.slice(-input.tailLimit),meta:{...result.meta,warnings:[...result.meta.warnings,'Daily public history is polled every 60 seconds. A current-day row is forming until 15:00 Asia/Shanghai; no minute bars are fabricated.']}}};
        return this.poll(await read(),read,context,(old,next)=>{const prior=new Map(old.bars.map(b=>[b.id,b.revision]));const bars=next.bars.filter(b=>prior.get(b.id)!==b.revision);return bars.length?[{type:'bars.upsert',payload:{seriesId:next.seriesId,bars}}]:[]});
    }
    poll(snapshot,read,context,events){const position={streamId:randomUUID(),epoch:randomUUID(),seq:'0'};let closed=false,started=false,timer,seq=0n,prior=snapshot,pending=Promise.resolve();const controller=new AbortController();const abort=()=>{closed=true;clearTimeout(timer);controller.abort()};context.signal?.addEventListener('abort',abort,{once:true});const handle={snapshot,position,consistency:'best_effort',recovery:'snapshot',close:async()=>{abort();context.signal?.removeEventListener('abort',abort);await pending.catch(()=>{});this.streams.delete(handle)},ready:emit=>{if(started||closed)return;started=true;const poll=()=>{if(closed)return;pending=(async()=>{try{const next=await read(AbortSignal.any([controller.signal,...(context.signal?[context.signal]:[])]));if(!closed){for(const event of events(prior,next))emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',observedAt:Date.now(),...event});prior=next}}catch(error){if(!closed)emit({...position,seq:String(++seq),eventId:randomUUID(),schemaVersion:'1.0.0',type:'stream.gap',payload:{code:error.code??'SOURCE_UNAVAILABLE',message:error.message,recovery:'snapshot'},observedAt:Date.now()});abort()}finally{if(!closed){timer=setTimeout(poll,60000);timer.unref?.()}}})();};timer=setTimeout(poll,60000);timer.unref?.()}};this.streams.add(handle);return handle;}
    async queryBars(input, context) {
        const binding = this.bound(context, input.instrument);
        check(input.spec?.timeframe === '1d' && input.spec.priceBasis === 'last', 'Only 1d last-price bars are supported', 'UNSUPPORTED_CAPABILITY');
        check(['none','forward','backward'].includes(input.spec.adjustment), 'adjustment must be none/forward/backward', 'UNSUPPORTED_CAPABILITY');
        check(input.spec.calendarRevision?.status === 'unknown', 'No pinned exchange calendar is supplied', 'UNSUPPORTED_CAPABILITY');
        check(['all', 'regular'].includes(input.spec.session), 'Unsupported session', 'UNSUPPORTED_CAPABILITY');
        const from = wall(input.range?.from), to = wall(input.range?.to);
        check(from < to, 'Range must be ascending');
        check(Date.parse(to + 'Z') - Date.parse(from + 'Z') <= 366 * 30 * 86400000, 'Maximum history range is 30 years');
        const result = await this.page(input, context, async () => { const name = binding.source === 'sina' ? 'stock_zh_a_daily' : binding.source==='tencent'?'stock_zh_a_hist_tx':'stock_zh_a_hist'; const args = { symbol: binding.source !== 'eastmoney' ? (/^(920|[48])/.test(input.instrument.instrumentId)?'bj':/^[69]/.test(input.instrument.instrumentId)?'sh':'sz')+input.instrument.instrumentId : input.instrument.instrumentId, start_date: from.slice(0, 10).replaceAll('-', ''), end_date: to.slice(0, 10).replaceAll('-', ''), adjust: {none:'',forward:'qfq',backward:'hfq'}[input.spec.adjustment], ...(binding.source === 'eastmoney' ? { period: 'daily' } : {}) }; check(binding.source !== 'sina' || /^[036]/.test(input.instrument.instrumentId), 'Sina adapter supports Shanghai/Shenzhen codes only', 'UNSUPPORTED_CAPABILITY'); const response = await this.fetch(name, args, context), seriesId = digest([input.instrument, input.spec]); const bars = response.rows.map(r => this.revise(mapBar(r, binding.source, seriesId, response.observedAt))).filter(b => b.openTime.value >= from && b.openTime.value < to && (input.includeForming !== false || b.isClosed)); return { items: bars, meta: this.meta(response, binding.source), extra: { seriesId, coverage: { requested: input.range, complete: false, reason: 'Upstream rows do not prove an authoritative exchange calendar or gap completeness' } } }; });
        return { data: { seriesId: result.extra.seriesId, page: result.data, coverage: result.extra.coverage }, meta: result.meta };
    }
}
export function wall(time) { if (time?.basis === 'utc') {
    check(Number.isSafeInteger(time.unixMs), 'Invalid UTC range');
    return new Date(time.unixMs + 8 * 3600000).toISOString().slice(0, 19);
} check(time?.basis === 'wall' && time.authority === authority && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(time.value), 'Range requires explicit Asia/Shanghai wall or UTC time'); check(Number.isFinite(Date.parse(time.value + 'Z')) && new Date(time.value + 'Z').toISOString().slice(0, 19) === time.value, 'Invalid date'); return time.value; }
export function mapBar(row, source, seriesId, observedAt) { const em = source === 'eastmoney', date = String(row[em ? '日期' : 'date']).slice(0, 10); check(/^\d{4}-\d\d-\d\d$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, 'Invalid upstream trading date'); const openTime = { basis: 'wall', authority, value: date + 'T09:30:00' }, endTime = { basis: 'wall', authority, value: date + 'T15:00:00' }, prices = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) => [key, decimal(row[em ? ['开盘', '最高', '最低', '收盘'][i] : key])])); const volume = row[em ? '成交量' : 'volume']; const quantity = volume === null || volume === undefined ? { status: 'unknown' } : { status: 'value', value: { value: decimal(volume), unit: em ? 'lot' : 'share' } }; return { id: `${seriesId}:${date}`, revision: '1', openTime, endTime, ...prices, isClosed: observedAt >= Date.parse(date + 'T15:00:00+08:00'), volume: { default: 'real', tick: { status: 'unsupported' }, real: quantity } }; }
