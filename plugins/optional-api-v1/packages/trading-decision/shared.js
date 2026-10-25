import { check } from './workflow-mechanics.js';
export { check } from './workflow-mechanics.js';
export function payload(result) {
  check(!result?.isError, 'CAPABILITY_ERROR', 'Selected capability returned an error; inspect its receipt');
  if (result && Object.hasOwn(result, 'details')) return result.details;
  if (!result?.content) return result;
  const blocks = result.content.filter(block => block.type === 'text');
  check(blocks.length === 1, 'SOURCE_DATA_INVALID', 'Expected one structured capability result');
  const data = JSON.parse(blocks[0].text);
  check(!data?._tool_output_truncated, 'SOURCE_DATA_INVALID', 'Capability result was truncated');
  return data;
}
