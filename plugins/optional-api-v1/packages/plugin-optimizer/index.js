import { join } from 'node:path';
import { perform } from '@sesame/plugin-sdk/evaluation';
import { readPackageDirectory } from '@sesame/plugin-sdk/surface';

const commands = readPackageDirectory(new URL('.',import.meta.url)).tools.map(tool=>tool.name);
export function createCapabilities(host) {
  return commands.map(name=>({name,async execute(args) {
    const context=host.context;
    if (!context.workspaceRoot) throw Error('A conversation workspace is required');
    return perform(name.slice('optimizer_'.length).replace('_','.'),args,{
      draftRoot:join(context.workspaceRoot,'plugin-drafts'),recordRoot:join(context.storageRoot,'sessions',context.sessionId),
      async query(command,filter) {
        const providerId=command==='findings.inbox'?'host#findings':'host#traces';
        const sources=await host.data.sources({providerId});
        if(!sources.items[0]) throw Error('The host data source is unavailable');
        const {limit=50,cursor,...query}=filter;
        return host.data.query({source:sources.items[0].ref,input:query,limit,...(cursor?{cursor}:{})});
      }
    });
  }}));
}
