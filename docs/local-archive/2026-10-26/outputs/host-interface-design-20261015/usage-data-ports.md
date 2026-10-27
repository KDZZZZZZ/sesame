# 数据类宿主接口生产使用核对

口径：静态核对当前工作区的生产调用路径，不声称这些路径在本次会话中实际执行过。检查 api-v1/packages、optional-api-v1/packages 的 55 个包，另查外层同名树的 7 个空开发目录。识别 host/this.host/mt5.host/this.mt5.host/service.host 和 MT5.storage→host.storage 别名；测试、纯示例、字符串代码和能力探测不单独算生产调用。

## 逐方法覆盖

| 接口 | 生产使用者 | 一处真实调用证据 |
| --- | --- | --- |
| `host.providers.register` | akshare, ccxt, kurumi-replay, mt5, qmt | [akshare/index.js:3](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/akshare/index.js:3) |
| `host.providers.list` | canvas-control, data-access | [canvas-control/market-binding.js:4](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/market-binding.js:4) |
| `host.providers.bind` | canvas-control, data-access, kurumi-replay, manual-trading | [canvas-control/market-binding.js:30](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/market-binding.js:30) |
| `host.providers.call` | canvas-control, data-access, kurumi-replay | [canvas-control/market-binding.js:33](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/market-binding.js:33) |
| `host.providers.subscribe` | manual-trading | [manual-trading/runtime.js:392](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/runtime.js:392) |
| `host.providers.unbind` | canvas-control, data-access, kurumi-replay, manual-trading | [canvas-control/market-binding.js:42](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/market-binding.js:42) |
| `host.datasets.list` | data-access, judgment-evolution, manual-trading | [data-access/research-tools.js:11](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/research-tools.js:11) |
| `host.datasets.read` | data-access, factor-evaluator, financial-research, judgment-evolution, manual-trading, mt5, reports | [data-access/research-tools.js:12](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/research-tools.js:12) |
| `host.datasets.register` | abu-backtest-lab, abu-breakout, abu-exit-rules, abu-indicators, abu-ml-features, abu-model-lab, abu-moving-average, abu-parameter-search, abu-position-sizing, abu-price-structure 等 22 个（主要包含 ABU 生产 runtime） | [data-access/market-read.js:107](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/market-read.js:107) |
| `host.datasets.sources` | data-access | [data-access/tools.js:8](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/tools.js:8) |
| `host.datasets.query` | data-access | [data-access/tools.js:17](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/tools.js:17) |
| `host.datasets.snapshot` | data-access | [data-access/tools.js:21](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/tools.js:21) |
| `host.datasets.registerSource` | mt5, web-sources | [mt5/index.js:41](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/index.js:41) |
| `host.artifacts.blob` | auto-factor-mining, backtrader, canvas-control, data-access, kurumi-replay, manual-trading, mt5, reports, strategy-authoring, vnpy | [canvas-control/indicator.js:21](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/indicator.js:21) |
| `host.artifacts.publish` | auto-factor-mining, backtrader, canvas-control, data-access, kurumi-replay, manual-trading, mt5, reports, strategy-authoring, vnpy | [canvas-control/indicator.js:22](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/indicator.js:22) |
| `host.artifacts.read` | backtrader, canvas-control, kurumi-replay, memory, mt5, reports, strategy-authoring, vnpy | [canvas-control/indicator.js:20](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/indicator.js:20) |
| `host.artifacts.list` | memory, mt5, reports | [memory/compaction.js:60](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:60) |
| `host.artifacts.readBlob` | backtrader, data-access, memory, mt5, reports, strategy-authoring, vnpy | [data-access/market-read.js:106](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/market-read.js:106) |
| `host.artifacts.inspect` | kurumi-replay, reports | [reports/index.js:99](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/index.js:99) |
| `host.artifacts.receipts` | kurumi-replay, reports | [reports/index.js:96](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/index.js:96) |
| `host.records.create` | mt5 | [mt5/run-observer.js:125](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/run-observer.js:125) |
| `host.records.append` | mt5 | [mt5/run-observer.js:130](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/run-observer.js:130) |
| `host.records.read` | mt5, reports | [reports/index.js:131](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/index.js:131) |
| `host.records.list` | mt5 | [mt5/run-observer.js:17](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/run-observer.js:17) |
| `host.svl.validateSource` | strategy-authoring | [strategy-authoring/index.js:16](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/index.js:16) |
| `host.svl.graph` | reports, strategy-authoring | [reports/backtest-template.js:24](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/backtest-template.js:24) |
| `host.svl.evaluateReplay` | strategy-authoring | [strategy-authoring/index.js:98](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/index.js:98) |
| `host.storage.directory` | auto-factor-mining, backtrader, ccxt, judgment-evolution, kurumi-replay, manual-trading, mt5, portfolio-execution, qmt, strategy-authoring, vnpy, workspace | [workspace/tools.js:42](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/tools.js:42) |
| `host.storage.get` | auto-factor-mining, backtrader, ccxt, data-access, factor-evaluator, financial-research, kurumi-replay, manual-trading, memory, mt5 等 13 个（主要包含 ABU 生产 runtime） | [data-access/market-read.js:138](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/market-read.js:138) |
| `host.storage.list` | auto-factor-mining, financial-research, kurumi-replay, manual-trading, memory, mt5, portfolio-execution, strategy-authoring | [memory/compaction.js:184](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:184) |
| `host.storage.put` | auto-factor-mining, backtrader, ccxt, data-access, factor-evaluator, financial-research, kurumi-replay, manual-trading, memory, mt5 等 13 个（主要包含 ABU 生产 runtime） | [data-access/market-read.js:145](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/market-read.js:145) |
| `host.storage.update` | backtrader, mt5, strategy-authoring | [strategy-authoring/agent-decisions.js:86](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/lib/agent-decisions.js:86) |
| `host.storage.delete` | kurumi-replay, memory, mt5, portfolio-execution | [memory/compaction.js:250](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:250) |
| `host.storage.transaction` | auto-factor-mining, backtrader, kurumi-replay, mt5, portfolio-execution, strategy-authoring | [strategy-authoring/agent-decisions.js:135](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/lib/agent-decisions.js:135) |
| `host.storage.idempotent` | mt5, qmt | [qmt/configuration.js:17](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/qmt/configuration.js:17) |
| `host.storage.idempotentAsync` | data-access, mt5, plugin-manager, qmt, vnpy | [data-access/market-read.js:137](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/market-read.js:137) |
| `host.storage.legacy.get` | 无 | 三个范围内未找到调用/探测/模板引用 |
| `host.storage.legacy.list` | 无 | 同上 |
| `host.storage.legacy.path` | 无 | 同上 |

