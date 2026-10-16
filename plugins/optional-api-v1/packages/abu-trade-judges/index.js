// SPDX-License-Identifier: GPL-3.0-only
import { analyze } from './scripts/baseline.mjs';
import { envelope, publish } from './scripts/runtime.mjs';
export function createCapabilities(host) {
  return [{ name: "abu_trade_judges_analyze", execute(args, signal) {
    if (signal?.aborted) throw new Error('Research cancelled');
    const result = envelope(args.input, analyze, new URL('./scripts/baseline.mjs', import.meta.url));
    return publish(host, args.input, result, "sesame/abu-trade-judges", "历史交易裁判基线");
  } }];
}
