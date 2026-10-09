import manifest from '../plugin.json' with { type: 'json' };

// Compiler requirements belong to this plugin, independent of host research tools.
export const MT5_RUNTIME_ENTRIES = Object.freeze(manifest.runtime.entries);

export function compilerRuntimeAvailable(runtime, platform = process.platform) {
  return runtime?.platform === platform && MT5_RUNTIME_ENTRIES[platform]?.every(role => typeof runtime.paths?.[role] === 'string' && runtime.paths[role].length > 0);
}
