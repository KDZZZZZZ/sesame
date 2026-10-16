// SPDX-License-Identifier: GPL-3.0-only
import { analyze } from './scripts/baseline.mjs';
import { envelope, publish } from './scripts/runtime.mjs';
export function createCapabilities(host) {
  return [{ name: "abu_stock_screening_analyze", execute(args, signal) {
    if (signal?.aborted) throw new Error('Research cancelled');
    const result = envelope(args.input, analyze, new URL('./scripts/baseline.mjs', import.meta.url));
    return publish(host, args.input, result, "sesame/abu-stock-screening", "股票筛选基线");
  } }];
}
