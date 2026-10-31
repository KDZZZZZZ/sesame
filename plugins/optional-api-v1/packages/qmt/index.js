import { capability } from './execution.js';
import { closeRecords } from './records.js';
import { sourceCapabilities } from './source.js';
import { createService } from './service.js';
import { configure, environment } from './configuration.js';
import { createTradingCapabilities } from './trading-context.js';
import { createPositionCapabilities } from './positions.js';

const services = new Map();
function service(host) { const key = host.context.storageRoot; if (!services.has(key)) services.set(key, createService(host)); return services.get(key); }

export function createCapabilities(host) {
return [
 ...sourceCapabilities(host,()=>service(host)),
 ...createPositionCapabilities(host,()=>service(host)),
 capability('qmt_dispose',async()=>{await services.get(host.context.storageRoot)?.dispose();services.delete(host.context.storageRoot);closeRecords(host);return{closed:true};}),
    capability('qmt_environment', (args, signal) => environment(host, args, signal)),
    capability('qmt_configure', args => configure(host, args)),
    capability('qmt_read', (args, signal) => service(host).native(args.action, { query: args.query ?? '', ...(args.symbols ? { symbols: args.symbols } : {}), ...(args.page ? { page: args.page } : {}) }, signal)),
    capability('qmt_download_history', (args,signal)=>service(host).download(args,signal)),
    capability('qmt_order', (args,signal)=>service(host).command('order',args,signal,host.context)),
    capability('qmt_cancel', (args,signal)=>service(host).command('cancel',args,signal,host.context)),
    capability('qmt_command', args=>service(host).commandRecord(args.operation_id,host.context)),
    ...createTradingCapabilities(host, {native:(...args)=>service(host).native(...args),command:(...args)=>service(host).command(...args),commandRecord:(...args)=>service(host).commandRecord(...args)}),
  ];
}
