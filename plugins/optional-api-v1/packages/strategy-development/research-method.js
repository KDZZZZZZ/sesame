import { readFile } from 'node:fs/promises';
import { requireThat } from './records.js';

export const methods = [
  ['hypothesis-design', '区分市场机制和替代解释', '有一个现象或交易想法，需要推导可观察预测、期限和反例。', 'hypothesis-design'],
  ['strategy-decomposition', '选择信号、过滤、仓位或状态机', '需要把想法变成规则，或决定某种信息究竟应该改变哪一项决策。', 'design-and-build'],
  ['baseline-construction', '建立能回答问题的交易基线', '第一次完整回测，或希望排除风险规模和交易机会差异。', 'baseline-construction'],
  ['factor-integration', '决定已有因子的用法', '准备将一项特征用作预测、过滤或仓位调整，需要定义决策时点。', 'factor-integration'],
  ['component-verification', '寻找首次错误的输入或决策', '新增数据、递归指标、复杂退出或引擎适配，需要检查规则、预热和可用时间。', 'component-verification'],
  ['incremental-evaluation', '解释一个改动贡献了什么', '添加、移除或替换某项规则，尤其需要区分选择信息、交易次数和敞口。', 'incremental-evaluation'],
  ['trade-diagnosis', '从交易路径定位损失', '出现亏损、回吐、成本侵蚀、集中回撤或回测与模拟盘分歧。', 'trade-diagnosis'],
  ['robustness-analysis', '检验结论对参数、成本和时期的依赖', '候选来自大量搜索、参数周围有尖峰，或预期机制具有时变性。', 'robustness-analysis'],
  ['strategy-revision', '选择最小且可被推翻的改进', '已有基线和异常证据，需要选择一次有明确预期的修订。', 'strategy-revision'],
].map(([id, question, useWhen, file]) => ({ id, question, useWhen, path: 'references/' + file + '.md' }));

export async function researchMethod(id) {
  if (!id) return { methods: methods.map(({ id, question, useWhen }) => ({ id, question, useWhen })) };
  const method = methods.find(item => item.id === id);
  requireThat(method, 'Choose a method from the strategy-development method index.');
  return { ...method, guidance: await readFile(new URL(method.path, import.meta.url), 'utf8') };
}
