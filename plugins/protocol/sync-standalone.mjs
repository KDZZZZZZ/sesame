import {copyFileSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('.',import.meta.url));
const targets = ['../api-v1/packages/plugin-manager/protocol','../optional-api-v1/packages/quantskills-catalog/protocol'];
for (const target of targets) {
  for (const name of ['package.mjs','directory.mjs','vendor/yaml.mjs','vendor/yaml.LICENSE']) {
    const from = join(source,name), to = join(source,target,name);
    if (process.argv.includes('--write')) {
      mkdirSync(dirname(to),{recursive:true});
      copyFileSync(from,to);
    } else if (!readFileSync(from).equals(readFileSync(to))) {
      throw new Error('Refresh the standalone protocol reader: '+to);
    }
  }
}
