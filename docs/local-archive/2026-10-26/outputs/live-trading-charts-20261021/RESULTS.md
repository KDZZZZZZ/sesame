# 交易与图表续测记录

本轮使用现有 Sesame、真实 `openai/gpt-6.1-sol`、原工作区和 FTMO 模拟账户。交易由应用内 Agent 经公开插件接口执行；根助手负责界面测试、回执复核和修复，不代替 Agent 调用交易 SDK。整体结论仍是部分验收。

当前已安装 MT5 **2.1.10**、portfolio-execution **2.0.5**，见[安装及数据保留核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/status-release/installation/verified.json)。更新前已在线备份主数据库。旧 14 个暂停关联、模型配置及其他插件保持，未打开 child runtime 数据库，未重启应用。

## 已确认的实际效果

- 上一轮 EURUSD 0.01 手的开仓、修改 SL/TP、平仓及退出成交核验继续有效，见[真实闭环](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/live-trade-cycle/verified.json)。
- 本轮 USDJPY 挂单 `REDACTED_IDENTIFIER` 创建、修改价格与 SL/TP、撤单，原生历史为 CANCELED，当前订单和持仓为空；四种绘图的 Agent 回读与 UI 保存代码、几何及不可变引用相同。见[独立核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/pending-python/verified.json)。
- 整数价格回归订单 `REDACTED_IDENTIFIER` 以 157 / SL156 / TP159 创建，改为 156 / SL155 / TP158，随后撤销；不再用小数绕过 SDK 整数类型问题。见[原生回执逐项核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/workflow-execution/verified.json)。
- 实际切换 1h→5m→1d→1h、收起/展开，核验原生流的时间间隔、排序和唯一标识，观察到旧客户端订阅取消。蜡烛、OHLC、折线、面积及成交量/均线/对数开关通过，并恢复原设置。见[图表控件核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/charts/verified-controls.json)。
- 四种绘图（趋势线、水平线、矩形、斐波那契）完成创建、拖动、端点调整、样式/代码保存及重载保留。Agent 能读取完整代码及引用。只通过 UI 删除本轮 4 个测试绘图，原 10 个脚本和旧绘图绑定保留。见[清理核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/charts/reload-cleanup-v2.json)。
- 在线隐藏 75 秒后展开，第一帧就绪 77ms、可见空白帧 0。此结论限于在线前端缓存，不代表终端离线冷启通过。
- 黄金历史扩展的实际指标沙箱输入从 685→1023→1364→1704 根已闭合 K 线，SMA20 输出从 666→1004→1345→1685 点。独立 Python Decimal 对 **4,700 次输出、1,685 个唯一点**逐点复算一致，共享历史值不漂移。见[数值核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/charts/indicator-history/decimal-verified.json)。
- 最终 MT5 2.1.10 下三张图实际显示 346 / 686 / 721 根，均为 live；原脚本保留。见[最终显示核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/charts/final-verified.json)及[截图](E:/brief2great/sesame/outputs/live-trading-charts-20261021/charts/final-diagnostic.png)。

## 修复及版本

| 本地提交 | 改动 | 验证 |
| --- | --- | --- |
| `95a2380` | 原生预检拒绝保留真实 order_check 和即时 last_error | Python 守卫、dispatch、position 定向验证 |
| `a394a11` | 仅把原生 double 请求字段中的可精确表示整数转为 float，票据和枚举保持整数 | 47 项 Python 定向回归；真实整数挂改撤通过 |
| `319325c` | 明确 guarded cancellation 的精确两字段请求，错误消息指向正确用法 | 34 项守卫、8 项目录测试；守卫条件不变 |
| `c0564e1` | 活动订单优先读当前证据；缺失才查历史；保留历史终态 | 44 项定向 + 61 项相关回归，父线程重跑 44 项通过 |
| `00f9985` / `0e9362a` | 小版本及安装包校验 | MT5 2.1.9 整数回归、最终 2.1.10 / portfolio 2.0.5 数据保留核验 |

