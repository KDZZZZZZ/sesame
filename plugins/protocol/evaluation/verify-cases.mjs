import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readCase, packageSnapshot, runCase } from './replay.mjs';
import { sandboxCall } from './sandbox.mjs';
const plugins=fileURLToPath(new URL('../../',import.meta.url));
const results=[];
for(const profile of ['api-v1','optional-api-v1']) {
  const base=join(plugins,profile,'packages');
  for(const name of readdirSync(base)) {
    const root=join(base,name),pkg=packageSnapshot(root),dir=join(root,'evals','cases');
    for(const file of readdirSync(dir).filter(name=>name.endsWith('.yaml'))) {
      try {
        const report=runCase(pkg,readCase(join(dir,file)),sandboxCall);
        if(report.passed!==report.total) throw Error(JSON.stringify(report.checks.filter(rule=>!rule.pass)));
        results.push(report);
      } catch(error) {process.exitCode=1;console.error(pkg.manifest.id+'/'+file+': '+error.message);}
    }
  }
}
console.log(JSON.stringify({packages:new Set(results.map(r=>r.tree)).size,cases:results.length,assertions:results.reduce((n,r)=>n+r.passed,0)}));
