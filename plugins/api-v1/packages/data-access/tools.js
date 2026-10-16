import { sourceSnapshot } from './capture.js';
import { marketCapabilities } from './market.js';

export function createCapabilities(host) {
  return [
    ...marketCapabilities(host),
    { name: 'data_sources', execute: input => host.data.sources(input) },
    { name: 'data_query', execute: (input, signal) => host.data.query(input, { signal }) },
    { name: 'data_snapshot', execute: (input, signal) => sourceSnapshot(host, input, signal) },
  ];
}
