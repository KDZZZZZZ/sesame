import { strategySources, tradeDetail } from '../backend/strategy.js';

export function createTools(host, mt5) {
  const { define, Type, string } = host.tools;
  return [
    define('mt5_report_data', '从实际已结束的 MT5 Tester 任务发布可供通用报告引用的数据集。保留失败/取消状态、券商时间、费用和原生 trace 局限；不会启动回测。', { backtest_ids: Type.Array(string('真实回测任务 ID'), { minItems: 1, maxItems: 32 }) }, args => strategySources({ storage: mt5.storage, datasets: host.datasets, artifacts: host.artifacts }, args.backtest_ids)),
    define('mt5_trade_detail', '读取原生历史回测的成交与真实票据关联 trace。旧 visual-mql-v1 图保留原身份；没有真实映射时明确返回 unavailable，不将其标为 SVL 验证。', { trade_id: string('回测数据集中的成交 ID') }, args => tradeDetail({ storage: mt5.storage, datasets: host.datasets, artifacts: host.artifacts }, args.trade_id)),
  ];
}
