import { publicationFile, publishFiles } from './publications.js';
import { revealedCutoff } from './reveal-cutoff.js';
import { createHash } from 'node:crypto';

// Controller/audience only. No import from service/engine, no tool registration,
// no player DTO mutation, no file/network access and no account transactions.
// Native marker protocol: canvas-control/skills/market-chart/SKILL.md.
// Rectangle/range shading and triangle shapes are NOT public indicator primitives.
const HOUR = 3600000;
const ATTACHMENT_DIGEST = 'sha256:892e56f645853c81a0bd81a31b48b2155053c3160d5dc5930d25937d895f5495';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const check = (ok, message, code = 'INVALID_ARGUMENT') => { if (!ok) fail(code, message); };
const clone = x => structuredClone(x);
const canonical = x => x === undefined ? 'null' : x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
const digest = x => 'sha256:' + createHash('sha256').update(canonical(x)).digest('hex');
const time = x => { check(x?.basis === undefined || x.basis === 'utc', 'Marker ranges require UTC', 'UNSUPPORTED_CAPABILITY'); const ms = x?.basis === 'utc' ? x.unixMs : x; check(Number.isSafeInteger(ms) && Number.isFinite(new Date(ms).getTime()), 'Invalid UTC millisecond timestamp'); return ms; };
const utc = unixMs => ({ basis: 'utc', unixMs });
const price = x => { check(typeof x === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(x) && /[1-9]/.test(x), 'Marker price must be an exact Decimal string', 'SOURCE_DATA_INVALID'); return x; };
const ms = iso => Date.parse(iso);
const entry = x => Object.freeze(x);

// Concise attachment-derived comparisons, not a canonical manga/broker ledger.
// Unknown trade times are NEVER stored as fitted 18:10/18:45/20:00 timestamps.
// The default release policy for uncertain scenes is chapter_complete: do not
// reveal the eventual narrative outcome early within an unresolved interval.
export const ORIGINAL_REFERENCES = Object.freeze([
  entry({ id: 'aud-original-entry', symbol: 'AUDJPY', kind: 'interval', from: ms('2014-05-01T00:00:00Z'), to: ms('2014-06-01T00:00:00Z'), release: 'chapter_complete', evidence: 'attachment_claim', text: '附件原剧情锚：买入价95.610、50万AUD、余额811600 JPY；不是挑战仓位/余额，日期与成交时点未核实' }),
  entry({ id: 'aud-original-fluctuation', symbol: 'AUDJPY', kind: 'interval', from: ms('2014-05-01T00:00:00Z'), to: ms('2014-06-01T00:00:00Z'), release: 'chapter_complete', evidence: 'attachment_claim', text: '附件原剧情锚：95.889时浮盈139500 JPY，95.495时浮亏57500 JPY；先后与具体时间未独立核实' }),
  entry({ id: 'aud-fitted-rescue', symbol: 'AUDJPY', kind: 'interval', from: ms('2014-05-01T00:00:00Z'), to: ms('2014-06-01T00:00:00Z'), release: 'chapter_complete', evidence: 'fitted', text: '附件二创拟合：补入320万JPY、加仓价94.350/94.100、持仓250万AUD；均不进入挑战账户，不是原作逐笔成交' }),
  entry({ id: 'usd-before-nfp', symbol: 'USDJPY', kind: 'interval', from: ms('2014-12-05T00:00:00Z'), to: ms('2014-12-05T13:30:00Z'), release: 'window_end', evidence: 'fitted', text: '附件剧情/二创对照：非农前撤退；120.100开空、50万USD、120.240平仓与亏7万JPY为拟合，18:10等编排钟点不作成交时间' }),
  entry({ id: 'nfp-calendar-anchor', symbol: 'USDJPY', kind: 'historical_event', at: ms('2014-12-05T13:30:00Z'), evidence: 'attachment_event', text: '附件历史事件锚：美国就业数据公布13:30 UTC；非原剧情/挑战成交点，非农前交易时点仍未知' }),
  entry({ id: 'eur-fitted-entry', symbol: 'EURCHF', kind: 'interval', from: ms('2015-01-01T00:00:00Z'), to: ms('2015-01-15T09:30:00Z'), release: 'chapter_complete', evidence: 'fitted', text: '附件欧瑞对照：300万EUR为300枚换算；1.20100开仓价、19749835 JPY沿用余额为拟合；开仓只知候选区间' }),
  entry({ id: 'snb-calendar-anchor', symbol: 'EURCHF', kind: 'historical_event', at: ms('2015-01-15T09:30:00Z'), evidence: 'attachment_event', text: '附件历史事件锚：SNB取消汇率下限09:30 UTC；非成交回报，1.16触发讨论不等于可按1.16成交' }),
  entry({ id: 'eur-fitted-settlement', symbol: 'EURCHF', kind: 'interval', from: ms('2015-01-15T09:30:00Z'), to: ms('2015-01-16T00:00:00Z'), release: 'chapter_complete', evidence: 'fitted', text: '附件结局对照：资金不足101534644 JPY是附件原作主张；0.931479是反算拟合价、CHFJPY=150是假设，绝非查询到的真实成交' }),
]);

