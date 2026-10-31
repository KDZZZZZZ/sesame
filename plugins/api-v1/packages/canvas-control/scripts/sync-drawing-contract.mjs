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
const file = resolve(directory, 'capabilities.json'), original = await readFile(file, 'utf8'), manifest = JSON.parse(original);
const drawing = manifest.capabilities.find(item => item.id === 'chart_drawing');
drawing.inputSchema = structuredClone(DRAWING_COMMAND_SCHEMA);
drawing.description = '读取、创建、修改、清理或显式迁移图表绘图。声明式几何直接渲染，成果源码保持不可变；修改同时校验绘图修订与挂载ID。';
drawing.usage.inputs = 'read需要chart_id/drawing_id。变更需要command_id/expected_version、保存的binding、expected_revision和expected_attachment（script.id）；新建二者为null。migrate另需当前target_binding，且can_migrate必须为true。';
drawing.usage.outputs = 'read返回附着绘图，包括spec/source/revision/attachment/active/can_migrate。put/remove/migrate返回当前画布；修改保留旧成果与撤销历史。';
drawing.usage.limitations = ['每个当前绑定最多64幅活跃绘图，非活跃附着绘图可读取和删除，不占活跃配额。来源修订只能由宿主核验恢复，迁移必须单独显式请求；跨品种、规格、日历、时钟或连接不能迁移。缺失历史观测或未知日历不授权迁移。'];
const recover = {
  id: 'canvas_recover_source', kind: 'function', consumers: ['agent', 'host'],
  description: '显式恢复同一行情来源的新修订。宿主核验图表快照、来源digest/实例、品种、规格、日历、时钟及连接，再CAS更新；不自动迁移绘图。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['command_id', 'expected_version', 'chart_id', 'expected_chart'], properties: {
    command_id: DRAWING_COMMAND_SCHEMA.properties.command_id, expected_version: DRAWING_COMMAND_SCHEMA.properties.expected_version,
    chart_id: DRAWING_COMMAND_SCHEMA.properties.chart_id, expected_chart: { type: 'object', description: 'canvas_inspect中完整且未修改的原图表快照。' },
    time_basis: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { enum: ['utc', 'wall'] }, authority: { type: 'string', minLength: 1 } } },
  } }, outputSchema: { type: 'object' }, execution: 'immediate', effects: ['view.write'],
  usage: { purpose: '核验后恢复现有图表，不替换来源/品种或自动改写历史坐标。', inputs: '原图表完整快照与画布CAS版本；已知历史时钟可额外传入time_basis。', outputs: '当前画布；仅更新来源revision和generation。', prerequisites: ['先canvas_inspect，确认用户请求恢复该图表。'], limitations: ['冲突、取消、身份不符都不重试或覆盖；绘图显式迁移是独立操作。'] },
  binding: { type: 'native', name: 'canvas_recover_source' },
};
const index = manifest.capabilities.findIndex(item => item.id === recover.id);
if (index < 0) manifest.capabilities.splice(manifest.capabilities.indexOf(drawing), 0, recover); else manifest.capabilities[index] = recover;
const updateInputs = schema => {
  if (!schema || typeof schema !== 'object') return;
  if (schema.properties?.lookback) {
    schema.properties.lookback.maximum = INDICATOR_INPUT_ROWS;
    schema.properties.lookback.description = '最小预热样本数，0表示不要求预热而非空输入；不截断可见历史。所有输入合计最多100000行及8MiB。';
    schema.properties.window = { type: 'integer', minimum: 1, maximum: INDICATOR_INPUT_ROWS, description: '可选固定样本窗口，必须>=lookback；只传最后N个符合forming策略的样本。不传则传完整的有界视窗或固定数据。' };
  }
  for (const value of Object.values(schema)) if (value && typeof value === 'object') Array.isArray(value) ? value.forEach(updateInputs) : updateInputs(value);
};
updateInputs(manifest);
if (check) { if (JSON.stringify(JSON.parse(original)) !== JSON.stringify(manifest)) throw Error('canvas-control capability schemas differ from the authoritative drawing/indicator contracts'); }
else await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(check ? 'Drawing contract and executable budgets match' : 'Synchronized drawing contract and executable budgets');
