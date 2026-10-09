import { commandSchema } from '../backend/configuration.js';
import { dependencyChanges, configureDependencies, inspectDependencies } from '../backend/dependencies.js';
import { requireValue } from '../backend/support.js';

export function createTools(host, mt5) {
  const { define, Type } = host.tools;
  return [define('mt5_dependencies', '先检查已安装的 MT5、Windows Python、Wine 与编译引擎；缺项返回插件私有目录和安装 skill。configure 只保存明确路径，不下载、不启动或替换终端。本机编译无需虚拟机；probe 核对本机依赖。', {
    action: Type.Union(['inspect', 'configure'].map(Type.Literal)), probe: Type.Optional(Type.Boolean()),
    command_id: Type.Optional(commandSchema), expected_version: Type.Optional(Type.Integer({ minimum: 1 })), changes: Type.Optional(dependencyChanges),
  }, args => {
    if (args.action === 'inspect') { requireValue(Object.keys(args).every(key => ['action', 'probe'].includes(key)), 'inspect 不接受配置参数'); return inspectDependencies(mt5, { probe: args.probe === true }); }
    requireValue(!Object.hasOwn(args, 'probe'), 'configure 不接受 probe；保存后单独探测');
    return configureDependencies(host, mt5, args);
  })];
}