修复均为本地提交，未推送。完整小 diff、测试日志及安装前文件保存在本目录。

## 新版状态刷新验收

**真实验收与独立核验通过：** 新挂单 `REDACTED_IDENTIFIER` 在活动期间读回 PLACED / 0.01 手；按新版工具目录首次精确 guarded 撤单成功；原创建操作刷新后保留 CANCELED 历史终态及原始下单回执。最终原生 USDJPY 挂单、持仓均为空。13 个文件已冻结，Agent 保存的活动/历史完整状态与实际工具返回逐字段一致，见[最终核验](E:/brief2great/sesame/outputs/live-trading-charts-20261021/pending-status-acceptance/verified.json)。热更新后的首次只读调用返回 `No IPC connection`，Agent 调用公开 prepare 完成初始化后，同一旧操作刷新成功。

最后全局 8 类活动计数均零；839 条已有记录、368 个旧 Run、210 条旧主消息以及 14 个暂停关联均与本批次基线逐条 hash 相同。应用保持打开，不恢复历史暂停任务。活动状态查询耗时 7,269ms、取消工具往返 2,963ms、历史状态查询 8,871ms；这些是工具层耗时，不是单独的原生 send 耗时。

最初 QA 提示要求固定备注，但快捷入口只接受自动唯一备注；这是测试约束与接口不一致，根助手已明确接受自动备注后续测，没有为此新增参数。发送更正时活动会话需要选择“加入队列”；首次脚本只打开菜单、未发出消息，保留原草稿后正常排队一次，未重复提交交易。

## 未解决、受阻及未覆盖

- Terminal MCP 挂单入口实际拒绝 `trading is not permitted`，随后原生权限回执为 true；没有足够证据归因具体权限映射。本轮保留拒绝，不用不确定结果重复报单。见[pending-orders 冻结证据](E:/brief2great/sesame/outputs/live-trading-charts-20261021/pending-orders/frozen.json)。
- 真实 manager→executor 开仓再归零工作流在 manager 阶段因缺少适用的已确认风险规则阻断。未产生 executor 交易；只停止本轮新任务并暂停新计划。不能将空仓上的零目标称作平仓通过。
- manager 的 Terminal MCP 合约摘要确实返回 tick_size/tick_value=0，而准备阶段 Python 完整规格非零。原始来源不一致及只读完整规格能力缺口保留，未改写原始值。见[逐字段诊断](E:/brief2great/sesame/outputs/live-trading-charts-20261021/workflow-execution/contract-source-gap.md)。
- 原生 SDK `history_deals_get(ticket=order)` 在此环境仍返回 -2 Invalid params。已验证的状态恢复使用订单中的真实 position_id；不会把原生失败当空成交。
- 插件更新后的 BTC 图表就绪观察两次超过 35 秒阈值；随后快照及像素显示正常 live。恢复耗时尚未定位和修复。首次主图观察还存在测试脚本在 SOURCE_CHANGED 到达前只检查一次重连按钮的问题，已区分记录。
- 终端离线冷启、原生轮询是否降至零、全部指标/全部周期、真实部分成交、工作流 executor 目标归零、策略挂载尚未通过本轮实际验收。
- Agent 曾在交易已完成后额外运行哈希归档脚本，因 Get-FileHash 不可用失败；它自行停止新归档任务。此效率问题保留，不归因于交易失败。
- 最新一轮挂单在 12:01:42 UTC 已收到撤单回执，历史状态在 12:02:05 读回；12:08:39 才保存最终摘要。归档依赖多轮模型转录明显延长验收，不应与原生交易耗时混同；本轮未改动归档接口。

工作流期间一个旧报告目录的版本和修改时间因新报告写入发生变化，严格冻结首次因此拒绝；已与更新前数据库逐字段对照，仅该目录元数据变化，旧报告文件、消息、Run 和暂停关联的 hash 不变，见[保留审计](E:/brief2great/sesame/outputs/live-trading-charts-20261021/workflow-execution/retention-audit.json)。
