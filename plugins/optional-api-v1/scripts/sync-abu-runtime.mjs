import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
if (args.length !== 1 || !['--check', '--write'].includes(args[0])) throw new Error('Use --check or --write');
const source = readFileSync(new URL('./abu-runtime.mjs', import.meta.url));
const plugins = JSON.parse(readFileSync(new URL('abu-plugins.json', root)));
for (const plugin of plugins) {
  const path = new URL(`packages/${plugin.directory}/scripts/runtime.mjs`, root);
  if (args[0] === '--write') writeFileSync(path, source);
  else if (!readFileSync(path).equals(source)) throw new Error(`Runtime copy differs: ${plugin.id}`);
}
console.log(`${plugins.length} self-contained runtime copies ${args[0] === '--write' ? 'updated' : 'verified'}`);
