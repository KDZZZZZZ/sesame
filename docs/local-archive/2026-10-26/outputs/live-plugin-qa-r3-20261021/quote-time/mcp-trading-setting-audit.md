# MT5 MCP 交易开关入口审计

2026-10-21。范围：冻结的 R3 回执、仓库源码和 MetaQuotes 官方公开文档。未调用 MT5、账户、交易、模型或数据库，未读取当前终端私有配置，未改变产品、安装或运行时。

结论：目前能确认的 **AI Assistant → Trading** 设置入口是官方终端界面；没有找到可作为实现合同的官方 INI 字段或 MCP setter。现有插件的自动准备只设置算法交易相关的 `[Experts]`，不能据此声称已经配置 AI Trading。不能把“没有找到公开合同”扩大为“所有终端版本都不可能程序化设置”。

## 官方入口与证据

1. **明确支持的入口**：MT5 `Tools → Options → AI Assistant → Trading`，可允许交易、每次要求确认或禁止交易。官方说明 AI 设置也覆盖 MCP 及适用的外部 agent，且 Terminal 与 MetaEditor 共用这些设置，MCP 地址除外。该页没有给出 Trading 的 INI 键或修改 API。[MetaTrader 5：AI/MCP 配置](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration)
2. **启动配置没有建立这个开关的合同**：`/config:path` 可加载自定义启动 INI；文档中的 `[Experts] Enabled`、`AllowLiveTrading` 管理 EA/自动交易，没有描述 AI Trading 字段。文档自称列举主要设置，故不能用该页未列出作为绝对不存在的证明。[MetaTrader 5：命令行与启动配置](https://www.metatrader5.com/en/terminal/help/start_advanced/start)
3. **公开 MCP 工具表没有权限修改工具**：官方列出交易、账户、图表、EA、测试等工具，但未列出 AI Trading setter。官方也提醒能力不断增加、目录受配置影响；若要判定某个已连接版本是否新增 setter，应只读查看该版本公开的 `tools/list` 合同。本次没有连接终端，也没有冒充已经验证其最新目录。[MetaTrader 5：MCP 能力](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities)
4. **其他权限不能替代这个设置**：EA 的全局自动交易开关与单 EA 开关同时约束 EA；外部 Python API 的禁用设置另列。不要用 Python/EA 的状态证明原生 MCP 已接受交易。[MetaTrader 5：EA 与 Python 设置](https://www.metatrader5.com/en/terminal/help/startworking/settings)

## 当前仓库实现

| 实现 | 证据 | 能证明什么 |
| --- | --- | --- |
| `terminalConfig` | [terminal.js:12](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/terminal.js:12) | 只生成 Common、代理参数及 Experts；Experts 写入 `Enabled`、`AllowLiveTrading`、`AllowDllImport`、`Account`、`Profile`。没有 AI Trading 配置。 |
| `prepareTerminal` | [terminal.js:87](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/terminal.js:87) | 预先要求 `mcp_trade_allowed === true`，Experts 已开启时可直接返回；重启后校验 Experts/MCP 两个布尔值。这个流程没有设置 AI Trading，也没有逐项证明所有原生交易门禁。 |
| 原生连接发现 | [native-settings.js:25](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/native-settings.js:25) | `assistant.ini` 仅按白名单只读获取 `mcp.metatrader/mcp.metaeditor` 的 enable/endpoint/apikey；源码明确声明这不是公开 INI 写入合同。没有 Trading 键。 |
| 本地插件授权 | [official.js:175](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/official.js:175) | `allow_trading` 是 Sesame 插件自己的许可；为 true 只表示放行插件这一层。被本地拒绝时返回 `mt5_permission_denied`。 |
| 自定义启动 INI | [official.js:113](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/official.js:113) | 接受有限大小的 INI 字符串并可交给启动器。可透传字符串不等于终端支持任意猜测的新键。 |
| MCP 请求 | [mcp.js:11](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/mcp.js:11)、[official.js:259](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/official.js:259) | 使用保存的 endpoint/token 调原生工具；没有附加“允许交易”权限参数。原生 `isError` 被记录为失败。 |

## 冻结回执的含义

[trade-receipts.json](E:/brief2great/sesame/outputs/live-plugin-qa-r3-20261021/trade-receipts.json) 中，原生 `trade_send_market_order` 返回 `Tool 'trade_send_market_order' trading is not permitted`。先前读取的 `mcp_trade_allowed: true` 与 `experts_trade_allowed: true` 不能推翻该次实际拒绝。

可以确定：拒绝来自原生工具结果，和 Python `order_check` 的参数适配错误不同；当前插件所见的两个许可布尔值不足以保证这次工具执行。不能确定：当前 AI Trading 具体选择、权限在两个时刻是否变化、原生版本是否存在状态回报/执行不一致。本次未读取 UI，故不能把 AI Trading 禁止当成已证实根因。

## 设置优先级与最小后续处理

权限是各执行通道自己的门禁，没有一个通用的“设 true 覆盖全部”优先级。诊断证据优先级是：**该次实际原生结果 > 同实例同时间的状态 > 较早的许可快照 > 本地配置意图**。

1. 保留用户已经给出的交易授权；在同一个账户/实例范围内复用，不再因相同意图重复询问。先识别阻塞层，勿通过反复重启、换端口、重试订单来猜权限。
2. 只读查看目标版本公开工具目录；若确有设置工具，依据它的实际 schema 使用，并记录应用结果。现在的公开资料未建立这个入口，不能实现虚构 setter。
3. 当前已验证的设置入口是上述 AI Assistant UI。可由具备原生 UI 控制能力的执行端在已授权范围内操作；本审计限定只读，未进行操作。不要为这一开关改动模型、API Key、网络或 shell 权限。
4. `mt5_trading_permissions` 的结果应说明自己实际验证了哪些层；遇到原生 `trading is not permitted` 时报告原生拒绝及官方设置入口，不再仅据两个 true 继续声称交易已就绪。
5. 对已经授权的下一笔测试，执行方应检查一次当前状态，提交一次并保存原生回执；不要为验证许可另增重复订单。传输结果不明先对账，不重放。交易后可立即并行准备无需账户写入的工作；依赖成交的后续操作仍以成交回执为前提。

建议回归形状：模拟本地 allow_trading=true、原生两个许可=true、实际工具返回 isError 的组合，断言最终状态为失败、保留原始原因、不自动重试或重启、不生成虚构成交、不将 AI Trading 的未知值描述成已开启或已禁止。配置单测断言现有启动 INI 不出现无官方合同的 AI/MCP Trading 字段。真实通道验证由主任务执行，本审计不声称已恢复原生交易。
