import { randomUUID } from 'node:crypto';
import { capability } from '@sesame/plugin-sdk/capabilities';
import { AKShareProvider } from './provider.js';
import { subscription } from './source-stream.js';

const instances = new Map();
const provider = host => { const key = host.context.storageRoot; if (!instances.has(key)) instances.set(key, new AKShareProvider(host)); return instances.get(key); };
export function sourceCapabilities(host) {
 const query = (method, paged) => capability('market_' + method, async ({binding,query,page},signal) => {
   const result = await provider(host)[method]({...query,...(paged?{page}: {})},{bindingId:binding.bindingId,signal});
   if (method === 'queryBars') { const {page:bars,...metadata}=result.data; return {items:bars.items,...(bars.nextCursor?{nextCursor:bars.nextCursor}:{}),metadata:{...metadata,snapshotId:bars.snapshotId,consistency:bars.consistency,meta:result.meta,connection:binding.connection}}; }
   const data = result.data;
   return {items:paged?data.items:[data],...(data.nextCursor?{nextCursor:data.nextCursor}:{}),metadata:{...(data.snapshotId?{snapshotId:data.snapshotId,consistency:data.consistency}:{}),meta:result.meta,connection:binding.connection}};
 });
 return [
  capability('market_bind',async({binding},signal)=>{const bindingId=randomUUID();return{...await provider(host).bind(binding,{bindingId,signal}),bindingId};}),
  capability('market_unbind',async({binding})=>{await provider(host).unbind({bindingId:binding.bindingId});return{closed:true};}),
  query('searchInstruments',true),query('describeInstrument',false),query('queryBars',true),
  ...['subscribeBars','subscribeQuotes'].map(method=>capability('market_'+method,async({binding,query},signal)=>subscription(await provider(host)[method](query,{bindingId:binding.bindingId,signal}),signal))),
  capability('akshare_dispose',async()=>{const item=instances.get(host.context.storageRoot);if(item){await item.dispose();instances.delete(host.context.storageRoot);}  return{closed:true};})
 ];
}
