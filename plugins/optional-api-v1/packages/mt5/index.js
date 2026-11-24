import {readPackageDirectory} from '@sesame/plugin-sdk/surface';
import { capability } from '@sesame/plugin-sdk/capabilities';
const {capabilities:manifest}=readPackageDirectory(new URL('.',import.meta.url));
import { executeCapability } from './backend/plugin-runtime.js';

export function createCapabilities(host) {
  return manifest.capabilities.map(declared => capability(declared.binding.name,
    (input, signal, executionContext) => executeCapability(host, declared.id, input, signal, executionContext)));
}
