import { now } from './support.js';
import { ensureMT5Connection } from './connect.js';

/** One shared connection monitor. Network waits never hold the configuration
 * lock, and health checks create no messages, commands, events or datasets. */
export class MT5AutoConnection {
  constructor(host, mt5, { intervalMs = 10000, retryMs = 5000, maxRetryMs = 60000 } = {}) {
    this.host = host; this.mt5 = mt5; this.intervalMs = intervalMs; this.retryMs = retryMs; this.maxRetryMs = maxRetryMs;
    this.lifetime = new AbortController(); this.failures = 0; this.healthy = false;
  }
  start() { this.schedule(0); return this; }
  schedule(delay) {
    if (this.lifetime.signal.aborted) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.job) { this.schedule(this.retryMs); return; }
      this.job = this.check().catch(() => this.maxRetryMs).then(next => {
        this.job = null; this.schedule(this.wakeRequested ? 0 : next); this.wakeRequested = false;
      });
    }, delay);
    this.timer.unref();
  }
  settingsChanged() {
    if (this.version !== this.mt5.official.config.version) {
      this.healthy = false; this.failures = 0; this.wakeRequested = Boolean(this.job); this.schedule(0);
    }
  }
  async check() {
    const { host, mt5 } = this, official = mt5.official;
    if (this.lifetime.signal.aborted || mt5.closing) return this.maxRetryMs;
    // Empty saved credentials may be an explicit user clear. Only initial
    // native import or an explicit Agent connection request may fill them.
    if (!official.config.servers.terminal.enabled || !official.config.servers.terminal.token
      || official.access('terminal', 'get_trading_account_info', null).blocked_reason) return this.maxRetryMs;
    // Other tasks keep their current session. Defer mutations while they work.
    try { host.configuration.assertIdle(); } catch { return this.retryMs; }
    if (official.jobs.size) return this.retryMs;
    const requestVersion = official.config.version;
    if (this.version === official.config.version && this.healthy) {
      try {
        const raw = await official.client('terminal').call('get_trading_account_info', {}, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(5000)]));
        const info = raw.structuredContent ?? JSON.parse(raw.content?.find(part => part.type === 'text')?.text ?? '{}');
        const account = official.config.account;
        if (!raw.isError && info.terminal?.server_connected === true && String(info.account?.login) === account.login && info.account?.server === account.server) return this.intervalMs;
      } catch { /* Restore only the connection; never replay an application command. */ }
    }
    this.healthy = false;
    const result = await ensureMT5Connection(mt5, {}, this.lifetime.signal, { exclusive: action => host.configuration.exclusive(action) });
    if (['agent_busy', 'mt5_busy', 'version_conflict'].includes(result.code)) return this.retryMs;
    this.version = result.settings_version ?? requestVersion;
    this.healthy = result.status === 'connected';
    this.failures = this.healthy ? 0 : this.failures + 1;
    // A single replaceable status record, not an ever-growing retry transcript.
    host.storage.put('mt5_connection_status', { id: 'terminal', ...result, checked_at: now() });
    if (this.healthy) {
      mt5.live.accountCache = null;
      host.events.emit('configuration.updated', { id: 'mt5-autoconnect', target: 'mt5', status: 'applied' });
    }
    return this.healthy ? this.intervalMs : Math.min(this.maxRetryMs, this.retryMs * 2 ** Math.min(this.failures, 6));
  }
  async close() {
    clearTimeout(this.timer); this.lifetime.abort(); await this.job;
  }
}
