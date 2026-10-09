import { officialTool } from '../../backend/plugin-tools.js';

export function createTools(host, mt5) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  const official = mt5.official;
  const server = Type.Union(['terminal', 'metaeditor', 'marketdata', 'python', 'launcher'].map(Type.Literal));
  return [
    define('mt5_catalog', '读取 MT5 官方能力的当前目录、inputSchema、工作区权限及不可用原因。先发现后调用；query 可过滤方法名。Python 仅提供官方 API，不能执行任意代码。', {
      server: Type.Optional(server), query: optional('过滤方法名或说明'),
    }, (args, signal) => official.catalog(args.server, args.query, signal, conversationId)),
    officialTool(host, mt5, 'official'),
    define('mt5_cache', '管理与交易面板共用的本地 MT5 行情库。bars/trades 只读本地；sync/sync_trades 从当前已验证账户下载并去重保存；时间是券商墙上时间的秒值，不代表 UTC。大结果使用 save_as。remove 只清理指定品种周期的行情。', {
      action: Type.Union(['symbols', 'inventory', 'bars', 'sync', 'trades', 'sync_trades', 'remove'].map(Type.Literal)),
      symbol: optional('精确品种'), period: optional('MT5 周期，如 H1'), from: Type.Optional(Type.Integer()), to: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20000 })), save_as: optional('完整 JSON 的沙箱路径'),
    }, async ({ action, save_as, ...args }, signal) => {
      const market = mt5.market;
      const result = await (action === 'symbols' ? market.symbols() : action === 'inventory' ? market.inventory() : action === 'sync_trades' ? market.syncTrades(args) : market[action](args));
      if (!save_as) return result;
      await box.file('write', save_as, JSON.stringify(result), signal); return { saved_to: save_as };
    }),
    define('mt5_command', '读取本会话已有调用的结果；不会重发终端操作。returned 只表示收到官方响应，仍需检查 isError、retcode、Tester 状态。', {
      command_id: string('已有 command_id'),
    }, args => official.command(args.command_id, conversationId)),
  ];
}
