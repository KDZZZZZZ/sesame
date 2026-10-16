import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { requireValue } from './support.js';
import { connectionRefused } from './mcp.js';
import { nativeConnectionSettings } from './native-settings.js';
import { launch } from './process.js';

/** Only discovery is retried. A compiler/file command is never replayed. */
export async function editorTools(official, signal, { startEditor = launch, readSettings = nativeConnectionSettings,
  timeoutMs = 30000, pollMs = 500 } = {}) {
  const version = official.config.version;
  try { return await official.client('metaeditor').list(signal); }
  catch (error) {
    signal?.throwIfAborted();
    if (!connectionRefused(error) || !official.native) throw error;
    const blocked = official.access('launcher', 'start_editor', null).blocked_reason;
    requireValue(!blocked, blocked, 403, 'mt5_permission_denied');
    // Never start a different installation for a custom endpoint, or override
    // an explicitly disabled native service. Authentication errors do not launch.
    const native = (await readSettings(official.native))?.servers?.metaeditor;
    const selected = official.config.servers.metaeditor;
    requireValue(native?.enabled && selected.enabled && new URL(native.url).href === new URL(selected.url).href,
      '所选 MetaEditor 服务未运行；请在对应 MT5 的 MCP 设置启用编辑器服务', 503, 'metaeditor_not_running');
  }
  if (!official.editorStarting) {
    const pending = (async () => {
      const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
      const unchanged = () => requireValue(!official.closing && !official.saving && official.config.version === version,
        'MetaEditor 连接配置已改变，请重新调用', 409, 'version_conflict');
      unchanged(); deadline.throwIfAborted();
      const portable = !!official.native.dataDirectory && resolve(official.native.dataDirectory).toLowerCase() === resolve(official.native.directory).toLowerCase();
      await startEditor(official.native, 'start_editor', { portable }, undefined, {}, deadline);
      while (true) {
        unchanged(); deadline.throwIfAborted();
        try { return await official.client('metaeditor').list(deadline); }
        catch (error) { if (!connectionRefused(error)) throw error; }
        await sleep(pollMs, undefined, { signal: deadline });
      }
    })();
    official.editorStarting = pending;
    void pending.finally(() => { if (official.editorStarting === pending) official.editorStarting = null; }).catch(() => {});
  }
  const result = await official.editorStarting;
  signal?.throwIfAborted();
  return result;
}
