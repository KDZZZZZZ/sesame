import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { isIP } from 'node:net';
import { ApiError, digest, now, id as entityId, requireValue, securePath } from './support.js';
import { stableJSON } from './contracts.js';
import { MT5MCP, connectionRefused } from './mcp.js';
import { PYTHON_TOOLS } from './python-tools.js';
import { MT5Python, LAUNCH_TOOLS, launch } from './process.js';
import { proxySettings } from './connection.js';
import { nativeConnectionSettings } from './native-settings.js';
import { builtinRoutes, pluginRoute } from './plugin-routing.js';
import { editorTools } from './editor-connection.js';

const defaults = () => ({ version: 1, allow_trading: true, allow_host_operations: true, startup_ini: '', account: {}, tester_agent: {}, servers: {
  terminal: { url: 'http://127.0.0.1:22346/mcp', token: '', enabled: true },
  metaeditor: { url: 'http://127.0.0.1:22345/mcp', token: '', enabled: true },
  marketdata: { url: 'https://www.metatrader.com/mcp', token: '', enabled: false },
} });
const groups = {
  workspace: 'get_workspace_info get_time_information',
  files: 'list_directory find_files_by_glob find_files_by_name_keyword read_file read_binary_file read_file_by_lines create_new_folder create_new_file write_file write_binary_file delete_file delete_folder replace_text_in_file search_text search_regex tree write edit read_image',
  editor: 'compile_file build_project syntax_check format_source_code open_file_in_editor list_open_documents',
  charts: 'chart_open chart_close chart_apply_template chart_add_indicator chart_remove_indicator chart_get_indicator_state list_open_charts list_available_indicators get_indicator_parameters',
  programs: 'list_available_mql5_programs list_available_expert_advisors get_expert_advisor_parameters get_script_parameters chart_add_expert chart_add_script chart_remove_expert',
  account: 'get_trading_account_info get_trading_history_positions get_trading_history_orders get_trading_open_positions',
  quotes: 'get_marketwatch_symbols add_marketwatch_symbol remove_marketwatch_symbol get_chart_history get_chart_ticks_history',
  trading: 'trade_send_market_order trade_send_pending_order trade_modify_sl_tp trade_delete_order trade_close_single_position trade_close_by_position',
  tester: 'tester_run_backtest tester_get_status tester_stop tester_wait tester_get_configuration tester_prepare_config tester_prepare_inputs tester_get_report tester_run_optimization',
  journals: 'get_terminal_journal get_expert_journal get_tester_journal',
  calendar: 'economic_calendar_list_countries economic_calendar_list_events_by_country economic_calendar_list_events_by_currency economic_calendar_list_values economic_calendar_list_values_last economic_calendar_get_value_by_id economic_calendar_get_event_by_id',
  marketdata: 'marketdata_symbol_search marketdata_symbol_get marketdata_symbol_history marketdata_symbol_income_statement marketdata_symbol_news marketdata_symbol_holdings',
  host: 'shell send_web_request',
};
const categories = new Map(Object.entries(groups).flatMap(([group, names]) => names.split(' ').map(name => [name, group])));
const execution = new Set('chart_open chart_close chart_apply_template chart_add_expert chart_add_script chart_remove_expert'.split(' '));
export const OFFICIAL_SERVERS = ['terminal', 'metaeditor', 'marketdata', 'python', 'launcher'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validate = (schema, args) => requireValue(object(args) && Value.Check(schema, args), '参数不符合工具 inputSchema；请先读取 mt5_catalog 中的定义');

export function connectionURL(server, value) {
  requireValue(typeof value === 'string' && value.length <= 2048, 'MCP 地址无效');
  let url; try { url = new URL(value); } catch { throw new ApiError(422, 'invalid_request', 'MCP 地址无效'); }
  requireValue(!url.username && !url.password && !url.search && !url.hash && (server === 'marketdata' ? url.href === 'https://www.metatrader.com/mcp' : ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)), '本机 MCP 只允许 loopback；市场数据只允许官方 MetaTrader.com 地址');
  return url.href;
}

