// SPDX-License-Identifier: GPL-3.0-only
import { analyze } from './scripts/baseline.mjs';
import { envelope, publish } from './scripts/runtime.mjs';
export function createTools(host) {
  const { Type, define } = host.tools;
  return [define("abu_similarity_analyze", "时间对齐的收益相关、秩相关和方向相似性。这是可改进基线而非标准答案；输入显式来源和截止时点，输出可复核研究结果。 自动登记输入与结果数据集，用户可复核。", { input: Type.Object({}, { additionalProperties: true, description: "研究输入；先读本包 examples/input.json 与 method.md。schema_version=1，source、as_of、parameters 和主题数据。" }) }, (args, signal) => {
    if (signal?.aborted) throw new Error('Research cancelled');
    const result = envelope(args.input, analyze, new URL('./scripts/baseline.mjs', import.meta.url));
    return publish(host, args.input, result, "sesame/abu-similarity", "市场相似性基线");
  })];
}
