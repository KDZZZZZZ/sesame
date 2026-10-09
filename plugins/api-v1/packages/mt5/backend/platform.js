import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const macPrefix = (home = homedir()) => join(home, 'Library/Application Support/net.metaquotes.wine.metatrader5');

export function winePrefix(directory = process.env.MT5AGENT_MT5_DIR) {
  if (process.env.MT5AGENT_WINEPREFIX || process.env.WINEPREFIX) return process.env.MT5AGENT_WINEPREFIX || process.env.WINEPREFIX;
  // Custom terminal installations must use the same prefix for Python and Tester.
  if (directory) {
    const full = resolve(directory), offset = full.toLowerCase().indexOf('/drive_c/');
    if (offset > 0) return full.slice(0, offset);
  }
  if (process.platform === 'darwin' && existsSync(join(macPrefix(), 'drive_c'))) return macPrefix();
  return join(homedir(), '.mt5');
}

export function wineCommand() {
  if (process.env.MT5AGENT_WINE) return process.env.MT5AGENT_WINE;
  if (process.platform === 'darwin') {
    for (const root of [process.env.MT5AGENT_MT5_APP, '/Applications/MetaTrader 5.app', join(homedir(), 'Applications/MetaTrader 5.app')].filter(Boolean)) {
      for (const relative of ['Contents/SharedSupport/wine/bin/wine64', 'Contents/SharedSupport/wine/bin/wine', 'Contents/Resources/wine/bin/wine64', 'Contents/Resources/wine/bin/wine']) {
        const binary = join(root, relative);
        if (existsSync(binary)) return binary;
      }
    }
  }
  return 'wine';
}

export function wineEnvironment(directory, commonFolder) {
  // The Mac launcher may run Wine as "user" while Sesame inherits the macOS
  // login name. Wine resolves AppData from USER, not USERPROFILE. A Tester must
  // share the connected terminal's profile or its FILE_COMMON output goes missing.
  const user = commonFolder?.match(/^[cC]:[\\/]users[\\/]([^\\/]+)[\\/]AppData[\\/]Roaming[\\/]MetaQuotes[\\/]Terminal[\\/]Common[\\/]?$/i)?.[1];
  return { ...process.env, WINEPREFIX: winePrefix(directory), WINEDEBUG: '-all',
    ...(user && !['.', '..'].includes(user) && !/[\x00-\x1f]/.test(user) ? { USER: user, LOGNAME: user } : {}),
    ...(process.env.MT5AGENT_DISPLAY ? { DISPLAY: process.env.MT5AGENT_DISPLAY } : {}) };
}

export function terminalInvocation(executable, flags = [], env = wineEnvironment()) {
  if (process.platform === 'win32') return { program: executable, args: flags };
  const wine = wineCommand();
  return process.platform === 'linux' && !env.DISPLAY
    ? { program: 'xvfb-run', args: ['-a', wine, executable, ...flags] }
    : { program: wine, args: [executable, ...flags] };
}
