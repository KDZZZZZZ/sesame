// SPDX-License-Identifier: GPL-3.0-only
import { analyze } from './scripts/baseline.mjs';
import { analyze as audit } from './scripts/audit.mjs';
import { envelope, publish } from './scripts/runtime.mjs';
export function createCapabilities(host) {
  return [{ name: "abu_trade_metrics_analyze", execute(args, signal) {
    if (signal?.aborted) throw new Error('Research cancelled');
    const result = envelope(args.input, analyze, new URL('./scripts/baseline.mjs', import.meta.url));
    return publish(host, args.input, result, "sesame/abu-trade-metrics", "交易结果诊断 / 绩效");
  } }, { name: "abu_trade_results_audit", execute(args, signal) {
    if (signal?.aborted) throw new Error('Research cancelled');
    const result = envelope(args.input, audit, new URL('./scripts/audit.mjs', import.meta.url));
    return publish(host, args.input, result, "sesame/abu-trade-metrics", "交易结果诊断 / 逐笔审计");
  } }];
}
