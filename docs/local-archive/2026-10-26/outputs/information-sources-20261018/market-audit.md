# 行情获取验证（2026-10-18）

本次通过隔离 Sesame Runtime 的正式插件安装与注册能力调用验证 AKShare、CCXT；不启动模型，不交易，不修改安装版或用户数据。依赖只准备在测试目录，复测复用同一已验证环境。

| 插件 / 路径 | 本次实际证据 | 结论 |
| --- | --- | --- |
| AKShare 腾讯日线 | 600519，2026-10-01 至 10-16，返回 7 行 | 可用；保留来源、日期和成交量口径 |
| AKShare 新浪日线 | 相同证券、区间，返回 7 行 | 可用；独立来源，没有拼成同一序列 |
| AKShare 腾讯报价 | 初次中文名称触发 Windows cp1252 编码异常；修复后返回 1 行实际报价 | 已修复并真实复测 |
| AKShare 东方财富 | 历史与报价均返回 ProxyError / RemoteDisconnected | 当前网络不可用；不是 AKShare 整包失效，不宣称该站永久失效 |
| CCXT 环境检查/准备 | 原实现缺模块时子进程报错，中断检查及准备；修复后 inspect 返回 ready:false，prepare 完成私有 CCXT 4.5.85 环境 | 已修复并真实复测 |
| CCXT Kraken | 注册 host bind/search/describe/queryBars，BTC 日线 17 根 | 通过本机已有、显式绑定的无凭据代理可用 |
| CCXT Coinbase | 同样的完整注册接口路径，BTC 日线 17 根 | 同上 |
| CCXT OKX | 同样的完整注册接口路径，BTC 日线 17 根 | 同上 |
| CCXT 直连 | 三家均 SOURCE_UNAVAILABLE；同一公开接口经已有代理可以访问 | 路由条件，不需要交易所 API Key；描述已明确 publicProxy 不继承系统环境变量 |
| QMT | 注册 environment inspect 正常返回所需前置配置；未检测到 MiniQMT 运行进程及本机 Python 中的 xtquant | 保留可选能力；本次没有券商 MiniQMT 连接与行情验证，不冒充通过 |
| MT5 原生 SDK | 连接现有终端，XAUUSD 报价和 20 根 D1 返回 | 原生路径可用；插件层验证单列，不能把 SDK 结果当作宿主调用证明 |

## 修复与回归

- CCXT 将“依赖不存在/导入不兼容”作为正常探测结果，排除不存在的绝对 Python 路径后再创建子调用。真正安装或执行失败仍保留错误。
- AKShare JSON 管道使用 Unicode 转义保留中文值，避免依赖 Windows 输出代码页；中文上游错误也能保持结构化。
- 两个新增回归先复现失败后通过。行情侧共 52 个 Node 回归通过、1 个独立可选宿主测试跳过；AKShare 新增 Python 回归 2 个通过。

## 证据范围

- `market-run-1/evidence.json`：初次环境问题。该版审计脚本把 AKShare 的 `arguments` 写成了 `args`，这些 INVALID_INPUT 是测试脚本错误，不计作插件缺陷。
- `market-run-2/evidence.json`：AKShare 日线、旧编码故障、CCXT 准备修复。该版脚本误用 Agent consumer 调用 host 专用 market 操作，CAPABILITY_CONSUMER 属于测试脚本错误，不计作插件缺陷。
- `market-run-3/evidence.json`：编码修复后真实腾讯报价通过；CCXT 正确 host consumer 的直连失败。
- `market-run-4/evidence.json`：显式使用已有授权代理，三家交易所完整注册操作均通过，结束后释放绑定和插件进程。
- `mt5-native-readiness.json`：只读 SDK 检查，不包含账户凭据。

这些是有限样本的可用性证据，不是全部交易品种、所有参数或长期 SLA 的保证。没有发现需要删除整包的不可修复问题；有同类可用来源时应显式选择并保留来源身份，不把数据缺口补成零值。
