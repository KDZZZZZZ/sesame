# MetaTrader 5

本插件提供 MT5 行情、账户、MQL5 工程、编译、Tester、交易与持久运行观察。能力及输入输出由 `capabilities.json` 明确声明；完整用法见 [INTERFACES.md](INTERFACES.md)。Agent 可以直接保存连接配置和用户提供的凭据，无需导入文件、打开 Sesame 设置页或重启应用。

已授权手动交易通过 `mt5_trading_prepare({symbol, command_id, user_authorized:true})` 集中准备，无需模型先逐项检查配置、权限、账户、目录和历史。它只在必要时开启 Sesame 交易许可、复用原终端权限准备和一次 Python IPC 初始化；正常连接跳过初始化与重启。账户核验后一起调度品种规格、持仓和挂单，再读取最新原始 tick，最后复核账户与配置。Python worker 仍按队列串行调用 SDK，不宣称原生并发。返回 `account/summary/terminal/spec/positions/orders/tick/readStartedAt/capturedAt/preparation`；可选 `expected_account:{accountId,server,revision}` 用于组合入口的精确账户锁。

同一命令不重复配置或重启，重复请求重新读取事实而不复用旧报价；该入口不下单、不切账户，也不判断业务数量和价格界限。`mt5_trading_permissions` 保留单独诊断用途。券商、只读账户、Python API禁用及原生 MCP 操作权限分别返回实际限制；不猜测 AI Assistant Trading 的配置键。技术准备成功不代表报价有效或实际订单成功，执行入口仍核验时效、价格与真实回执。

## 适配型插件试点

本次整理先验证既有工厂纯度、配置凭据、数据源及安装激活回归，再将入口中的生命周期和分发代码移入 `backend/plugin-runtime.js`。`index.js` 只将声明绑定到实现；已有 `backend/`、`tools/`、`skills/` 保留各自职责，不搬动原生 SDK、Python bridge 或工具实现。

插件 ID、已有能力 ID、输入输出 Schema、状态目录和公开工具保持原状。统一配置入口通过新增的宿主只读 `configuration.read` 投影读取公开设置与凭据存在状态，写入沿用 `mt5_update_configuration`。服务和子任务可检查依赖，原有 `mt5_settings` 和配置写入仍只允许主会话。依赖只绑定到实际使用对应配置的能力。行情和账户 source 将已知的原生连接故障转换为宿主可识别的错误码；断线和超时可重取快照，认证错误保留配置提示，未知实现错误不自动重试。

### 工程与编译边界

`backend/service.js` 保留 `MT5` 类和既有方法入口，统一拥有 host、私有记录存储、official 连接、编译 jobs/tail 及关闭生命周期。包内模块按职责实现原方法：

| 模块 | 职责 |
| --- | --- |
| `backend/projects.js` | 读取包内模板与 SDK；工程及 revision、风险配置、源码契约校验、checkout/save 和 SDK 一致性检查 |
| `backend/compiler.js` | 编译依赖发现、冻结构建、单队列调度、取消与结果记录；在初始化时处理被中断的构建 |

两个模块使用同一个 `MT5` 实例及 `mt5.sqlite`，不另建数据库、连接或编译队列。项目、checkout、编译产物和 SDK 的相对路径不变；同一个 build 重复启动仍返回已有任务，排队编译串行执行。重启时 `queued`、`compiling` 构建仍转为 `failed`，不会自动重放；原生清理无法确认仍记录 `unknown`。

`plugins/api-v1/tests/mt5-project-compiler.test.js` 覆盖 SQLite 真重开、模板与 revision 保留、单队列及重复启动、等待中的取消、关闭清理和缺依赖诊断。编译测试以受控 worker 回执验证冻结文件和 owner，不替代真实 MetaEditor/MT5 原生验收。

### 2026-10-19 行情订阅验证

