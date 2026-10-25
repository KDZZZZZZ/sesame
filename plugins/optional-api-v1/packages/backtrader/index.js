import { capability } from '@sesame/plugin-sdk/capabilities';
import { closeRecords } from './records.js';
import { readArtifact } from './resource-files.js';
import { environment } from './environment.js';
import { backtest } from './backtest.js';
export { fixedRows } from './fixed-input.js';

export function createCapabilities(host) {
return [
    capability('backtrader_dispose',()=>{closeRecords(host);return{closed:true};}),
    capability("backtrader_environment", (args, signal) => environment(host, args, signal)),
    capability("backtrader_backtest", (args, signal) => backtest(host, args, signal)),
    capability("backtrader_result", async (args) => await readArtifact(host,args.ref)),
  ];
}
