// Maintained here; sync-boundary-helpers.mjs copies this into independently installed plugins.
import { randomUUID } from 'node:crypto';
export async function readArtifact(host,ref) {return {ref,manifest:await host.resources.read(ref,{part:'manifest'})};}
export async function readEntry(host,ref,entry,maxBytes=32*1024*1024) {
 const parts=[];let offset=0;
 do {const value=await host.resources.read(ref,{part:'content',entry,offset,length:256*1024,encoding:'base64'});if(value.total>maxBytes)throw new Error('Artifact entry exceeds declared read budget');parts.push(Buffer.from(value.content,'base64'));offset=value.nextOffset;if(offset!==undefined&&value.length===0)throw new Error('Artifact read made no progress');}while(offset!==undefined);
 return Buffer.concat(parts);
}
export async function publishFiles(host,{operationId,kind,content,files={},dependencies=[],provenance,artifactId,expectedRevision},signal) {
 const root=await host.resources.create({kind:'directory',lifetime:'durable',name:'publication-'+randomUUID()},{signal});
 try {
  const entries=Object.entries(files);if(!entries.length)entries.push(['manifest-content.json',JSON.stringify(content)]);
  const blobs=[];
  for(const [index,[path,input]]of entries.entries()) {const bytes=Buffer.from(input?.bytes??input),name='entry-'+index;await host.resources.create({kind:'blob',parent:root,name,lifetime:'durable',source:{content:bytes.toString('base64'),encoding:'base64'}},{signal});blobs.push({entry:name,path,mediaType:input?.mediaType??(path.endsWith('.py')?'text/x-python':'application/json')});}
  const result=await host.resources.publish(root,{kind,schemaVersion:'1.0.0',content,dependencies,blobs,...(provenance?{provenance}:{})},{...(operationId?{operationId}:{}),...(artifactId?{artifactId,expectedRevision}:{}),signal});return result.ref;
 }finally{await host.resources.remove(root,{expectedVersion:root.version,mode:'permanent'});}
}
