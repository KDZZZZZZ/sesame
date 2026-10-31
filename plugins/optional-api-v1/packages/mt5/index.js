import { capability } from '@sesame/plugin-sdk/capabilities';
import manifest from './capabilities.json' with { type: 'json' };
import { executeCapability } from './backend/plugin-runtime.js';

export function createCapabilities(host) {
  return manifest.capabilities.map(declared => capability(declared.binding.name,
    (input, signal, executionContext) => executeCapability(host, declared.id, input, signal, executionContext)));
}
