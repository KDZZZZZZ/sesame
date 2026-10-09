import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseTOML } from '@sesame/plugin-sdk/toml';
import { ApiError, requireValue, securePath } from './support.js';
import { connectionURL } from './official.js';
import { stableJSON } from './contracts.js';

const TTL = 24 * 60 * 60 * 1000;
const names = ['terminal', 'metaeditor'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new ApiError(422, 'mt5_import_invalid', 'MT5 MCP 导出格式无效或两份配置不一致；请重新复制完整的 JSON 或 TOML 配置。未保存任何密钥。');
const summary = servers => Object.fromEntries(Object.entries(servers).map(([name, { token, url, enabled }]) => [name, { url, enabled, authenticated: Boolean(token) }]));
const configMarker = /"mcpServers"\s*:|^\s*\[mcp_servers\./m;
const redact = (text, servers) => Object.values(servers).reduce((value, { token }) => value.replaceAll(token, '[密钥已隐藏]').replaceAll(JSON.stringify(token).slice(1, -1), '[密钥已隐藏]'), text);

function mergeServers(target, config) {
  if (!object(config)) throw invalid();
  for (const name of names) {
    if (!Object.hasOwn(config, name)) continue;
    const value = config[name];
    if (!object(value) || (value.type !== undefined && value.type !== 'http') || value.command || value.args || value.env ||
        (value.enabled !== undefined && typeof value.enabled !== 'boolean')) throw invalid();
    const headers = value.headers ?? value.http_headers;
    if (value.headers && value.http_headers && stableJSON(value.headers) !== stableJSON(value.http_headers)) throw invalid();
    if (!object(headers) || Object.keys(headers).length !== 1 || Object.keys(headers)[0].toLowerCase() !== 'authorization') throw invalid();
    const auth = Object.values(headers)[0];
    if (typeof auth !== 'string' || !/^Bearer [^\s\u0000-\u001f\u007f]+$/i.test(auth) || auth.length > 8199) throw invalid();
    let url; try { url = connectionURL(name, value.url); } catch { throw invalid(); }
    if (url.includes(auth.slice(7))) throw invalid();
    const server = { url, enabled: value.enabled ?? true, token: auth.slice(7) };
    if (target[name] && stableJSON(target[name]) !== stableJSON(server)) throw invalid();
    target[name] = server;
  }
}

// Extract complete JSON objects without interpreting braces inside strings.
function jsonBlocks(text) {
  const blocks = []; let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) { if (c === '{') { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { blocks.push({ start, end: i + 1 }); start = -1; }
  }
  return blocks;
}

export function extractMT5Config(text) {
  if (!configMarker.test(text) || !/terminal|metaeditor/.test(text)) return null;
  const ranges = [], servers = {};
  for (const range of jsonBlocks(text)) {
    const raw = text.slice(range.start, range.end);
    if (!raw.includes('mcpServers')) continue;
    let parsed; try { parsed = JSON.parse(raw); } catch { throw invalid(); }
    if (!names.some(name => Object.hasOwn(parsed.mcpServers ?? {}, name))) continue;
    mergeServers(servers, parsed.mcpServers); ranges.push(range);
  }
  // MT5 exports tables with string/bool fields and inline HTTP headers. Keep
  // Markdown/prose outside the tables so the user's surrounding intent survives.
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(match => match[0]);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\[mcp_servers\./.test(lines[i][0]) || ranges.some(r => lines[i].index >= r.start && lines[i].index < r.end)) continue;
    const start = lines[i].index; let end = start;
    for (; i < lines.length; i++) {
      const line = lines[i][0];
      if (!/^\s*(?:$|#(?!#)|\[|[\w."'-]+\s*=|[}\]])/.test(line)) break;
      end = lines[i].index + line.length;
    }
    let parsed; try { parsed = parseTOML(text.slice(start, end)); } catch { throw invalid(); }
    mergeServers(servers, parsed.mcp_servers); ranges.push({ start, end }); i--;
  }
  if (!Object.keys(servers).length) throw invalid();
  let sanitized = text;
  for (const { start, end } of ranges.sort((a, b) => b.start - a.start)) sanitized = sanitized.slice(0, start) + '[MT5 MCP 配置已提取，密钥已隐藏]' + sanitized.slice(end);
  // Never accept a partially parsed second export, including a truncated copy.
  if (configMarker.test(sanitized)) throw invalid();
  return { servers, text: redact(sanitized, servers) };
}

/** Credentials never enter chat entities, model context, events or tool arguments. */
export class MT5ConfigImports {
  constructor(host, clock = Date.now) {
    this.host = host; this.clock = clock;
    this.directory = join(host.storage.directory, 'mt5', 'pending-imports');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 }); securePath(this.directory);
    this.pending();
  }
  path(messageId) {
    requireValue(/^msg_[a-zA-Z0-9_-]{1,100}$/.test(messageId), '无效的配置消息引用');
    return join(this.directory, `${messageId}.json`);
  }
  pending() {
    const result = [];
    for (const file of readdirSync(this.directory).filter(name => /^msg_[a-zA-Z0-9_-]+\.json$/.test(name))) {
      const path = join(this.directory, file);
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) continue;
      let record;
      try { record = JSON.parse(readFileSync(path, 'utf8')); } catch { rmSync(path); continue; }
      if (!record || !object(record.servers) || !Number.isFinite(record.expires_at) || this.clock() >= record.expires_at) { rmSync(path); continue; }
      result.push({ source_message_id: record.message_id, expires_at: new Date(record.expires_at).toISOString(), servers: summary(record.servers) });
    }
    return result;
  }
  prepare(messageId, conversation, parts, source, metadata) {
    const matches = parts.map(part => part.type === 'text' ? extractMT5Config(part.text) : null);
    if (!matches.some(Boolean)) return parts;
    requireValue(conversation.scope === 'main' && !source && metadata.origin !== 'automation', '请由用户在主会话中直接提供 MT5 配置', 403);
    const servers = {};
    for (const match of matches.filter(Boolean)) for (const [name, server] of Object.entries(match.servers)) {
      if (servers[name] && stableJSON(servers[name]) !== stableJSON(server)) throw invalid();
      servers[name] = server;
    }
    requireValue(this.pending().length < 32, '待导入配置过多，请先处理已有配置或在设置中填写');
    writeFileSync(this.path(messageId), JSON.stringify({ message_id: messageId, conversation_id: conversation.id, expires_at: this.clock() + TTL, servers }), { flag: 'wx', mode: 0o600 });
    securePath(this.path(messageId));
    const content = parts.map((part, i) => part.type === 'text' ? { type: 'text', text: redact(matches[i]?.text ?? part.text, servers) } : part);
    content[matches.findIndex(Boolean)].text += `\n[Sesame 已安全提取用户提供的 MT5 配置]\nsource_message_id: ${messageId}\n${JSON.stringify(summary(servers))}\n可用 mt5_import_configuration 按此引用导入；按用户意图处理，不需要再次索取密钥。此引用 24 小时后过期。`;
    return content;
  }
  read(messageId, conversationId) {
    this.pending();
    const message = this.host.messages.read(messageId, true);
    requireValue(message?.role === 'user' && !message.source_conversation_id && !message.system_generated && message.origin !== 'automation' && message.conversation_id === conversationId,
      '只能导入本次主会话用户直接提供的配置', 403);
    let record;
    try { const path = this.path(messageId); requireValue(!lstatSync(path).isSymbolicLink(), '配置引用无效'); record = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new ApiError(410, 'mt5_import_expired', '配置已导入或引用已过期；请检查现有设置，必要时重新粘贴 MT5 导出。'); }
    requireValue(record.conversation_id === conversationId && record.message_id === messageId && this.clock() < record.expires_at, '配置引用无效');
    return record;
  }
  remove(messageId) { rmSync(this.path(messageId), { force: true }); }
}
