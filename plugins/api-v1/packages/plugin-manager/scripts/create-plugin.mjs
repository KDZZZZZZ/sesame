import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold, writeDraft } from '../scaffold.js';

const help = `Create a Sesame plugin without application source or credentials (Node 24+).

node create-plugin.mjs --name my-plugin --publisher your-name --description "Purpose and trigger" --output /path/to/new-directory

Optional: --template native|skill --version 0.1.0 --min-host 0.2.0
No dependency installation, model calls or automatic activation. Existing outputs are refused.
After editing, use Sesame plugin_validate → plugin_test → plugin_install → plugin_load.
Guide: https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/plugin-manager/skills/develop-plugins/SKILL.md`;

export async function main(args) {
  if (args.length === 0 || args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(help); return; }
  const allowed = new Set(['name', 'publisher', 'description', 'output', 'template', 'version', 'min-host']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].startsWith('--') && args[i].slice(2);
    if (!allowed.has(key) || Object.hasOwn(options, key) || typeof args[i + 1] !== 'string' || args[i + 1].startsWith('--')) throw new Error('Unknown, duplicate or missing argument. Use --help.');
    options[key] = args[i + 1];
  }
  if (!options.output?.trim()) throw new Error('--output is required');
  const recipe = scaffold({ name: options.name, publisher: options.publisher, description: options.description, version: options.version, min_host: options['min-host'], template: options.template });
  console.log(JSON.stringify(await writeDraft(options.output, recipe), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
