// Explicit diagnostic worker: ONE fixed public file, never an activation hook.
// Start using --use-env-proxy and NODE_USE_ENV_PROXY=1 in the CHILD environment.
// No global network edits, private host imports, TLS bypass or model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { channel } from 'node:diagnostics_channel';
import { config, storage, hash, decimal, backoffDelay, assertEnvironmentProxyActive } from './data-core.mjs';
import { cachedMarketFile } from './data-cache.mjs';
import { preflightBi5 } from './data-detail.mjs';
import { verifyDependencies } from './data-install.mjs';
const directory = process.argv[2], waitMs = Number(process.argv[3] || 0);
if (!directory || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 120000) throw new Error('Usage: node --use-env-proxy check-market-transport.mjs <existing-storage-directory> [wait-ms<=120000]');
assertEnvironmentProxyActive();
const selected = process.env.https_proxy || process.env.HTTPS_PROXY;
const proxy = selected ? new URL(selected) : null;
const proxyPort = proxy ? Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)) : null;
const observations = { configuredProxyConnectSeen: false, connectedProxyPortSeen: false, publicOriginConnectSeen: false };
// Capture categories only: never output proxy address/auth or headers.
const before = ({connectParams:p}) => {
  if (proxy && p.hostname === proxy.hostname && Number(p.port) === proxyPort) observations.configuredProxyConnectSeen = true;
  if (p.hostname === 'datafeed.dukascopy.com') observations.publicOriginConnectSeen = true;
};
const connected = ({socket}) => { if (proxy && socket.remotePort === proxyPort) observations.connectedProxyPortSeen = true; };
channel('undici:client:beforeConnect').subscribe(before); channel('undici:client:connected').subscribe(connected);
const url = 'https://datafeed.dukascopy.com/datafeed/EURCHF/2015/00/15/09h_ticks.bi5';
const started = performance.now(); let result;
try {
  await backoffDelay(waitMs);
  const root = await storage(directory, false), {value: cfg} = await config();
  await verifyDependencies(root, cfg);
  const require = createRequire(import.meta.url), duka = require(path.join(root,'deps/node_modules/dukascopy-node/dist/index.js'));
  const lzma = require(path.join(root,'deps/node_modules/lzma-purejs-requirejs'));
  const r = await cachedMarketFile(root,url,1024*1024,{minimumSpacingMs:250,fetchOptions:{policy:{maxAttempts:1}},validate:bytes=>preflightBi5(bytes,10*1024*1024,lzma,url)});
  if (r.bytes.length!==6162 || hash(r.bytes)!==cfg.provider.marketTransport.probe.sha256) throw new Error('Genuine GET differs from fixed reference bytes');
  const rows=duka.processData({instrument:'eurchf',requestedTimeframe:'tick',bufferObjects:[{url:r.url,buffer:r.bytes}],priceType:'bid',volumes:true,volumeUnits:'millions',ignoreFlats:true});
  if(rows.length!==973 || rows.some((r,i)=>!Number.isSafeInteger(r[0]) || (i&&r[0]<rows[i-1][0]) || r[1]<r[2]))throw new Error('Genuine decoded source invalid');
  const book=q=>({time:q[0],bid:decimal(q[2],5),ask:decimal(q[1],5)});
  result={success:true,url:r.url,requestedUrl:r.requestedUrl,bytes:r.bytes.length,digest:hash(r.bytes),rows:rows.length,first:book(rows[0]),last:book(rows.at(-1)),transport:r.transport,tlsAuthenticated:r.tlsAuthenticated,responseHeaders:r.responseHeaders,cache:r.cache,reused:r.reused,attempts:r.attempts};
}catch(e){result={success:false,url,error:{code:e.code,message:e.message,details:e.details},ready:false};}
finally{channel('undici:client:beforeConnect').unsubscribe(before);channel('undici:client:connected').unsubscribe(connected);}
result.scope='single_file_transport_diagnostic_not_full_prepare';result.ready=false;
result.elapsedMs=Math.round(performance.now()-started);
result.worker={node:process.version,envProxyFlag:process.execArgv.includes('--use-env-proxy'),envProxyVariable:process.env.NODE_USE_ENV_PROXY==='1',hasHttpsProxy:!!selected,noProxyConfigured:!!(process.env.no_proxy||process.env.NO_PROXY),tlsValidationDisabled:process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0',observations};
// Receipt is a caller-level diagnostic, NOT a data-ready manifest or market row.
await fs.writeFile(path.join(path.resolve(directory),'verification-transport-worker.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