export class MT5Official {
  constructor(host, native) { this.host = host; this.storage = host.storage; this.native = native; this.clients = new Map(); this.python = new MT5Python(native); this.jobs = new Map(); this.routeEntries = builtinRoutes(); }
  async init() {
    this.directory = join(this.storage.directory, 'mt5'); await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); securePath(this.directory);
    this.file = join(this.directory, 'connection.json'); this.config = defaults();
    try { this.config = { ...this.config, ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Only seed a new app configuration. A user's saved/disabled connections
      // must survive restarts, including credentials they explicitly cleared.
      const imported = await nativeConnectionSettings(this.native).catch(() => null);
      if (imported) {
        try { await this.configure({ expected_version: this.config.version, ...imported }); }
        catch (error) { if (error.status !== 422) throw error; }
      }
    }
    for (const command of this.storage.list('mt5_command')) if (command.status === 'running') this.storage.put('mt5_command', { ...command, status: 'unknown', completed_at: now(), error: '应用重启，调用结果未知；未自动重放。请查询终端、账户或 Tester 的真实状态。' });
    return this;
  }
  settings() {
    return { version: this.config.version, allow_trading: this.config.allow_trading, allow_host_operations: this.config.allow_host_operations,
      servers: Object.fromEntries(Object.entries(this.config.servers).map(([name, c]) => [name, { url: c.url, enabled: c.enabled, authenticated: Boolean(c.token) }])),
      account: { login: this.config.account.login ?? '', server: this.config.account.server ?? '', password_configured: Boolean(this.config.account.password) },
      tester_agent: { address: this.config.tester_agent?.address ?? '', port: this.config.tester_agent?.port ?? 2000, password_configured: Boolean(this.config.tester_agent?.password) },
      startup_configured: Boolean(this.config.startup_ini), python_installed: this.python.available() };
  }
  async configure(data) {
    requireValue(!this.closing && this.jobs.size === 0 && !this.saving, 'MT5 调用或配置正在进行，请稍后修改', 409, 'mt5_busy');
    requireValue(object(data) && Object.keys(data).every(k => ['expected_version', 'import_native', 'servers', 'allow_trading', 'allow_host_operations', 'account', 'startup_ini', 'tester_agent'].includes(k)), '连接配置包含未知字段');
    requireValue(data.expected_version === this.config.version, 'MT5 配置已更新，请刷新', 409, 'version_conflict');
    if (data.import_native !== undefined) {
      requireValue(data.import_native === true && Object.keys(data).length === 2, '读取本机配置不能同时修改其他设置');
      const imported = await nativeConnectionSettings(this.native);
      requireValue(imported, '未找到可读取的本机 MT5 连接配置', 422, 'mt5_native_settings_missing');
      for (const [name, server] of Object.entries(imported.servers)) {
        const saved = this.config.servers[name];
        if (!saved.enabled) server.enabled = false;
        // A file import is not authentication. Only mt5_connect may replace
        // an existing key after proving the native candidate works.
        if (saved.token && connectionURL(name, server.url) === saved.url) delete server.token;
      }
      // Recheck version/busy state after filesystem I/O, and apply the same
      // URL/credential validation and private storage as a manual save.
      return this.configure({ expected_version: data.expected_version, ...imported });
    }
    const next = structuredClone(this.config);
    for (const key of ['allow_trading', 'allow_host_operations']) if (data[key] !== undefined) { requireValue(typeof data[key] === 'boolean', '权限需要布尔值'); next[key] = data[key]; }
    if (data.servers !== undefined) {
      requireValue(object(data.servers), 'servers 需要对象');
      for (const [server, value] of Object.entries(data.servers)) {
        requireValue(['terminal', 'metaeditor', 'marketdata'].includes(server) && object(value) && Object.keys(value).every(k => ['url', 'token', 'enabled'].includes(k)), 'MCP 配置无效');
        const c = next.servers[server];
        if (value.url !== undefined) {
          const url = connectionURL(server, value.url);
          // A different endpoint must never receive the old endpoint's token.
          if (c.url !== url) c.token = '';
          c.url = url;
        }
        if (value.token !== undefined) { requireValue(typeof value.token === 'string' && value.token.length <= 8192 && !/[\r\n\0]/.test(value.token), 'MCP token 无效'); c.token = value.token; }
        if (value.enabled !== undefined) { requireValue(typeof value.enabled === 'boolean', 'enabled 需要布尔值'); c.enabled = value.enabled; }
      }
    }
    if (data.account !== undefined) {
      const a = data.account;
      requireValue(object(a) && Object.keys(a).every(k => ['login', 'server', 'password'].includes(k)), '账户配置无效');
      if (a.login !== undefined) { requireValue(typeof a.login === 'string' && /^(|[1-9][0-9]{0,19})$/.test(a.login), 'Login 必须是十进制字符串'); if (a.login !== next.account.login) next.account.password = ''; next.account.login = a.login; }
      if (a.server !== undefined) { requireValue(typeof a.server === 'string' && a.server.length <= 200 && !/[\r\n\0]/.test(a.server), '交易服务器无效'); if (a.server !== next.account.server) next.account.password = ''; next.account.server = a.server; }
      if (a.password !== undefined) { requireValue(typeof a.password === 'string' && a.password.length <= 1024 && !/[\r\n\0]/.test(a.password), '密码无效'); next.account.password = a.password; }
    }
    if (data.startup_ini !== undefined) {
      requireValue(typeof data.startup_ini === 'string' && Buffer.byteLength(data.startup_ini) <= 64 * 1024 && !data.startup_ini.includes('\0'), '原生启动配置应为不含 NUL 的 INI，最多 64 KiB');
      next.startup_ini = data.startup_ini;
    }
    if (data.tester_agent !== undefined) {
      const a = data.tester_agent;
      requireValue(object(a) && Object.keys(a).every(k => ['address', 'port', 'password'].includes(k)), '测试代理配置无效');
      next.tester_agent ??= {};
      if (a.address !== undefined) { requireValue(typeof a.address === 'string' && (!a.address || isIP(a.address) === 4), '测试代理需 IPv4 地址'); next.tester_agent.address = a.address; }
      if (a.port !== undefined) { requireValue(Number.isInteger(a.port) && a.port >= 1024 && a.port <= 65535, '测试代理端口应为 1024–65535'); next.tester_agent.port = a.port; }
      if (a.password !== undefined) { requireValue(typeof a.password === 'string' && a.password.length <= 1024 && !/[\r\n\0]/.test(a.password), '测试代理密码无效'); next.tester_agent.password = a.password; }
    }
    next.version++;
    this.saving = true;
    try {
      await fs.writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 }); await fs.rename(`${this.file}.tmp`, this.file); await fs.chmod(this.file, 0o600); securePath(this.file);
      this.config = next;
      for (const client of this.clients.values()) client.close(); this.clients.clear(); await this.python.close(); this.python = new MT5Python(this.native);
      return this.settings();
    } finally { this.saving = false; }
  }
  client(server) {
    const config = this.config.servers[server];
    requireValue(config?.enabled && config.token, '请先在前端配置并启用此 MCP 连接', 503, 'mt5_not_configured');
    if (!this.clients.has(server)) this.clients.set(server, new MT5MCP({ ...config, server }));
    return this.clients.get(server);
  }
  permission(server, tool) {
    if (server === 'python') return ['initialize', 'login', 'order_send'].includes(tool) ? 'trading' : 'standard';
    if (server === 'launcher') return tool === 'start_terminal' ? 'trading' : tool.startsWith('tester_agent_') ? 'host' : 'standard';
    if (!categories.has(tool)) return 'unclassified';
    if (categories.get(tool) === 'trading' || execution.has(tool)) return 'trading';
    if (categories.get(tool) === 'host') return 'host';
    return 'standard';
  }
  plugin(server, tool) {
    return this.route(server, tool).plugin_id;
  }
  route(server, tool) { return pluginRoute(this.routeEntries ??= builtinRoutes(), server, tool, categories.get(tool), this.permission(server, tool)); }
  access(server, tool, owner) {
    const { plugin_id: plugin, agent_tool } = this.route(server, tool), policy = this.policy?.(plugin, owner);
    const blocked = policy?.state === 'disabled' ? '所属插件不可使用' : owner && policy && !policy.loaded ? '请先通过 plugin_load 加载所属插件' : this.blocked(this.permission(server, tool));
    return { plugin_id: plugin, agent_tool, plugin_state: policy?.state ?? null, loaded: policy?.loaded ?? null, blocked_reason: blocked ?? (!plugin ? '没有已注册的路由插件' : null), callable: Boolean(plugin && !blocked) };
  }
  deploymentAccess(owner = null) {
    const policy = this.policy?.('sesame/mt5', owner);
    const blocked = policy?.state === 'disabled' ? '受管理挂载插件已关闭' : owner && policy && !policy.loaded ? '请先加载受管理挂载插件' : null;
    return { blocked_reason: blocked, callable: !blocked };
  }
  // Only the trusted deployment controller can mint this private capability.
  // Generic MCP arguments cannot opt into it or enable raw order/shell tools.
  async callDeployment(deploymentId, suffix, tool, args) {
    const d = this.storage.get('mt5_deployment', deploymentId);
    requireValue(d.login === String(this.config.account.login) && d.server === this.config.account.server, '挂载账户已改变', 409);
    const matches = tool === 'chart_open' ? d.status === 'preparing' && args.symbol === d.symbol && args.period === d.period
      : tool === 'chart_add_expert' ? d.status === 'attaching' && args.chart_id === d.chart_id && args.expert_path === d.expert_path
      : tool === 'chart_remove_expert' && args.chart_id === d.chart_id && Boolean(d.chart_id);
    requireValue(matches, '此操作不属于当前受管理挂载', 403);
    const data = { command_id: `${d.id}_${suffix}`, server: 'terminal', tool, arguments: args };
    this.deploymentCommands ??= new WeakSet(); this.deploymentCommands.add(data);
    try { return await this.call(data, null); } finally { this.deploymentCommands.delete(data); }
  }
  blocked(permission) { return permission === 'unclassified' ? '此版本新增工具尚未分类' : permission === 'trading' && !this.config.allow_trading ? '用户尚未允许交易和 EA/脚本启动' : permission === 'host' && !this.config.allow_host_operations ? '用户尚未允许原生网络或 shell 操作' : null; }
  redact(value) {
    let text = JSON.stringify(value);
    const secrets = [...Object.values(this.config.servers).map(c => c.token), this.config.account.password, this.config.tester_agent?.password, proxySettings(this.config.startup_ini).ProxyPassword];
    for (const secret of secrets.filter(s => s && s.length >= 4)) text = text.replaceAll(JSON.stringify(secret).slice(1, -1), '[redacted]');
    return JSON.parse(text);
  }
  async tools(server, signal, { startIfNeeded = false } = {}) {
    if (server === 'python') { if (!this.python.available()) throw dependencyError('python-ipc', this.storage.directory, ['MT5', 'Windows Python + MetaTrader5 SDK']); return PYTHON_TOOLS; }
    if (server === 'launcher') { if (!this.native) throw dependencyError('launcher', this.storage.directory, ['MT5 terminal']); return LAUNCH_TOOLS; }
    return server === 'metaeditor' && startIfNeeded ? editorTools(this, signal) : this.client(server).list(signal);
  }
  async catalog(server, query = '', signal, owner) {
    requireValue(!server || OFFICIAL_SERVERS.includes(server), '未知 MT5 server');
    requireValue(typeof query === 'string' && query.length <= 200, '查询文本过长');
    const items = await Promise.all((server ? [server] : OFFICIAL_SERVERS).map(async name => {
      const empty = (status, reason) => ({ server: name, status, reason, server_info: null, workspace: null, tools: [] });
      const config = this.config.servers[name];
      if (config && !config.enabled) return empty('disabled', name === 'marketdata' ? '此独立数据服务未启用，不影响券商行情。' : '此连接未启用，需要时可在高级设置开启。');
      if (config && !config.token) return empty('unconfigured', '需要时在高级设置填写此服务的 API Key。');
      if (name === 'python' && !this.python.available()) return { ...empty('not_installed', '尚未找到 MT5 或已配置的 Windows Python。'), prerequisite: dependencyRequirement('python-ipc', this.storage.directory, ['MT5', 'Windows Python + MetaTrader5 SDK']) };
      if (name === 'launcher' && !this.native) return { ...empty('not_installed', '尚未找到本机 MT5 安装。'), prerequisite: dependencyRequirement('launcher', this.storage.directory, ['MT5 terminal']) };
      try {
        const tools = await this.tools(name, signal, { startIfNeeded: server === 'metaeditor' }), client = this.clients.get(name);
        return { server: name, status: client ? 'connected' : 'installed', reason: client ? null : '已找到运行环境；实际连接与执行结果以调用为准。', server_info: client?.info ?? null, workspace: client?.workspace?.structuredContent ?? null,
          tools: tools.filter(t => `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase())).map(tool => {
            return { ...tool, category: categories.get(tool.name) ?? name, permission: this.permission(name, tool.name), ...this.access(name, tool.name, owner) };
          }) };
      } catch (error) {
        if (['terminal', 'metaeditor'].includes(name) && connectionRefused(error)) return empty('not_running', name === 'metaeditor' ? '需要编辑或编译 MQL5 时启动 MetaEditor。' : '正在等待 MT5 启动，应用会自动尝试连接。');
        return empty('unavailable', this.redact(error.upstreamStatus === 401 ? '连接密钥未通过验证，请在高级设置更新。' : error.message === 'fetch failed' ? '连接失败，请检查服务地址和网络。' : error.message));
      }
    }));
    return this.redact({ checked_at: now(), items });
  }
  command(id, owner) {
    const value = this.storage.get('mt5_command', id);
    requireValue(!owner || value.conversation_id === owner, '只能读取本会话的调用记录', 403);
    const { fingerprint, ...publicValue } = value; return publicValue;
  }
  async call(data, owner, signal) {
    requireValue(!this.closing && !this.saving, 'MT5 正在关闭或配置中', 503);
    requireValue(object(data) && Object.keys(data).every(k => ['command_id', 'server', 'tool', 'arguments'].includes(k)), '调用包含未知字段');
    const { command_id: id, server, tool, arguments: args } = data;
    const managed = this.deploymentCommands?.has(data) === true;
    requireValue(typeof id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(id) && OFFICIAL_SERVERS.includes(server) && typeof tool === 'string' && object(args), '需要稳定 command_id、server、tool 和 arguments');
    requireValue(Buffer.byteLength(JSON.stringify(args)) <= 2 * 1024 * 1024, '参数超过 2 MiB');
    const fingerprint = digest(stableJSON({ server, tool, arguments: args, owner, version: this.config.version }));
    const pending = this.jobs.get(id);
    if (pending) { requireValue(pending.fingerprint === fingerprint, 'command_id 与在途请求冲突', 409, 'idempotency_conflict'); return pending.promise; }
    const previous = this.storage.get('mt5_command', id, true);
    if (previous) {
      requireValue(previous.fingerprint === fingerprint, 'command_id 已用于不同请求或配置', 409, 'idempotency_conflict');
      return this.command(id, owner);
    }
    const task = (async () => {
      const definition = (await this.tools(server, signal, { startIfNeeded: !this.access(server, tool, owner).blocked_reason })).find(t => t.name === tool);
      requireValue(definition, '此连接没有提供该工具，请刷新 mt5_catalog', 404, 'mt5_tool_missing');
      validate(definition.inputSchema, args);
      const { blocked_reason: blocked } = managed ? this.deploymentAccess() : this.access(server, tool, owner); requireValue(!blocked, blocked, 403, 'mt5_permission_denied');
      if (server === 'python' && tool === 'login') requireValue(this.config.account.login, '请先在前端保存账户 Login', 409);
      if (server === 'launcher' && args.use_startup_config) requireValue(this.config.startup_ini, '请先在前端保存原生 INI', 409);
      if (server === 'launcher' && args.use_account_login) requireValue(this.config.account.login, '请先在前端保存账户 Login', 409);
      signal?.throwIfAborted();
      let command = { id, fingerprint, conversation_id: owner ?? null, server, tool, operation_class: this.permission(server, tool), status: 'running', result: null, dataset_id: null, error: null, created_at: now(), completed_at: null };
      this.storage.put('mt5_command', command);
      try {
        let result;
        if (server === 'python') result = await this.python.call(tool, args, this.config.account, signal);
        else if (server === 'launcher') {
          const configFile = join(this.directory, 'startup.ini');
          if (args.use_startup_config) await fs.writeFile(configFile, this.config.startup_ini, { mode: 0o600 });
          result = await launch(this.native, tool, { ...args, configured_login: this.config.account.login }, configFile, this.config.tester_agent, signal);
        } else result = await this.client(server).call(tool, args, signal);
        command = { ...command, status: result.outcome_unknown ? 'unknown' : result.isError || result.error || (server === 'python' && (result.result === null || result.result === false) && tool !== 'shutdown') ? 'failed' : 'returned', result: this.redact(result) };
      } catch (error) { command = { ...command, status: 'unknown', error: this.redact(`${error.message}；不自动重放，先核对实际状态。`) }; }
      this.storage.transaction(() => {
        if (command.status === 'returned' && server !== 'launcher') {
          const key = entityId('data'), received = now();
          const rows = [{ command_id: id, server, tool, received_at: received, result: command.result }];
          this.host.datasets.register( { id: key, title: `MT5 ${server} / ${tool}`, rows,
            provenance: { kind: 'observed', dataset_id: key, source_kind: 'external', provider: `mt5/${server}/${tool}`, as_of: received, data_hash: digest(JSON.stringify(rows)), engine_version: server === 'python' ? 'MetaTrader5-python' : 'mt5-native-mcp', time_range: null } });
          command.dataset_id = key;
        }
        this.storage.put('mt5_command', { ...command, completed_at: now() });
      });
      return this.command(id, owner);
    })();
    // Reserve before the first async discovery, including concurrent duplicates.
    this.jobs.set(id, { fingerprint, promise: task });
    try { return await task; } finally { this.jobs.delete(id); }
  }
  // Read-only account snapshot for the dashboard. Unlike call(), it keeps no command record and no dataset.
  async account(signal, { historyAgeMs = 0 } = {}) {
    const configured = { login: String(this.config.account.login ?? ''), server: this.config.account.server ?? '' };
    const base = { checked_at: now(), configured, terminal: null, account: null, open: null, history: null };
    const terminal = this.config.servers.terminal;
    if (!terminal?.enabled || !terminal.token) return { ...base, status: 'not_configured', reason: '请先在“MT5 连接”中启用并配置交易终端' };
    const tools = ['get_trading_account_info', 'get_trading_open_positions', 'get_trading_history_positions'];
    const blocked = tools.map(tool => this.access('terminal', tool, null).blocked_reason).find(Boolean);
    if (blocked) return { ...base, status: 'blocked', reason: blocked };
    const read = async (tool, args) => {
      const result = await this.client('terminal').call(tool, args, signal);
      const text = result.content?.find(part => part.type === 'text')?.text;
      requireValue(!result.isError, text || `${tool} 调用失败`, 502, 'mt5_call_failed');
      return result.structuredContent ?? JSON.parse(text ?? '{}');
    };
    try {
      const info = await read('get_trading_account_info', {});
      const connected = info.terminal?.server_connected === true;
      const matches = connected ? String(info.account?.login ?? '') === configured.login && info.account?.server === configured.server : null;
      if (!connected) return this.redact({ ...base, status: 'offline', reason: '终端已运行，但尚未连接交易服务器', terminal: info.terminal ?? null, account: info.account ?? null, matches });
      const to = new Date(), from = new Date(to.getTime() - 30 * 86400_000);
      const historyKey = JSON.stringify([configured, this.config.version]);
      const [open, history] = await Promise.all([
        read('get_trading_open_positions', { include_orders: true }),
        this.accountHistory?.key === historyKey && Date.now() - this.accountHistory.at < historyAgeMs ? this.accountHistory.value
          : read('get_trading_history_positions', { datetime_from: from.toISOString(), datetime_to: to.toISOString(), limit: 50 }).then(value => { this.accountHistory = { key: historyKey, value, at: Date.now() }; return value; }),
      ]);
      return this.redact({ ...base, status: 'connected', reason: null, terminal: info.terminal ?? null, account: info.account ?? null, matches, open, history, history_from: from.toISOString() });
    } catch (error) {
      return { ...base, status: 'unavailable', reason: this.redact(error.message) };
    }
  }
  async close() {
    this.closing = true; for (const client of this.clients.values()) client.close();
    await this.python.close(); await Promise.allSettled([...this.jobs.values()].map(job => job.promise).concat(this.editorStarting ?? []));
  }
}
import { dependencyError, dependencyRequirement } from './prerequisites.js';
