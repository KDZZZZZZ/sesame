import { capability } from '@sesame/plugin-sdk/capabilities';
import { commandSchema } from '../backend/configuration.js';
import { dependencyChanges, configureDependencies, inspectDependencies } from '../backend/dependencies.js';
import { requireValue } from '../backend/support.js';

export function createCapabilities(host, mt5) {
  return [capability('mt5_dependencies', args => {
    if (args.action === 'inspect') { requireValue(Object.keys(args).every(key => ['action', 'probe'].includes(key)), 'inspect 不接受配置参数'); return inspectDependencies(mt5, { probe: args.probe === true }); }
    requireValue(!Object.hasOwn(args, 'probe'), 'configure 不接受 probe；保存后单独探测');
    return configureDependencies(host, mt5, args);
  })];
}
