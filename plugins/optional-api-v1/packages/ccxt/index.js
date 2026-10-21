import { capability } from '@sesame/plugin-sdk/capabilities';
import { sourceCapabilities } from './source.js';
import { environment } from "./environment.js";
import { savedConnections } from './records.js';

export function createCapabilities(host) {
  return [
...sourceCapabilities(host),
capability("ccxt_environment", (args, signal) => environment(host, args, signal)),
    capability("ccxt_catalog", () => ({
        exchanges: ["kraken", "coinbase", "okx"],
        connections: savedConnections(host),
        library: "4.5.85",
        market: "public spot",
        timeframes: ["1m", "5m", "15m", "1h", "1d"],
        pollIntervalMs: 1000,
        orders: false,
        apiKeys: false,
        coverage: "partial/unknown",
        closed: "later source candle only",
      })),
  ];
}