- 运行中应用的实际图表回执为 `status:error`、`feed_status:stale`、`bar_count:0`，诊断为 `INTERNAL: sesame/mt5#market subscribeBars (sesame/mt5#market.subscribeBars): The provider could not complete this request`。
- 使用原已配置本机服务进行只读验证，终端在线且账户匹配；安装包的行情 provider 与开发源码当时一致，同一图表请求及宿主输入输出校验均成功。该错误已丢失原始底层原因，不能据此断言最初的故障是认证、会话失效或断线。
- 回归测试确认已知原生临时读故障会被映射为不可恢复的 `INTERNAL`。修复在 MT5 source 边界保留宿主支持的错误分类，认证错误与未知实现错误不作为临时断线重试。
- 对已打开图表通过应用画布接口释放并原样恢复绑定。实际回执恢复为 `status:rendered`、`feed_status:live`、`bar_count:346`；绑定、品种、周期、图表选项和布局保持一致。未安装新插件、重启应用或修改账户及交易配置。源码修复需随正常发布生效。
- 试点基线 44 项测试通过；变更后 54 项通过，包含凭据回执脱敏、配置输入兼容、依赖条件、行情恢复、工厂纯度和临时宿主安装验证。

## 配置与对应能力

| 配置 | 什么时候需要 | 如何设置和验证 |
| --- | --- | --- |
| `servers.terminal.url/enabled/token` | MT5 Terminal MCP 行情、账户、原生方法和交易 | 主 Agent 用 `mt5_update_configuration` 保存；`mt5_connect` 核验连接及精确账户 |
| `servers.metaeditor.url/enabled/token` | MetaEditor MCP 编辑、编译 | 同一配置能力保存；`mt5_catalog({server:"metaeditor"})` 核验可用方法 |
| `servers.marketdata.enabled/token` | 可选 MetaTrader.com 数据服务 | 固定官方地址；同一配置能力保存，`mt5_catalog({server:"marketdata"})` 核验。券商行情不需要启用它 |
| `account.login/server/password` | 绑定券商账户；独立 Tester 运行需要密码 | 同一配置能力保存，`password_configured` 只证明已保存；终端连接、Python IPC 和 Tester 分别核验 |
| `tester_agent.address/port/password` | 使用明确指定的 MetaTester 代理 | 同一配置能力保存；实际原生代理调用验证可用性 |
| `allow_trading/allow_host_operations` | 交易、EA/脚本启动及原生宿主操作 | 默认为开启，主 Agent 可按用户授权调整；保存本身不会下单或启动程序 |
| 终端目录、数据目录、Windows Python、Wine 路径 | 本机编译、Tester、Python IPC 或启动终端 | `mt5_dependencies({action:"inspect"})` 给出已有路径和实际缺项，`action:"configure"` 保存路径 |

`mt5_update_configuration` 接受 `{command_id,expected_version,changes}`。版本来自 `mt5_settings`，相同操作重试使用相同 `command_id`。凭据字段省略保留现有值，空字符串清除；更换 endpoint 或账户身份会清除对应旧凭据，需要时在同次调用提供新值。连接 token 最长 8192 字符，账户和代理密码最长 1024 字符，均不接受换行或 NUL。

凭据保存在插件私有连接文件中；配置历史、事件和回执隐藏其值，只返回配置状态。保存立即刷新内存和连接客户端。`applied` 表示配置完成，实际连接和业务执行仍以各能力的观察结果为准。凭据不应出现在报告、脚本或长期记忆里。

`mt5_import_configuration` 只是复用 `pendingImports` 引用的可选快捷方式；`changes:{import_native:true}` 也可读取已有原生配置。用户已提供普通 token/password 时直接配置，不要求重新导出或改变输入格式。只有实际缺失的信息才需要询问，已有信息及授权继续使用。

打开已选本机终端使用 `mt5_start_terminal`，无需 MCP token；它保留原数据目录和 profile。启动回执不证明券商、MCP 或 Python 已连接，按任务需要使用对应能力核验。
