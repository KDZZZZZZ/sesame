import { writeWorkspace } from '../../backend/files.js';
import { capability } from '@sesame/plugin-sdk/capabilities';
import { officialTool } from '../../backend/plugin-tools.js';

export function createCapabilities(host, mt5) {
  const conversationId = host.context.sessionId;
  const official = mt5.official;
  return [
    capability('mt5_catalog', (args, signal) => official.catalog(args.server, args.query, signal, conversationId)),
    officialTool(host, mt5, 'official'),
    capability('mt5_cache', async ({ action, save_as, ...args }, signal) => {
      const market = mt5.market;
      const result = await (action === 'symbols' ? market.symbols() : action === 'inventory' ? market.inventory() : action === 'sync_trades' ? market.syncTrades(args) : market[action](args));
      if (!save_as) return result;
      await writeWorkspace(host, save_as, JSON.stringify(result), signal); return { saved_to: save_as };
    }),
    capability('mt5_command', args => official.command(args.command_id, conversationId)),
  ];
}
