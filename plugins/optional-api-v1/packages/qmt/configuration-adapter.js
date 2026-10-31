import { check } from '@sesame/plugin-sdk/protocol';
import { capability } from './execution.js';
import { configuration, configure } from './configuration.js';

/** Shared settings project the existing QMT store; they never probe the SDK. */
export function createConfigurationCapabilities(host) {
  return [
    capability('configuration.read', () => ({ configuration: configuration(host) })),
    capability('configuration.update', ({ command_id, expected_version, changes }) => {
      check(host.context.kind === 'main' && !host.context.runId, 'Only the main conversation can update QMT configuration immediately', 'FORBIDDEN');
      return configure(host, { operation_id: command_id, expected_version, changes });
    }),
  ];
}
