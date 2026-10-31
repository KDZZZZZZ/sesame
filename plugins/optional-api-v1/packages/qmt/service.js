import { createProviderState } from './provider-state.js';
import { createConnection } from './connection.js';
import { createMarket, marketDescriptor } from './market.js';
import { createAccount, accountDescriptor } from './account.js';
import { createCommands } from './commands.js';

export const descriptors = [marketDescriptor, accountDescriptor];

/** Test injection supplies only the fixed query boundary, never a runtime/store object. */
export function createService(host, { platform = process.platform, now = Date.now, pollMs = 1000, request } = {}) {
  const state = createProviderState({ now });
  const transport = createConnection(host, { platform, request, state });
  const { market, download } = createMarket(transport, state, { now, pollMs });
  const account = createAccount(transport, state);
  const { commandRecord, command } = createCommands(host, transport, { now });
  return { market, account, commandRecord, download, command, native: transport.native, dispose: state.dispose };
}
