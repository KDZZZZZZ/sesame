import { capability } from '@sesame/plugin-sdk/capabilities';
import { fetchSource } from './fetch.js';
import { digest,now } from './support.js';
import { parseRows } from './data.js';
import { publishRows } from './resource-files.js';
async function query(url,signal) {const source=await fetchSource(url,signal);const rows=/json|csv/.test(source.content_type)||/\.(json|csv)(?:$|\?)/i.test(source.url)?parseRows(source.text,/csv/.test(source.content_type)||/\.csv(?:$|\?)/i.test(source.url)?'data.csv':'data.json'):[{url:source.url,text:source.text}];return{source,rows,provenance:{kind:'observed',source_kind:'external',provider:source.url,as_of:now(),data_hash:digest(source.text),content_type:source.content_type}};}
export function createCapabilities(host) {return [
 capability('sources_fetch',async({url},signal)=>{const value=await query(url,signal),ref=await publishRows(host,{title:value.source.url,rows:value.rows,provenance:value.provenance},[],signal);return{ref,text:value.source.text.slice(0,20000),rowCount:value.rows.length,provenance:value.provenance};}),
 capability('http_query',async({query:input},signal)=>{const value=await query(input.url,signal);return{items:value.rows,metadata:{provenance:value.provenance}};})
 ];}
