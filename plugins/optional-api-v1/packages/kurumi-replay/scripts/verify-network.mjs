// Explicit tiny HTTPS GET diagnostic only. Never installs dependencies, changes
// system proxy/TLS, publishes ready flags or overwrites the challenge/cache.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fetchBounded,hash,decimal} from './data-core.mjs';
import {preflightBi5} from './data-detail.mjs';
const [storage,output]=process.argv.slice(2);
async function verify(){if(!storage||!output)throw Error('Pass existing plugin storage and diagnostic output directory');
const require=createRequire(import.meta.url),root=path.join(storage,'kurumi-data-v1/deps/node_modules');
const pkg=require(path.join(root,'dukascopy-node/package.json'));if(pkg.version!=='1.46.4')throw Error('Pinned decoder required');
const d=require(path.join(root,'dukascopy-node/dist/index.js')),lzma=require(path.join(root,'lzma-purejs-requirejs/main.js'));
const url='https://datafeed.dukascopy.com/datafeed/EURCHF/2015/00/15/09h_ticks.bi5';
const r=await fetchBounded(url,65536,undefined,{policy:{maxAttempts:2}});const decodedBytes=preflightBi5(r.bytes,1048576,lzma,url);
const decode=side=>d.processData({instrument:'eurchf',requestedTimeframe:'tick',bufferObjects:[{url,buffer:r.bytes}],priceType:side,volumes:true,volumeUnits:'millions',ignoreFlats:true});
const bid=decode('bid'),ask=decode('ask');if(bid.length!==ask.length||bid.some((q,i)=>q[0]!==ask[i][0]))throw Error('Sides/time mismatch');
const row=i=>({time:new Date(bid[i][0]).toISOString(),bid:decimal(bid[i][1],5),ask:decimal(ask[i][1],5),volume:null,volumeKind:'none'});
const receipt={diagnosticOnly:true,formalReadyUnchanged:true,node:process.version,workerEnvProxyEnabled:process.execArgv.includes('--use-env-proxy')||process.env.NODE_USE_ENV_PROXY==='1',proxyConfigured:Boolean(process.env.https_proxy||process.env.HTTPS_PROXY||process.env.http_proxy||process.env.HTTP_PROXY),url,requestedUrl:r.requestedUrl,observedAt:r.observedAt,status:r.status,tlsAuthenticated:r.tlsAuthenticated,headers:r.responseHeaders,attempts:r.attempts,networkBytes:r.networkBytes,bytes:r.bytes.length,digest:hash(r.bytes),decodedBytes,tickCount:bid.length,first:row(0),last:row(bid.length-1)};
if(receipt.bytes!==6162||receipt.digest!=='sha256:3c8a29abfba0ffff4d7d40f70d9968fb6514136419dc0c6949ed638cad82a148'||receipt.tickCount!==973)throw Error('New HTTPS source differs from supplied expected bytes/count; do not replace old challenge data');
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'https-probe.bi5'),r.bytes,{flag:'wx'});await fs.writeFile(path.join(output,'https-get-decoded.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt,null,2));

}
verify().catch(async e=>{if(output){await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'https-get-failure.json'),JSON.stringify({diagnosticOnly:true,node:process.version,workerEnvProxyEnabled:process.execArgv.includes('--use-env-proxy'),proxyConfigured:Boolean(process.env.https_proxy||process.env.HTTPS_PROXY||process.env.http_proxy||process.env.HTTP_PROXY),observedAt:new Date().toISOString(),code:e.code??'VERIFY_FAILED',message:e.message,details:e.details??null},null,2)+'\n');}console.error(e.code??'VERIFY_FAILED',e.message);process.exitCode=1;});
