import { publishFiles } from './artifact-files.js';
export { readArtifact, readEntry, publishFiles } from './artifact-files.js';
export async function publishRows(host,data,dependencies=[],signal) {
 return publishFiles(host,{kind:'data',content:{format:'json-rows',title:data.title,path:'rows.json',rowCount:data.rows.length,columns:Object.keys(data.rows[0]??{}).map(key=>({key})),provenance:data.provenance},files:{'rows.json':JSON.stringify(data.rows)},dependencies},signal);
}
