import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const at = process.argv.indexOf('--host');
if (at < 0 || !process.argv[at + 1]) throw Error('Usage: node scripts/sync-svl-view.mjs --host <host-root> [--check]');
const host = resolve(process.argv[at + 1]);
const require = createRequire(join(host, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')));
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')));
const root = fileURLToPath(new URL('..', import.meta.url));
const shared = 'modules/frontend/src/features/strategy-projects/';
const lucidePackage = require.resolve('lucide-react/package.json');
const lucide = JSON.parse(await readFile(lucidePackage, 'utf8'));
const aliases = [
  ['@sesame/svl-canvas', join(host, shared, 'svl-graph-canvas.tsx')],
  ['@sesame/svl-layout', join(host, shared, 'svl-layout.js')],
  ['@sesame/svl-logic', join(host, shared, 'svl-logic-view.tsx')],
  ['@sesame/svl-logic-model', join(host, shared, 'svl-logic-model.js')],
  ['@sesame/svl-tree', join(host, shared, 'svl-expression-tree.tsx')],
  ['lucide-react', join(lucidePackage, '..', lucide.module)],
  ...['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].map(name => [name, require.resolve(name)]),
].map(([name, replacement]) => ({ find: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), replacement }));
const result = await build({
  configFile: false, root: host, logLevel: 'error', plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: aliases },
  build: { write: false, minify: true, sourcemap: false,
    lib: { entry: join(root, 'assets/src/svl-graph.tsx'), name: 'SesameSvlGraph', formats: ['iife'], fileName: () => 'svl-graph.js', cssFileName: 'svl-graph' },
  },
});
const output = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
const script = output.find(item => item.type === 'chunk');
const css = output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
if (!script || !css) throw Error('The shared SVL canvas must include JavaScript and its original CSS.');
const files = new Map([['svl-graph.js', script.code], ['svl-graph.css', String(css.source)]]);
const sources = {};
for (const name of ['svl-graph-canvas.tsx', 'svl-graph-canvas.css', 'svl-layout.js', 'svl-logic-model.js', 'svl-logic-view.tsx', 'svl-logic-view.css', 'svl-expression-model.js', 'svl-expression-tree.tsx', 'svl-expression-tree.css']) {
  sources[shared + name] = createHash('sha256').update(await readFile(join(host, shared, name))).digest('hex');
}
const dependencies = {}, licenses = [];
for (const name of ['react', 'react-dom', 'lucide-react']) {
  const pkg = require.resolve(name + '/package.json');
  const manifest = JSON.parse(await readFile(pkg, 'utf8'));
  dependencies[name] = { version: manifest.version, license: manifest.license };
  licenses.push(name + '\n' + await readFile(join(pkg, '..', 'LICENSE'), 'utf8'));
}
files.set('svl-graph.LICENSE.txt', licenses.join('\n\n'));
files.set('svl-graph.sources.json', JSON.stringify({ renderer: 'Sesame application SVL canvas', sources, dependencies }, null, 2) + '\n');
await mkdir(join(root, 'assets'), { recursive: true });
for (const [name, text] of files) {
  const target = join(root, 'assets', name);
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== text) throw Error('Shared SVL canvas drifted: ' + name);
  } else await writeFile(target, text);
}
console.log(JSON.stringify({ renderer: 'application SVL canvas', scriptBytes: Buffer.byteLength(script.code), cssBytes: Buffer.byteLength(String(css.source)), checked: process.argv.includes('--check') }));
