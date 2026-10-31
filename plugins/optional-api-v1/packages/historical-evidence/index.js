// SPDX-License-Identifier: MIT
import { matchHistorical } from './src/match.js';
import { calibrateHistorical } from './src/calibrate.js';
import { fromFixedRef } from './src/ref-input.js';

export function createCapabilities(host) {
  return [
    { name: 'historical_evidence_match', execute: (input, signal) => matchHistorical(input, signal) },
    { name: 'historical_evidence_calibrate', execute: (input, signal) => calibrateHistorical(input, signal) },
    { name: 'historical_evidence_from_ref', execute: (input, signal) => fromFixedRef(host, input, signal) },
  ];
}
