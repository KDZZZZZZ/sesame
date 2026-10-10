import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { requireValue } from './support.js';

async function ini(file, fields) {
  let bytes;
  try {
    const info = await fs.lstat(file);
    requireValue(info.isFile() && info.size <= 65536, '本机 MT5 配置文件格式不支持');
    bytes = await fs.readFile(file);
  } catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const values = new Map(); let section = '';
  for (const line of bytes.toString(bytes.includes(0) ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const text = line.trim(), heading = /^\[([^\]]+)\]$/.exec(text);
    if (heading) { section = heading[1].toLowerCase(); continue; }
    const pair = /^([^=;#]+)=(.*)$/.exec(text), key = pair?.[1].trim().toLowerCase();
    if (Object.hasOwn(fields, section) && fields[section].includes(key)) {
      requireValue(!values.has(`${section}.${key}`), '本机 MT5 配置含重复字段，未导入');
      values.set(`${section}.${key}`, pair[2].trim());
    }
  }
  return values;
}

// Read-only compatibility with MT5's local format, not a public INI
// write contract. Live MCP discovery still determines whether a server works.
// https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration
export async function nativeConnectionSettings(native) {
  if (!native) return null;
  const directory = join(native.dataDirectory, 'config');
  const mcp = await ini(join(directory, 'assistant.ini'), {
    'mcp.metatrader': ['enable', 'endpoint', 'apikey'],
    'mcp.metaeditor': ['enable', 'endpoint', 'apikey'],
  });
  const servers = {};
  for (const [name, section] of [['terminal', 'mcp.metatrader'], ['metaeditor', 'mcp.metaeditor']]) {
    const url = mcp.get(`${section}.endpoint`), token = mcp.get(`${section}.apikey`), enable = mcp.get(`${section}.enable`);
    // Some builds (observed in 6230) store ApiKey as an opaque hexadecimal
    // block, not the Bearer key shown in the official MCP configuration export.
    // Never guess/decode that private format or overwrite a usable saved key.
    const opaque = token && /^(?:[a-f0-9]{2}){64,}$/i.test(token);
    if (url && ['0', '1'].includes(enable)) servers[name] = { url, enabled: enable === '1', ...(token && !opaque ? { token } : {}) };
  }
  const common = await ini(join(directory, 'common.ini'), { common: ['login', 'server'] });
  const login = common.get('common.login'), server = common.get('common.server');
  const account = /^[1-9][0-9]{0,19}$/.test(login ?? '') && server ? { login, server } : null;
  return Object.keys(servers).length || account ? { servers, ...(account ? { account } : {}) } : null;
}
