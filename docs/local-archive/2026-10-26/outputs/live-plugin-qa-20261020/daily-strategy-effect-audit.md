# W1 策略设计效果：单次只读核验

W1 的固定输入 SVL、扩展函数、原生编译、有效历史段 Tester 和历史模型 `halt` 决策都有实际结果；**完整原生等价性、工作流、Backtrader/vnpy 执行及因子评估未通过或未验证**。此结论独立于尚在写作的报告，也不以外层工具完成或 Run completed 代替设计效果。

对象为 `run_8bb61145-74fb-4a2b-a075-0963ef0ab5c0`、会话 `conv_066773c0-bac9-49ec-ae2b-bba1dfd3a1b6`。工具取证窗口截至 **2026-10-20 15:52:00 UTC**，不继续跟随工作流。逐调用 ID、引用、摘要和文件哈希保存在 [daily-strategy-effect-audit.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-strategy-effect-audit.json)。

| 项目 | 结论 | 已执行效果与边界 |
| --- | --- | --- |
| QA 扩展函数 | pass | `qa20261020/threshold` 1.0.0 的 ID/version/digest 与源中内嵌模块、图中的模块一致；`qa20261020/threshold/above` 实际函数体 trace 共 117 次，callPath 指向调用节点 `above`。 |
| validate → publish → graph | pass（后端） | 15:08:31 校验无 diagnostics，15:08:41 发布固定 strategy.source，15:09:16 图及两组回放保持同 sourceDigest；图请求使用已发布的完整固定引用。图有 5 个节点、2 条边。没有实际打开节点图，本项不涵盖 Netron 风格布局/UI。 |
| 独立 strategy_execute | 未验证 | 本会话没有该工具调用；不能用 replay 代替该入口的覆盖。 |
| 固定输入 SVL 回放 | pass | gold 114 输入/114 committed，函数体 114 次；controls 7 输入/6 committed，重复事件忽略 1、函数体 3 次。两组输出与回执完全一致，逐项符合已保存 expected，均为 0 intents。空数据、形成中柱、缺数据保留状态；阈值相等为 false。`nativeEngineExecuted=false`。 |
| MT5 翻译/编译 | pass（原生编译） | 15:30:13 翻译绑定上述固定 source；15:30:33 native compile succeeded，SDK 1.3.1，保存 EX5 哈希和源映射，进程清理 confirmed。实现仍为 `translated_unverified`、`live_capable=false`，编译不能证明 SVL/MQL5 等价。 |
| Tester：2026-10-12 至 10-17 | partial | 同一 build 的 Tester 返回 succeeded，但已保存原生审计显示 **0 bars / 0 ticks**；不能算有效历史样本或策略效果。 |
| Tester：2025-10-13 至 10-18 | pass（限定历史段） | 同一 build 最终 succeeded，MT5 6230 / SDK 1.3.1，M1 OHLC；已保存审计为 **115 bars / 27,269 ticks**，结果冻结为 strategy.result。测试输入禁用 live，成交数为 0，不证明盈利或可交易。 |
| 原生 trace 抽检 | partial | 只读取得 9 个分片中的 2 个，独立确认 10,000 + 7,200 行、序号 `[1,10000]` 和 `[80001,87200]`、一致 build。Agent 已保存审计检查 21 个完整 decision（true 9、false 12）、0 mismatch；该摘要与回执一致。本审计未重新计算策略，未验证其余 7 片、全部原生轨迹或 SVL/native 数值等价性。 |
| 模型决策与 timeline | pass（历史 halt） | 15:34:10 状态回执包含一次真实模型 attempt 和 usage，共 3,819 tokens，决策/output 均为 `halt`，固定 program/input digest 与提交一致。15:34:21 timeline 复用保存结果，`modelInvocations=0`。该子会话窗口内无 bridge 工具调用；不扩展为全账户审计。 |
| strategy_pipeline | pass（固定输入 noop） | 15:33:50 输出 `fixed-input-pipeline-evaluation`、plan=noop、0 intents、`nativeEngineExecuted=false`。 |
| strategy_workflow | blocked | 15:33:50 明确拒绝：`Required execution capability netPosition is unsupported or its software implementation was not selected`。不算工作流端到端通过，本次没有改配置或追加重试。 |
| Backtrader | blocked | 先前正式环境探测的配置 Python 路径不存在（ENOENT）；替代 Python 的实际导入返回 `ModuleNotFoundError: No module named 'backtrader'`。本 W1 接续没有再跑环境或回测，不泛称 MT5/终端离线。 |
| vnpy | blocked | 主 WAL 中环境 Run `run_ec57be0b-fff8-4f6f-a2b6-b71abaa3dd84` 虽 completed，实际 output `ready=false`：Python311 两包缺失；Anaconda 为 vnpy 4.1.0 / vnpy_ctastrategy 1.3.3，不满足 4.5.0 / 1.4.1。不是原生回测成功。 |
| QuantSkills 目录/筛选/推荐 | pass（目录设计） | 真实目录 214 项、10 分类；按“07 研究验证与质量工具”及 limit=10 筛出 10 个该分类条目；`strategy-research` 推荐实际返回工作流、后端选择及 4 个参考。`availability=not_checked`、参考为 pending_review，未导入或执行外部项目，不宣称交易质量。 |
| 因子评估 | 未验证 | 窗口内 factor 工具调用 0。准备/登记面板只算前置，不算因子运行。第三方数据来源与公开路径由另一审计负责，本次没有重复调查。 |