// Early bounded experience may show only a NON-OCCURRENCE context annotation:
// the attachment's uncertain candidate window, no future outcome/price/PnL.
// This is never a claim that an original trade happened at the displayed time.
export const ORIGINAL_AUDIENCE_CONTEXTS=Object.freeze([entry({id:'aud-candidate-context',symbol:'AUDJPY',kind:'interval',from:ms('2014-05-01T00:00:00Z'),to:ms('2014-06-01T00:00:00Z'),release:'audience_context',evidence:'attachment_claim',text:'附件原作澳日入场场景只知候选月窗；具体日期、先后与成交未独立核实。显示重叠仅为观众背景，不声称该动作已发生，不提供未来结果/资产/精确成交价。'})]);

function chapterFrame(data, ci, index) {
  const c = data.chapters[ci], rows = Array.isArray(data.frames) ? data.frames[ci] : data.frames?.[c.symbol] ?? data.frames?.[c.id];
  check(Array.isArray(rows), 'Chapter frames unavailable', 'SOURCE_UNAVAILABLE');
  return rows[rows.length > c.endIndex ? index : index - c.startIndex];
}

/** Build an immutable *audience* projection from already revealed engine facts.
 * Options instrument can be a symbol or exact kurumi InstrumentRef. from/to are
 * UTC-ms or SourceTime. Unknown narrative intervals have display bounds, never
 * a recovered trade timestamp/price. Original references cannot mutate state. */