## 易误判项

- providers.subscribe 只发现 manual-trading 一个直接使用者，但 runtime.js:153/173/184/214 的启用、恢复和重试均会抵达 :392，不是死代码。
- reports/backtest-template.js:24 的 host.svl.graph 在 report_backtest_template 工具执行体内，reports/index.js:93 注册了它；这是生产模板生成工具，不是仅供复制的代码示例。
- kurumi-replay/weekly-reports.js:197 对 artifacts.receipts 做存在性探测，紧接 :198 就真实读取回执；不能只记为探测。manual-trading/memory.js:103 的 datasets.read 检查也有后续真实调用。
- MT5 backend/service.js:22、official.js:49 把 host.storage 存入 this.storage；deployments.js:43、market.js:26、tester.js:95 沿 mt5.storage 继续转发。因此 storage.update/delete/idempotent 的 MT5 使用不能漏掉。
- datasets/artifacts/storage 被 tools/evidence.js:6–7 包装为窄 host 对象再传入后端；后端同名 host 字段仍是本体端口。
- 外层 E:/brief2great/sesame/plugins/optional-api-v1/packages 的 7 个开发目录当前无任何文件；它们没有额外调用，不计为 7 个已实现插件。

## 确定重复的入口：SVL

| 同一函数 | host 门面真实调用 | SDK import 真实调用（MT5） |
| --- | --- | --- |
| validateSource | [strategy-authoring/index.js:16](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/index.js:16) | [parameters.js:48](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/parameters.js:48)、[target.js:46](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/target.js:46) |
| graph | [reports/backtest-template.js:24](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/backtest-template.js:24) | [svl-capabilities.js:31](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/svl-capabilities.js:31)、[target.js:83](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/target.js:83) |
| evaluateReplay | [strategy-authoring/index.js:98](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/index.js:98) | [parameters.js:73](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/parameters.js:73)、[conformance.js:77](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/conformance.js:77) |

