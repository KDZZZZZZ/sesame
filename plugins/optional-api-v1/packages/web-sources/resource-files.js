import { publishFiles } from './artifact-files.js';
export { readArtifact, readEntry, publishFiles } from './artifact-files.js';
export async function publishRows(host,data,dependencies=[],signal) {
 const raw=data.source?{raw:{path:'source.txt',mediaType:data.source.content_type,encoding:data.source.encoding}}:{};
 return publishFiles(host,{kind:'data',content:{format:'json-rows',title:data.title,path:'rows.json',rowCount:data.rows.length,columns:Object.keys(data.rows[0]??{}).map(key=>({key})),provenance:data.provenance,...raw,...(data.metadata?{metadata:data.metadata}:{})},files:{'rows.json':JSON.stringify(data.rows),...(data.source?{'source.txt':{bytes:data.source.bytes,mediaType:data.source.content_type||'text/plain'}}:{})},dependencies},signal);
}