export function buildMarkerSnapshot(service, options = {}) {
  const state = service.getState(), data = service.getData();
  check(state && data && typeof state.id === 'string', 'No active replay', 'SOURCE_UNAVAILABLE');
  check(Number.isSafeInteger(state.version) && state.version >= 1, 'Invalid replay version', 'SOURCE_DATA_INVALID');
  if (state.dataDigests) check(data.digests && digest(state.dataDigests) === digest(data.digests), 'Replay data no longer matches engine digests', 'CONNECTION_CHANGED');
  check(Number.isSafeInteger(state.chapter) && state.chapter >= 0 && state.chapter < data.chapters.length, 'Invalid current chapter', 'SOURCE_DATA_INVALID');
  const current = data.chapters[state.chapter];
  check(state.index >= current.startIndex && state.index <= current.endIndex, 'Invalid current revealed index', 'SOURCE_DATA_INVALID');
  const currentFrame = chapterFrame(data, state.chapter, state.index);
  check(currentFrame, 'Current revealed frame missing', 'SOURCE_UNAVAILABLE');
  const replayView = service.getReplayPresentation?.();
  const revealedTo = replayView?.cutoffMs ?? revealedCutoff(state,currentFrame);
  const requestedTo = options.to === undefined ? revealedTo : time(options.to);
  check(requestedTo <= revealedTo, 'Marker to exceeds currently revealed time', 'FUTURE_DATA_FORBIDDEN');
  const symbol = typeof options.instrument === 'string' ? options.instrument : options.instrument?.instrumentId ?? current.symbol;
  if (options.instrument?.sourceId) check(options.instrument.sourceId === 'kurumi:' + state.id, 'Marker source does not match replay', 'INSTRUMENT_MISMATCH');
  const ci = data.chapters.findIndex((c, i) => i <= state.chapter && c.symbol === symbol);
  check(ci >= 0, 'Marker instrument is not revealed', 'FUTURE_DATA_FORBIDDEN');
  const chapter = data.chapters[ci], last = ci < state.chapter ? chapter.endIndex : state.index;
  const firstFrame = chapterFrame(data, ci, chapter.startIndex), lastFrame = chapterFrame(data, ci, last);
  check(firstFrame && lastFrame, 'Revealed chapter endpoint missing', 'SOURCE_UNAVAILABLE');
  const chapterFrom = time(firstFrame.time), chapterTo = Math.max(time(lastFrame.time)+HOUR,...(replayView?.bars??[]).filter(b=>b.symbol===symbol).map(b=>b.toExclusive));
  const from = options.from === undefined ? chapterFrom : time(options.from);
  check(from < requestedTo, 'Marker range must be ascending');
  const visibleFrom = Math.max(from, chapterFrom), to = Math.min(requestedTo, chapterTo);
  check(visibleFrom < to, 'Requested range does not intersect a revealed chapter');
  const complete = (options.chapterEnded === true && ci === state.chapter) || ci < state.chapter || (ci === state.chapter && !state.bankrupt && state.status === 'complete' && last === chapter.endIndex);
  const rows = [];
  check(Array.isArray(state.fills), 'Actual fills ledger unavailable', 'SOURCE_UNAVAILABLE');
  // Never copy the full ledger/data/resources into the indicator/player context.
  for (const fill of state.fills) {
    const fillSymbol = typeof fill.instrument === 'string' ? fill.instrument : fill.instrument?.instrumentId ?? fill.symbol;
    if (fillSymbol !== symbol) continue;
    const at = time(fill.time);
    check(at <= revealedTo, 'Actual fill ledger contains future data', 'FUTURE_DATA_FORBIDDEN');
    if (at < visibleFrom || at > to) continue;
    check(typeof fill.id === 'string' && fill.id.length, 'Fill requires stable identity', 'SOURCE_DATA_INVALID');
    let side, quantity;
    if (fill.signedQuantity !== undefined) {
      check(typeof fill.signedQuantity === 'string' && /^-?[1-9]\d*$/.test(fill.signedQuantity), 'Actual fill signedQuantity invalid', 'SOURCE_DATA_INVALID');
      side = fill.signedQuantity.startsWith('-') ? 'sell' : 'buy'; quantity = fill.signedQuantity.replace(/^-/, '');
    } else {
      check(['buy', 'sell'].includes(fill.side), 'Actual fill side unavailable', 'SOURCE_DATA_INVALID'); side = fill.side; quantity = price(fill.quantity?.value ?? fill.quantity);
    }
    rows.push({ kind: 'actual', key: `actual:${state.id}:${fill.id}`, symbol, time: utc(at), side, quantity, unit: symbol.slice(0, 3), price: price(fill.price), simulated: true, actor: 'Sesame', eventType: 'fill', evidence: { ledger: 'fills', id: fill.id, orderId: fill.orderId ?? null, decisionId: fill.decisionId ?? fill.orderId ?? null, nativeEventNs: fill.nativeEventNs ?? null }, text: `${options.includeEvents ? 'Sesame · ' : ''}SIMULATED 实际${side === 'buy' ? '买' : '卖'} ${quantity} ${symbol.slice(0, 3)} @ ${fill.price}${fill.reason ? ' · ' + String(fill.reason) : ''}` });
  }
  if (options.includeEvents) {
    const add = (eventType, row, at, detail) => {
      check(Number.isSafeInteger(at) && at <= revealedTo, 'Event contains future/unknown time', 'FUTURE_DATA_FORBIDDEN');
      if(at < visibleFrom || at > to) return;
      check(typeof row.id === 'string' && row.id, 'Actual event requires identity', 'SOURCE_DATA_INVALID');
      rows.push({kind:'actual-event',key:`event:${state.id}:${eventType}:${row.id}`,symbol,time:utc(at),actor:'Sesame',eventType,
        evidence:{ledger:eventType,id:row.id,decisionId:row.decisionId??row.orderId??row.id,raw:clone(row),actorEvidence:options.eventEvidence?.[row.id]??null},
        simulated:true,text:`Sesame · SIMULATED ${eventType} · ${detail}`});
    };
    for(const order of state.orders??[]) if(order.chapter===ci) add('order',order,time(order.time),`${order.status} · target ${order.target??order.quantity??'unknown'} · stop ${order.stop??'none'}`);
    // Only actual native lifecycle rows; never infer a working stop from fills/targets.
    const nativeLatest = new Map();
    for (const row of state.nativeOrderTrace??[]) if(row.chapter===ci && row.instrument===symbol) { check(Number.isSafeInteger(row.time)&&row.time<=revealedTo,'Native order contains future/unknown event time','FUTURE_DATA_FORBIDDEN');check(typeof row.nativeClientOrderId==='string'&&row.nativeClientOrderId,'Native order identity missing','SOURCE_DATA_INVALID');nativeLatest.set(row.nativeClientOrderId,row); }
    for (const row of nativeLatest.values()) add('native-order-state',row,row.time,`原生 ${row.nativeClientOrderId} · ${row.status} / ${row.nativeStatus} · ${row.side} ${row.remainingQuantity} ${symbol.slice(0,3)} · stop ${row.stopPrice??'none'} · reduceOnly ${row.reduceOnly===true}（订单状态，不是额外成交）`);
    for(const d of state.decisions??[]) if(d.executedChapter===ci && d.decision?.id) add('decision',{...d.decision,executionTime:d.executionTime},time(d.executionTime),`目标 ${d.decision.target} · ${d.decision.reason??''}（执行关联时刻，非模型生成时刻）`);
    for(const fill of state.fills) if(fill.chapter===ci && /stop|liquidat|bankrupt|chapter_end/i.test(fill.reason??'')) add('risk-exit',fill,time(fill.time),fill.reason);
    for(const e of state.equity??[]) if(e.chapter===ci && e.quantity!==undefined) add('position-state',{...e,id:`${e.chapter}:${e.index}:${e.time}`},time(e.time),`已提交仓位 ${e.quantity} ${symbol.slice(0,3)}（状态而非额外成交）`);
  }
  const originals = [...(options.originals??ORIGINAL_REFERENCES),...(options.includeAudienceContext?ORIGINAL_AUDIENCE_CONTEXTS:[])];
  check(Array.isArray(originals), 'Original comparisons must be an explicit controller array');
  for (const original of originals) {
    if (original.symbol !== symbol) continue;
    check(typeof original.id === 'string' && typeof original.text === 'string' && original.text.length > 0 && original.text.length <= 2000, 'Original comparison needs id/text');
    check(['attachment_claim', 'fitted', 'calculated', 'attachment_event', 'official_event'].includes(original.evidence), 'Comparison evidence must explicitly distinguish claim, calculation and fitting');
    if (original.kind === 'historical_event') {
      const at = time(original.at);
      if (at < visibleFrom || at > to) continue;
      check(['attachment_event', 'official_event'].includes(original.evidence), 'Exact event anchors cannot masquerade as trade timestamps');
      if (original.evidence === 'official_event') check(typeof original.source === 'string' && /^https:\/\//.test(original.source), 'Official-event attribution requires an explicit public source');
      rows.push({ kind: 'original-event', key: 'original-event:' + original.id, symbol, time: utc(at), actor: 'Kurumi-original', evidence: original.evidence, text: `原剧情对照·历史事件（非成交） ${original.text}` });
    } else {
      check(original.kind === 'interval', 'Exact original trade markers are not supported; provide uncertainty interval');
      const lo = time(original.from), hi = time(original.to); check(lo < hi, 'Original interval must be ascending');
      const policy = original.release ?? 'window_end'; check(['window_end', 'chapter_complete','audience_context'].includes(policy), 'Invalid uncertainty release policy');
      // An overlapping unresolved uncertainty window is NOT evidence the scene
      // has occurred. Wait for the whole window, or an explicit chapter recap.
      check(policy!=='audience_context'||(options.includeAudienceContext===true&&original.id==='aud-candidate-context'),'Only explicit no-outcome audience context can release early','FUTURE_DATA_FORBIDDEN');
      const knownAt = policy==='audience_context'?revealedTo:policy === 'window_end' ? hi : chapterTo;
      if(policy!=='audience_context'&&(policy === 'window_end' ? hi > requestedTo : !complete || knownAt > requestedTo))continue;
      const start = Math.max(lo, visibleFrom), end = Math.min(hi, to);
      if (start >= end) continue;
      rows.push({ kind: 'original-interval', key: 'original-interval:' + original.id, symbol, from: utc(start), to: utc(end), actor: 'Kurumi-original', evidence: original.evidence, uncertaintyRange: {from:utc(lo),to:utc(hi)}, timePrecision: 'interval_only', releasePolicy:policy, occurrence:policy==='audience_context'?{status:'unknown',reason:'Candidate attachment window only, not evidence action has occurred'}:undefined,knownAtMeaning:policy==='audience_context'?'run audience disclosure clock; NOT historical event availability':'confirmed recap/window release',knownAt: utc(knownAt), text: `原剧情区间注释·非成交时点·${original.evidence === 'fitted' ? '二创拟合' : original.evidence === 'calculated' ? '计算推断' : '附件主张未独立核实'} ${original.text}` });
    }
  }
  check(new Set(rows.map(r => r.key)).size === rows.length, 'Duplicate marker identities');
  check(rows.length <= 50000, 'Marker snapshot exceeds row budget', 'RESOURCE_EXHAUSTED');
  const snapshot = { schemaVersion: '1.0.0', audienceOnly: true, simulated: true, runId: state.id, version: state.version, instrument: { sourceId: 'kurumi:' + state.id, instrumentId: symbol }, range: { from: utc(visibleFrom), to: utc(to) }, asOf: utc(revealedTo), originalSource: { type: 'user_attachment', title: '拟真剧情操作记录（原/算/拟）', digest: ATTACHMENT_DIGEST }, rows };
  snapshot.displayPolicy={default:'compact',detailMode:'events',maxFillMarkersPerDirectionPerH1:1,maxActiveStopMarkers:1,maxIntervalEndpointsPerH1:1,retention:'All source rows/text/evidence remain immutable; only their default chart geometry/text is selected',anchorPolicy:'containing disclosed H1 open only; exact source time unchanged; no across-gap or future placement',collisionMeaning:'Same-H1 same-direction fills display first price plus count, not an averaged execution',hoverCapability:'not declared by the public marker contract; no hover claim',details:'Read full fixed overlay rows through public chart_script(read).fixedInputs, or the pinned overlay DataRef'};
  for(const row of snapshot.rows) row.displayDetails={anchorPolicy:snapshot.displayPolicy.anchorPolicy,exactSourceTime:row.time??null,uncertaintyRange:row.uncertaintyRange??null,labelIsNotExecutionTime:true,fullText:row.text};
  return clone(snapshot);
}

/** Standalone pure native indicator compute function. It uses declared closed
 * chart bars and already frozen overlay rows. serialize via toString is safe:
 * no closures, SDK/private imports, host, files, network, clock or account access. */
export function compute(input) {
  const bars = input.inputs?.price?.rows ?? [], rows = input.inputs?.overlay?.rows ?? [];
  const disclosed = bars.filter(b => (b.isClosed === true || b.native?.revealedThrough?.basis === 'utc') && b.openTime?.basis === 'utc' && b.endTime?.basis === 'utc');
  const closed = bars.filter(b => b.isClosed === true && b.openTime?.basis === 'utc' && b.endTime?.basis === 'utc');
  const series = [{ seriesId: 'actual-buy', markers: [] }, { seriesId: 'actual-sell', markers: [] }, { seriesId: 'original-intervals', markers: [] }, { seriesId: 'original-events', markers: [] }, {seriesId:'actual-events',markers:[]}];
  if (!disclosed.length) return { status: 'not_ready', series, diagnostics: [] };
  const from = Math.min(...disclosed.map(b => b.openTime.unixMs)), to = Math.max(...disclosed.map(b => b.isClosed ? b.endTime.unixMs : b.native?.revealedThrough?.unixMs ?? b.openTime.unixMs));
  for (const row of rows) {
    if (row.kind === 'actual' && row.simulated === true && row.time?.basis === 'utc' && row.time.unixMs >= from && row.time.unixMs <= to && ['buy', 'sell'].includes(row.side)) {
      const candle = disclosed.find(b => b.openTime.unixMs <= row.time.unixMs && row.time.unixMs < b.endTime.unixMs && (b.isClosed || row.time.unixMs <= (b.native?.revealedThrough?.unixMs ?? b.openTime.unixMs)));
      if (!candle) continue; // no shifting a fill across a source gap or beyond disclosure
      const buy = row.side === 'buy';
      series[buy ? 0 : 1].markers.push({ key: row.key, time: candle.openTime, position: 'at_price', price: row.price, shape: buy ? 'arrow_up' : 'arrow_down', color: buy ? '#238b62' : '#c64f55', text: `真实成交时刻 ${new Date(row.time.unixMs).toISOString()}；H1显示锚 ${new Date(candle.openTime.unixMs).toISOString()}（非成交时点） · ${row.text}` });
    } else if (row.kind === 'actual-event' && row.actor === 'Sesame' && row.time?.basis === 'utc' && row.time.unixMs >= from && row.time.unixMs <= to) {
      const candle = disclosed.find(b => b.openTime.unixMs <= row.time.unixMs && row.time.unixMs < b.endTime.unixMs && (b.isClosed || row.time.unixMs <= (b.native?.revealedThrough?.unixMs ?? b.openTime.unixMs)));
      if(candle) { const native=row.eventType==='native-order-state'?row.evidence?.raw:null,atStop=native?.orderType==='stop'&&native.status==='working'&&typeof native.stopPrice==='string'&&/^[0-9]+(\.[0-9]+)?$/.test(native.stopPrice);series[4].markers.push({key:row.key,time:candle.openTime,position:atStop?'at_price':'below',...(atStop?{price:native.stopPrice}:{}),shape:'circle',color:'#648ab4',text:`原始事件时刻 ${new Date(row.time.unixMs).toISOString()}；H1显示锚（非额外成交） · ${row.text}`}); }
    } else if (row.kind === 'original-event' && row.time?.basis === 'utc' && row.time.unixMs >= from && row.time.unixMs <= to) {
      // PriceChart only gives no-price markers a series point on an exact bar
      // timestamp. Use the containing *closed* H1 open as display geometry;
      // never change the documentary event time in the frozen evidence row.
      const candle = closed.find(b => b.openTime.unixMs <= row.time.unixMs && row.time.unixMs < b.endTime.unixMs);
      if (!candle) continue; // no moving an event across a gap/onto the edge
      series[3].markers.push({ key: row.key, time: candle.openTime, position: 'above', shape: 'circle', color: '#956d32', text: `真实事件时刻 ${new Date(row.time.unixMs).toISOString()}；H1显示锚 ${new Date(candle.openTime.unixMs).toISOString()}（所在H1开盘位置，非成交时点） · ${row.text}` });
    } else if (row.kind === 'original-interval' && row.timePrecision === 'interval_only' && row.from?.basis === 'utc' && row.to?.basis === 'utc' && row.to.unixMs <= to && row.knownAt?.basis === 'utc' && row.knownAt.unixMs <= to) {
      const lo = Math.max(row.from.unixMs, from), hi = Math.min(row.to.unixMs, to);
      const visible = closed.filter(b => b.endTime.unixMs > lo && b.openTime.unixMs < hi).sort((a, b) => a.openTime.unixMs - b.openTime.unixMs);
      if (!visible.length) continue;
      // Circles are *display endpoints* of an uncertainty annotation, never
      // original trade times/prices. No unsupported rectangle/triangle API.
      const left = visible[0].openTime.unixMs, right = visible.at(-1).openTime.unixMs;
      series[2].markers.push({ key: row.key + ':left', time: { basis: 'utc', unixMs: left }, position: 'above', shape: 'circle', color: '#bd914b', text: `区间显示左界（H1开盘显示锚，非成交时点） [${new Date(lo).toISOString()} – ${new Date(hi).toISOString()}] ${row.text}` });
      if (right !== left) series[2].markers.push({ key: row.key + ':right', time: { basis: 'utc', unixMs: right }, position: 'above', shape: 'circle', color: '#bd914b', text: '区间显示右界（H1开盘显示锚，非成交时点） · ' + row.text });
    }
  }
  if(input.presentationAnalysis === true) {
    const closeLine={seriesId:'consumed-close',points:[]},sma={seriesId:'consumed-sma20',points:[]};
    for(let i=0;i<disclosed.length;i++) {
      const bar=disclosed[i];
      closeLine.points.push({key:bar.id??String(bar.openTime.unixMs),time:bar.openTime,value:{status:'value',value:bar.close}});
      if(i>=19) {
        const values=disclosed.slice(i-19,i+1).map(b=>Number(b.close));
        const mean=values.reduce((a,b)=>a+b,0)/20;
        if(Number.isFinite(mean)&&Math.abs(mean)<1e15) sma.points.push({key:bar.id??String(bar.openTime.unixMs),time:bar.openTime,value:{status:'value',value:mean.toFixed(12).replace(/0+$/,'').replace(/\.$/,'')}});
      }
    }
    series.push(closeLine,sma);
  }
  // Chart text is a compact geometric annotation, never the full event log.
  // Every documentary row remains in the immutable overlay; events mode is an
  // explicit opt-in. No invented hover callback or unsupported hidden flag.
  if (input.parameters?.label_mode !== 'events') {
    const labelPrice = value => {
      const raw=String(value),parts=raw.split('.');
      const shown=(parts[1]?.length??0)<3?parts[0]+'.'+(parts[1]??'').padEnd(3,'0'):raw;
      return shown.length<=10?shown:shown.slice(0,9)+'…'; // text-only elision, exact price untouched
    };
    // At most one arrow per direction per H1. Same-direction collisions show
    // first execution price and count, NOT a fabricated average/consolidation.
    for(const index of [0,1]) {
      const grouped=new Map();
      for(const m of series[index].markers) {
        const at=m.time.unixMs,entry=grouped.get(at);
        if(entry)entry.count++;else grouped.set(at,{marker:m,count:1});
      }
      series[index].markers=[...grouped.values()].map(({marker,count})=>({...marker,text:`${index===0?'买':'卖'} ${labelPrice(marker.price)}${count>1?' ×'+count:''}`}));
    }
    // Only the newest *evidenced active reduce-only stop* is resident. Held,
    // decision, position and historical cancelled/filled states stay in data.
    const working=rows.filter(r=>r.kind==='actual-event'&&r.eventType==='native-order-state'&&r.time?.basis==='utc'&&r.time.unixMs<=to&&r.evidence?.raw?.orderType==='stop'&&r.evidence.raw.status==='working'&&r.evidence.raw.reduceOnly===true&&Number(r.evidence.raw.remainingQuantity)>0).sort((a,b)=>b.time.unixMs-a.time.unixMs);
    const chosen=working.find(r=>series[4].markers.some(m=>m.key===r.key));
    series[4].markers=chosen?series[4].markers.filter(m=>m.key===chosen.key).map(m=>({...m,text:'止损 '+labelPrice(m.price)})):[];
    // Keep amber range boundaries, not a fake original fill. One label per
    // range and at most one amber endpoint per H1; right endpoint is unlabelled.
    const occupied=new Set(),labelled=new Set();
    series[2].markers=series[2].markers.filter(m=>{const at=m.time.unixMs;if(occupied.has(at))return false;occupied.add(at);return true;}).map(m=>{
      const root=m.key.replace(/:(left|right)$/,''),out={...m};delete out.text;
      if(!labelled.has(root)){out.text='原作区间';labelled.add(root);}return out;
    });
    series[3].markers=[]; // full historical event details remain frozen/readable
  }
  return { status: 'ready', series, diagnostics: [] };
}

/** Freeze a bounded code indicator for the exact current/past revealed symbol.
 * Call again on controller display with a NEW operationId after actual progress;
 * this is a static saved overlay, never an automatic subscription or player tool. */
export function createMarkerIndicator(service, options = {}) {
  const snapshot = buildMarkerSnapshot(service, options);
  const source = options.overlayRef
    ? `// Fixed disclosed data binding; audience only.\nconst evaluate = ${compute.toString()};\nexport function compute(input) { return evaluate({ ...input, presentationAnalysis: ${options.includeEvents === true} }); }\n`
    : `// Audience-only immutable disclosed overlay; never a player input.\nconst OVERLAY = ${JSON.stringify(snapshot.rows)};\nconst evaluate = ${compute.toString()};\nexport function compute(input) { return evaluate({ ...input, presentationAnalysis: ${options.includeEvents === true}, inputs: { ...input.inputs, overlay: { rows: OVERLAY } } }); }\n`;
  check(Buffer.byteLength(source) <= 32768, 'Marker code exceeds 32 KiB; request a smaller revealed range', 'RESOURCE_EXHAUSTED');
  const definition = {
    schemaVersion: '1.0.0', title: `${snapshot.instrument.instrumentId} · ${options.includeEvents ? '原作久留美 vs Sesame实际模拟交易' : '原剧情区间与实际模拟成交'}`,
    description: '观众静态对照。默认简短标签、同H1同向成交聚合显示第一笔价格和笔数、只显示最新有效保护单；完整时间/理由/订单与来源在固定overlay详情中保留。标记位于所属H1显示锚，不冒充精确成交时刻；公开契约未声明hover。SMA20以binary64计算并包含已揭示形成柱。绿/红箭头为真实账本的SIMULATED买/卖；琥珀圆点是原剧情未知时点的区间显示边界，非成交点。历史事件圆点定位到所在已收盘H1开盘位置，文字保留真实事件时刻，非交易。全部只含已揭示时间，不写账户，不给角色。',
    parameters: [{id:'label_mode',type:'enum',required:false,title:'标注密度',default:'compact',choices:['compact','events']}], inputs: [{ id: 'price', kind: 'bars', binding: 'chart', lookback: 50000, forming: options.includeEvents ? 'include' : 'closed_only' }], panes: [{ id: 'price', placement: 'main' }],
    series: [
      { id: 'actual-buy', title: '买入', color: '#238b62' },
      { id: 'actual-sell', title: '卖出', color: '#c64f55' },
      { id: 'original-intervals', title: '原作区间', color: '#bd914b' },
      { id: 'actual-events', title: '保护', color: '#648ab4' },
      { id: 'original-events', title: '事件', color: '#956d32' },
    ].map(({ color, ...s }) => ({ ...s, paneId: 'price', type: 'markers', unit: 'price', scale: { mode: 'price', scaleId: 'price' }, style: { color } })),
    implementation: { kind: 'code', entry: 'markers.js', language: 'javascript', runtime: 'sesame-indicator/1', dependencies: [] },
  };
  if(options.overlayRef){check(options.overlayRef.kind==='data'&&typeof options.overlayRef.revision==='string'&&/^sha256:[a-f0-9]{64}$/.test(options.overlayRef.digest??''),'Fixed marker DataRef required');definition.inputs.push({id:'overlay',kind:'data',binding:'fixed',data:clone(options.overlayRef),lookback:50000,forming:'closed_only'});}
  if(options.includeEvents) definition.series.push(...[{id:'consumed-close',title:'价格',color:'#648ab4'},{id:'consumed-sma20',title:'SMA20',color:'#9d86b8'}].map(({color,...r})=>({...r,paneId:'price',type:'line',unit:'price',scale:{mode:'price',scaleId:'price'},style:{color,width:1}})));
  return { definition, files: { 'markers.js': source }, snapshot, snapshotDigest: digest(snapshot), static: true };
}

/** Public HostContext publication helper for main-Agent display(). No layout is
 * changed here. Mount ref with host.views.apply({surface:'indicator',action:'put',chart_id,...}). */
export async function publishMarkers(host, service, options) {
  check(host.context?.kind === 'main', 'Audience marker publication is main-Agent only', 'SCOPE_DENIED');
  check(/^[A-Za-z0-9_-]{16,128}$/.test(options?.operationId ?? ''), 'Provide a stable indicator publication operationId');
  const bundle = createMarkerIndicator(service, options);
  const blobs = Object.entries(bundle.files).map(([path, content]) => ({ ...publicationFile(content), path, mediaType: 'text/javascript' }));
  // The frozen audience DTO is packaged as provenance/evidence, not passed to
  // compute or role tools. It contains only the revealed projection, no ledger
  // balance, raw story attachment, future resource, model or credentials.
  blobs.push({ ...publicationFile(JSON.stringify(bundle.snapshot)), path: 'revealed-markers.json', mediaType: 'application/json' });
  const ref = await publishFiles(host, { operationId: options.operationId, manifest: { kind: 'indicator', schemaVersion: '1.0.0', content: bundle.definition, dependencies: [], blobs, provenance: { kind: 'demo', references: [] } } });
  return { ref, instrument: bundle.snapshot.instrument, asOf: bundle.snapshot.asOf, range: bundle.snapshot.range, static: true, audienceOnly: true, markerCount: bundle.snapshot.rows.length, bundle: { definition: bundle.definition, files: bundle.files, snapshot: bundle.snapshot, snapshotDigest: bundle.snapshotDigest }, note: '仅已揭示范围的静态指标；挂载后须检查真实前端回执。推进后用新operationId重发；不可加入角色snapshot/工具allowlist。原剧情未知时点只用区间文本，不提供矩形阴影或精确成交声称。' };
}