证据：[context.js:11](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:11) 直接导入这三个函数，[sdk-loader.js:7](E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js:7) 把 @sesame/plugin-sdk/svl 映射到同一 modules/plugins/svl.js。它们是同一实现的两种公开入口，非两个引擎。建议以纯 SDK import 为规范入口，把 host.svl 标为兼容入口并迁移，而非让所有插件继续任选。

## 合并与职责建议（判断，不是现行接口）

| 项目 | 建议 | 依据与边界 |
| --- | --- | --- |
| storage.legacy.* | 从新插件能力清单移除；若仍需迁移旧安装则留内部兼容桥，确认历史安装迁移完再删除实现 | 当前 55 包及 7 开发目录无生产使用、无 migration 清单声明；不把迁移读旧库权作为新插件常规能力。 |
| host.svl 与 SDK/svl | 统一成 SDK 纯函数入口；host 只保留兼容别名 | 相同实现；无用户状态、持久化、权限、调度需求。SVL算法宜在可版本化 SDK/语言库，策略设计和回放工作流在插件。宿主仍可调用共享校验器来保护公开成果契约。 |
| datasets.register/read/list 与 artifacts(kind=data) | 优先统一数据身份与底层持久化，让 datasets 成为查询/预览/冻结便利层或兼容适配 | [data-access/market-read.js:103–107](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/market-read.js:103) 已把同一批 rows 发布为 data Artifact，再登记 Dataset 并用 dataRef 关联，存在两套ID/登记。query/snapshot 的会话缓存语义不要硬塞进 artifact.publish。 |
| datasets.registerSource/query 与 providers | 可以共用注册/生命周期基础设施；不应把业务输入混成同一个任意 method 字符串协议 | MT5同时注册 typed market provider 和 bars dataset源（[mt5/index.js:39](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/index.js:39)、:41）；web-sources还是一般HTTP/CSV来源，不等于market/account。 |
| records 与 artifacts | 不合成同一种对象；可把泛称 records 明确为 strategyRuns，或把策略特定校验从通用存储机制分层 | Artifact 是不可变内容修订；record 是带 CAS、状态机和有效期的事件投影。当前仅支持 strategy.run，create/append/list直接用户仅MT5，read另有reports。 |
| strategy.run 的业务策略语义 | native实例识别、券商状态映射、运行模式判断、授权来源等留执行插件；宿主保留身份、CAS、固定证据、有效期、运行生命期和停用保护 | [run-observer.js:95](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/run-observer.js:95) 构造MT5运行定义并写事件；本体 [artifacts.js:116](E:/brief2great/sesame/mt5agent/modules/plugins/artifacts.js:116) 当前已写死strategy.run/source/translation/account语义，适合分成领域契约层与通用存储层。 |
| artifacts.inspect/receipts | 可在命名上归入报告检查能力，但不要因仅两个插件调用而移除宿主检查 | inspect 生成宿主浏览器验证证据；插件不能自签宿主回执，receipts 是已发生用户呈现事实的读取。 |

records 不能按“只有 MT5 写”直接删：本体 [plugin-registry.js:210](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:210) 用 activeRuns 阻止带持久运行插件被更换；[account-strategies.js:229](E:/brief2great/sesame/mt5agent/modules/agent/account-strategies.js:229) 消费运行记录；[plugins/http.js:22](E:/brief2great/sesame/mt5agent/modules/plugins/http.js:22) 提供运行读取；前端监听 strategy.run。

本次只做源码核对，没有修改插件或本体实现。
