import { once } from 'node:events';
import { createConnection } from 'node:net';
import { ApiError, requireValue } from './support.js';

export const connectionRefused = error => error?.code === 'ECONNREFUSED' || error?.cause?.code === 'ECONNREFUSED' || Boolean(error?.cause?.errors?.some(cause => cause.code === 'ECONNREFUSED'));

// Native MT5 uses Streamable HTTP. Do not replay a tools/call after a transport failure.
export class MT5MCP {
  constructor(config) { this.config = config; this.sequence = 0; this.lifetime = new AbortController(); }
  async post(message, signal, timeout = 15000) {
    const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.config.token}` };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (this.protocol) headers['Mcp-Protocol-Version'] = this.protocol;
    const response = await fetch(this.config.url, { method: 'POST', headers, body: JSON.stringify(message), redirect: 'error', signal: combined });
    if (response.status === 404) { this.ready = null; this.session = null; this.protocol = null; }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new ApiError(502, 'mt5_mcp_http', `MT5 MCP 返回 HTTP ${response.status}${response.status === 401 ? '，请检查连接密钥' : ''}`);
      error.upstreamStatus = response.status;
      throw error;
    }
    if (response.headers.has('mcp-session-id')) this.session = response.headers.get('mcp-session-id');
    if (message.id === undefined) { await response.body?.cancel(); return; }
    const sse = response.headers.get('content-type')?.includes('text/event-stream');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes = 0, buffer = '';
    const decode = text => {
      const value = JSON.parse(text);
      if (value.id !== message.id || value.method) return;
      requireValue(value.jsonrpc === '2.0', 'MT5 MCP 响应版本无效', 502);
      if (value.error) throw new ApiError(502, 'mt5_mcp_error', `MT5 MCP: ${value.error.message}`);
      requireValue(value.result !== undefined, 'MT5 MCP 缺少结果', 502);
      return value.result;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        requireValue(bytes <= 8 * 1024 * 1024, 'MT5 MCP 结果超过 8 MiB，请缩小范围或让原生工具保存文件', 502);
        buffer += decoder.decode(value, { stream: true });
        if (sse) {
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (data) { const result = decode(data); if (result !== undefined) return result; }
          }
        }
      }
      if (!sse) { const result = decode(buffer + decoder.decode()); if (result !== undefined) return result; }
      throw new ApiError(502, 'mt5_mcp_incomplete', 'MT5 MCP 连接结束但未收到本次调用结果；不要重放交易，先查询真实状态');
    } finally { await reader.cancel().catch(() => {}); }
  }
  request(method, params, signal, timeout) { return this.post({ jsonrpc: '2.0', id: ++this.sequence, method, params }, signal, timeout); }
  async connect(signal) {
    if (!this.ready) this.ready = (async () => {
      // Native endpoints are loopback-only. Probe the actual listener so a
      // closed terminal/editor stays distinguishable from HTTP/auth errors,
      // even when the desktop fetch stack reports only UND_ERR_SOCKET.
      if (this.config.server !== 'marketdata') {
        const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(3000), ...(signal ? [signal] : [])]);
        combined.throwIfAborted();
        const url = new URL(this.config.url), socket = createConnection({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) });
        try { await once(socket, 'connect', { signal: combined }); }
        finally { socket.destroy(); }
      }
      const init = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mt5agent', version: '0.1.0' } }, signal);
      requireValue(['2025-03-26', '2025-06-18', '2025-11-25'].includes(init.protocolVersion), '不支持此 MCP 协议版本', 502);
      this.protocol = init.protocolVersion; this.info = init.serverInfo;
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal);
      // Respect native workspace roots before any file or compiler operation.
      if (this.config.server !== 'marketdata') {
        this.workspace = await this.request('tools/call', { name: 'get_workspace_info', arguments: {} }, signal);
        requireValue(!this.workspace.isError, 'MT5 无法读取工作区权限', 502);
      }
    })().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  async list(signal) {
    await this.connect(signal);
    const tools = [], cursors = new Set(); let cursor;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {}, signal);
      requireValue(Array.isArray(page.tools), 'MT5 工具目录无效', 502);
      tools.push(...page.tools); cursor = page.nextCursor;
      requireValue(tools.length <= 1000 && (!cursor || !cursors.has(cursor)), 'MT5 工具分页无效', 502);
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }
  async call(name, args, signal) {
    await this.connect(signal);
    const requestId = ++this.sequence;
    const cancel = () => { void this.post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId, reason: 'Client canceled' } }, undefined, 2000).catch(() => {}); };
    signal?.throwIfAborted(); signal?.addEventListener('abort', cancel, { once: true });
    try { return await this.post({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } }, signal, 60000); }
    finally { signal?.removeEventListener('abort', cancel); }
  }
  close() { this.lifetime.abort(); }
}
