import { capability } from '@sesame/plugin-sdk/capabilities';
import { strategySources, tradeDetail } from '../backend/strategy.js';

export function createCapabilities(host, mt5) {
  return [
    capability('mt5_report_data', args => strategySources(host, args.backtest_ids)),
    capability('mt5_trade_detail', args => tradeDetail(host, args.trade_id)),
  ];
}
