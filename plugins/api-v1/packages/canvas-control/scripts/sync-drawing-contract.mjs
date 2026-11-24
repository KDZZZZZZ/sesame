import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Explicit build-time source path, never a runtime dependency on another repo.
const host = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));
if (!host) throw Error('Usage: node sync-drawing-contract.mjs <host-root> [--check]');
const check = process.argv.includes('--check'), directory = fileURLToPath(new URL('..', import.meta.url));
const shared = resolve(host, 'modules/shared');
const { DRAWING_COMMAND_SCHEMA } = await import(pathToFileURL(resolve(shared, 'drawing-schema.js')));
const { INDICATOR_INPUT_ROWS } = await import(pathToFileURL(resolve(shared, 'indicator-limits.js')));
for (const name of ['drawing-schema.js', 'drawing-code.js', 'indicator-limits.js']) {
  const source = resolve(shared, name), target = resolve(directory, name);
  if (check) { if (await readFile(source, 'utf8') !== await readFile(target, 'utf8')) throw Error(`${name} differs from the authoritative host contract`); }
  else await copyFile(source, target);
}
const updateInputs = schema => {
  if (!schema || typeof schema !== 'object') return;
  if (schema.properties?.lookback) {
    schema.properties.lookback.maximum = INDICATOR_INPUT_ROWS;
    schema.properties.lookback.description = '最小预热样本数，0表示不要求预热而非空输入；不截断可见历史。所有输入合计最多100000行及8MiB。';
    schema.properties.window = { type: 'integer', minimum: 1, maximum: INDICATOR_INPUT_ROWS, description: '可选固定样本窗口，必须>=lookback；只传最后N个符合forming策略的样本。不传则传完整的有界视窗或固定数据。' };
  }
  for (const value of Object.values(schema)) if (value && typeof value === 'object') Array.isArray(value) ? value.forEach(updateInputs) : updateInputs(value);
};
const {parseYaml,writeYaml,buildSurfaceLock,readSurfaceFiles} = await import(pathToFileURL(resolve(host,'modules/plugins/package-protocol/directory.mjs')));
const files = readSurfaceFiles(directory);
for (const path of Object.keys(files).filter(name => name.startsWith('tools/'))) {
  const tool = parseYaml(files[path],path), original = JSON.stringify(tool.inputSchema);
  if (tool.name === 'chart_drawing') tool.inputSchema = structuredClone(DRAWING_COMMAND_SCHEMA);
  updateInputs(tool.inputSchema);
  if (JSON.stringify(tool.inputSchema) === original) continue;
  if (check) throw Error(path+' differs from shared drawing/indicator schemas');
  files[path] = writeYaml(tool);
  await writeFile(resolve(directory,path),files[path]);
}
if (!check) await writeFile(resolve(directory,'surface.lock.json'), JSON.stringify(buildSurfaceLock(files),null,2)+'\n');
console.log('Drawing and indicator contracts verified');