固定源的 sourceDigest 为 `sha256:ab7024faf1ac3d24a5f6efe54d8a3586277c64e243a4cfd8c4580635d8a407c6`；发布引用为 `artifact_99a604ab-7b2d-49e6-9934-440b49b68d6b / revision_1da9e735-d491-4b75-b581-b871a57d17cc`。MT5 build 为 `build_5b24802b-6b3b-4503-a484-122c810d1606`，EX5 摘要 `sha256:d0c5855294021711c0b84345e457c05bf13aaa50afe64a68ec3985a7d1fb918a`。两 Tester 只改变日期区间，保持 build、H1、model=1 和阈值参数 4160。

后端图生成不证明前端已展示。本轮可达性缺口已经单独记录于 [svl-entry-effect-audit.md](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/svl-entry-effect-audit.md)，本切片不重复修复或挂载策略。

取证使用主 WAL readOnly/query_only、精确 W1 JSONL 与既有 QA 文件。未打开子 SQLite，未执行策略/审计计算脚本，未调用业务或模型 API，未改产品、配置或业务文件。独立脚本仅统计已有结果、比较固定引用/期望状态和文件哈希。没有继续重试阻碍，也不等待最终报告才交付。

后续交付观察（root 提供，超出上述工具窗口）：策略报告 v1 于 15:57:28 UTC 正式 published，但实际打开时整页显示 `SesameBacktest: Do not mix training and holdout rows in a selection matrix; use one frozen comparison cohort`，没有 h1。[v1 真实 UI 截图](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-strategy-ui-observed.png)保留为历史失败。

**当前状态已修复并通过 v2 实际 UI 验收**：真实 Agent 自行修正，16:00:47 发布 v2，16:00:58 检查为 rendered、diagnostics=[]；root 于 16:03 实际打开通过，见 [v2 观察](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-strategy-v2-2026-10-20T16-03-10.432Z.json) 和 [截图](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-strategy-v2-2026-10-20T16-03-10.432Z.png)。[报告内 SVL 图观察](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-svl-report-graph.json) 又证实 5 节点可点击定义、函数可展开为 `test:compare.gt`；它补足报告内交互图证据，不代表独立策略入口、所有主题及窄屏都验收。检查器结果见 [strategy-report-render-audit.md](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/strategy-report-render-audit.md)，没有依据称检查器漏报。本审计没有操作页面或替 Agent 修改报告。16:04:43 的 `RUN_RELEASE_FAILED` 为独立收尾问题，由另一审计核查，不能据此宣称已发布报告丢失。
