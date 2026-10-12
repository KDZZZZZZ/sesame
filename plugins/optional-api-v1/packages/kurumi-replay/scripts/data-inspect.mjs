// PURE LOCAL diagnostic of a genuine retained original hour. No installation,
// GET, synthetic quote, snapshot publication or native-ready claim. Its wire
// kind deliberately differs from formal 'ticks', so native advance rejects it.
import path from 'node:path';
import { createRequire } from 'node:module';
import { hash, readBounded, fail, decimal, validMarketSource, HOUR } from './data-core.mjs';
import { verifyDependencies } from './data-install.mjs';
import { preflightBi5 } from './data-detail.mjs';
export async function inspectCachedHour(root, cfg, {chapterId,symbol,from,to,maxRows}) {
  const ch=cfg.chapters.find(c=>c.id===chapterId);symbol ||= ch?.symbol;
  if(!ch || ![ch.symbol,ch.fxSymbol].includes(symbol) || from<Date.parse(ch.playFrom) || to>=Date.parse(ch.to)+HOUR || Math.floor(from/HOUR)!==Math.floor(to/HOUR))fail('INVALID_SLICE','诊断仅可检查指定章节玩法范围中的一个真实UTC小时，不发布部分ready。');
  const t=Math.floor(from/HOUR)*HOUR,d=new Date(t),url=`${cfg.provider.source}/${symbol}/${d.getUTCFullYear()}/${String(d.getUTCMonth()).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCHours()).padStart(2,'0')}h_ticks.bi5`;
  const base=`http-cache/${hash(url).slice(7)}`,sourcePath=`${base}.bin`,metaPath=`${base}.json`;
  const receiptBytes=await readBounded(root,metaPath,16384),meta=JSON.parse(receiptBytes),bytes=await readBounded(root,sourcePath,8*1024*1024);
  if(meta.schemaVersion!==1 || meta.httpStatus!==200 || !validMarketSource({...meta,transportScheme:meta.scheme},url,cfg.provider.marketTransport.allowSameOriginHttpsRedirect) || !Number.isSafeInteger(meta.bytes) || meta.bytes<1 || bytes.length!==meta.bytes || hash(bytes)!==meta.digest || typeof meta.observedAt!=='string' || !meta.observedAt.endsWith('Z') || !Number.isFinite(Date.parse(meta.observedAt)))fail('SOURCE_MISMATCH','本地诊断原文件的真实URL/HTTP200/UTC/字节摘要不匹配；不联网补值。');
  await verifyDependencies(root,cfg);
  const require=createRequire(import.meta.url),duka=require(path.join(root,'deps/node_modules/dukascopy-node/dist/index.js')),lzma=require(path.join(root,'deps/node_modules/lzma-purejs-requirejs'));
  preflightBi5(bytes,10*1024*1024,lzma,meta.url);
  const decoded=duka.processData({instrument:symbol.toLowerCase(),requestedTimeframe:'tick',bufferObjects:[{url:meta.url,buffer:bytes}],priceType:'bid',volumes:true,volumeUnits:'millions',ignoreFlats:true});
  const digits=symbol===ch.symbol?ch.digits:ch.fxDigits,rows=[];let previous=-Infinity;
  for(const q of decoded){
    if(!Number.isSafeInteger(q[0]) || q[0]<previous || q[0]<t || q[0]>=t+HOUR || q[1]<q[2])fail('TIME_MISMATCH','真实小时原始tick时间/顺序/bidask非法；暂停诊断。');
    previous=q[0];const bid=decimal(q[2],digits),ask=decimal(q[1],digits);
    if(q[0]>=from&&q[0]<=to){rows.push({time:q[0],bid,ask,source:sourcePath});if(rows.length>maxRows)fail('SLICE_LIMIT','真实诊断切片超额；缩小窗口，不截断。',{maxRows});}
  }
  if(!rows.length)fail('NO_QUOTES','这个诊断区间没有真实报价，不沿用或制造报价。');
  if(hash(await readBounded(root,metaPath,16384))!==hash(receiptBytes))fail('SNAPSHOT_CHANGED','诊断读取期间收据发生变化；拒绝不同版本。');
  return {storageRoot:root,storageNamespace:'kurumi-data-v1',kind:'inspection_ticks',dataKind:'quote_ticks',symbol,chapterId,from,to,rangeConvention:'inclusive UTC milliseconds',rows,sources:[{path:sourcePath,url:meta.url,requestedUrl:meta.requestedUrl||url,redirectHistory:meta.redirectHistory||[],bytes:meta.bytes,digest:meta.digest,httpStatus:meta.httpStatus,observedAt:meta.observedAt,transportScheme:meta.scheme,tlsAuthenticated:meta.tlsAuthenticated,receiptDigest:hash(receiptBytes)}],diagnosticOnly:true,formalReady:false,complete:false,decodedHourRowCount:decoded.length,historicalGaplessnessCertified:false,liquidityAssumption:null};
}
