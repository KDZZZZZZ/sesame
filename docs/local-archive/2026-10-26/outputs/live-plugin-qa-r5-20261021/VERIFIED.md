# R5 独立只读证据核验

核验对象是截至 **2026-10-21T08:33:58.549Z** 已冻结的 R5 证据。结论：真实模型、固定数据引用、评价与原生报告归档链路成立；**原报告的视觉验收未通过**。本次只读 JSON、脚本及已下载文件，在内存中重新比较与计算摘要；未访问应用、网络、任何数据库或模型，未修改 Agent 业务产物。仅新增本文件，不更新插件矩阵。

| 验证项 | 结果及边界 |
| --- | --- |
| 真实模型任务 | 3 个 `host.agent.run` 均 completed；模型、阶段、会话、完整输出文本与已发布 `run.json` 逐一一致 |
| 真实 evaluator 动作 | `prepare / candidate / select / finalize` 共 4 个 completed Run；回执与归档一致 |
| 输入来源 | 12 次真实 `sources_fetch` 的 48 个价格与抓取时刻，逐行匹配已发布 `dataset.json` |
| 固定引用与摘要 | 同一完整 inputRef 贯穿注册、manifest、prepare、配置、数据归档、报告依赖；两个输入 manifest 和报告 manifest 的 SHA-256 重算一致 |
| 原生报告 | 同一工作流原生发布、同一 ArtifactRef、1 个主报告库条目；4 个 blob 的字节数、SHA-256、bundle 内容与下载文件一致 |
| 页面加载 | 已保存的 UI 检查为无 pageerror、无横向溢出；只证明加载情况 |
| 视觉验收 | **失败：首屏可见文字 6302 units，超过 3000 上限**；`inspectionPassed=false`、`overallReportAcceptance=false` |
| 空闲与历史保留 | 截止时主会话 idle、active=null、pending=0；本轮 27 个 Run 全部 completed。冻结主库比较记录确认旧 Run、旧主会话消息及暂停关联未变，14 个旧暂停 Run 保留 |

依据：[progress.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/progress.json)、[factor-receipts.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/factor-receipts.json)、[panel-verified.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/panel-verified.json)、[report-verified.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/report-verified.json)。

三个模型任务使用 `openai / gpt-6.1-sol`，共同模型配置摘要为 `sha256:7d8a463df46283bf926cb1b7bdaa75754b08e61546163f271522c4c431feed49`。每个实际 Run.output 都记录了成功返回的 `auto_factor_context` 与 `auto_factor_submit`，不是仅提交说明文字。

| 阶段 | 实际 host.agent.run | 模型 turns |
| --- | --- | --- |
| hypothesis | `run_ba4aed37-29f6-443f-b988-e78fe79f9145` | 3 |
| code | `run_1db0c30c-87ce-4d31-868c-584a2f609039` | 3 |
| selection | `run_5653ea47-4523-4e22-b394-0ee12b8dce8f` | 4 |

这 3 个任务均为 `quant`，本次配置是 1 轮、1 个候选，`plan/review/reflection=null`。它覆盖了三个真实任务阶段，**没有证明多角色复核、多轮搜索或多个候选间相关性筛选**。

| evaluator action | 实际 Run | 与归档比较的位置 |
| --- | --- | --- |
| prepare | `run_870f9590-9d71-42c0-ba6c-d026807b1934` | `evaluation`，另核对 development 行 |
| candidate | `run_b23c0fc3-eb68-4e44-b00f-d9a1fd1655f9` | `trials[0].evaluationReceipt` |
| select | `run_e87d7f07-dce3-4c60-8ee3-c9869f5cbaac` | `selection.evaluation` |
| finalize | `run_819c03d0-6f92-4190-9514-7670ed9b63b8` | `finalEvaluation`，排除仅在实际回执中的 archive 字段 |

4 个动作共用业务 Run `fm_1f92dfb506dff8474920e5ff02a508cf` 和 evaluator session `fe_53cee6c8cf9938f52c9d46341636f93e`。实际 `select.selectionDigest` 与归档冻结选择及 `finalize.selectionDigest` 一致；finalize 的 holdout 与归档一致。评价器描述符版本为 `sesame/factor-evaluator 1.0.2`，原生报告生产者为 `sesame/auto-factor-mining 1.1.2`。

固定 inputRef 的完整身份如下。其 Artifact manifest 摘要与 evaluator 的数据计算摘要是不同对象，不能混为一个摘要。

```json
{
  "id": "artifact_41c6e8fa-dd3d-43b6-a81c-fd5d58897a5e",
  "revision": "revision_df616f52-59fc-44f7-b39e-dfef813c5ff5",
  "digest": "sha256:22715299d8f054325601533dfb6c09c05eafdf29ee9ebf1dc95a136fd519ef24",
  "kind": "data",
  "schemaVersion": "1.0.0"
}
```

独立比较确认：`research_register` 的已发布回执、`host_resources_read(part=manifest)`、工作流 evaluator.arguments、prepare.data.inputRefs、归档 dataset.evaluator、report manifest 的 `content.data / dependencies / provenance.references` 使用同一完整引用。输入 manifest 指向固定证据资源 `artifact_6d4f4afd-264c-4fa3-b088-bea613109e7a / revision_1a48534d-4e96-40c2-ab24-3d24eec94ab8`；其 12 个完整依赖引用与实际来源 Run.output.ref 全部一致。prepare 的 `inputDigest`、归档 `dataDigest` 与 panel 核验记录均为 `sha256:6f421bf3da5a53f018241c22e75f400f85309b605d1449689d2feaa654519ca2`。

48 行由 12 个抓取时刻乘以 BTCUSDT、ETHUSDT、SOLUSDT、XRPUSDT 组成，范围为 UTC `08:02:53.754` 至 `08:08:51.552`。本次重新建立实际来源 Run.output 的 `(as_of, symbol) → price` 映射，确认 48 个键均唯一且与归档逐项相等；每行 `time=availableAt=as_of`，唯一数值字段 `close` 有限。数据切分为 train 24 / validation 12 / holdout 12；prepare 实际返回的 36 行 development 与归档前两段相同，`holdoutSealed=true`，不含后 12 行。

来源是 **`https://api.binance.com/api/v3/ticker/price` 的 latest price 接口，不是 24 小时 ticker 接口**。这些是不等间隔的 HTTP 观察，不是历史 K 线、固定分钟收益或可执行报价。`horizon=1` 指下一次观察；抓取时刻不证明交易所价格新鲜度、同时成交或历史首次可得时刻。先前取得的 OKX 小时柱未进入这 48 行面板。

[panel-verified.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/panel-verified.json) 另记录 12 个来源引用及原始字节 hash 元数据与 inventory 相符、panel 原字节摘要相符；已只读检查 [verify-panel.mjs](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/verify-panel.mjs) 的对应断言。本次独立核验的是冻结来源输出、完整引用、manifest 与报告 blob，**未读取原始 HTTP 字节流，也未重新读取活跃工作区中的 inventory/panel 文件**。不把 JSON 重序列化当作原 HTTP 字节 hash 验证。

唯一候选 `trial_r0_7a7b7317c5f8` 的真实 eligible/accepted 表示通过本次冻结门槛，不能写成可交易或盈利。实际训练、验证、留出净收益分别为 `-0.0077941721257668295`、`-0.001821522160301181`、`-0.0039837604307270125`；留出 Rank IC 为 `0`。只有一个候选，`redundancy=[]` 不证明低相关或分散化。留出在冻结选择后由 evaluator finalize 评价，归档为 `holdoutStatus=evaluated`；未打开真实子会话上下文，运行时完整隔离仍只可结合已有离线合同测试判断。

原生工作流 `run_4cf02187-73fd-4e75-96e2-a602cbb80db8` 的实际 output.report 与已下载 bundle、报告检查记录指向同一个报告：

```json
{
  "id": "artifact_d4a01c03-47ce-4778-962e-b132531729de",
  "revision": "revision_3b7cfcd2-f47a-4c96-8408-9e86e25edad8",
  "digest": "sha256:b43f5ea71021e8848cb79c95fb9eaf16ec9cc70857bedc58316bab0ce2ba86d2",
  "kind": "report",
  "schemaVersion": "1.0.0"
}
```

实际发布回执 actor 为 `sesame/auto-factor-mining`，状态 `published`，时间 `2026-10-21T08:21:06.355Z`。报告库条目为 `report_file_074b4e14-25b7-42dc-80cc-b59ed62d9285`，绑定 `rep_71d89ffb-7183-44b6-9447-2eb303291ea1`，路径 `自动因子挖掘/fm_1f92dfb506dff8474920e5ff02a508cf-attempt-1.html`，`primary=true`、`publishedRevision=1`。已只读检查 [verify-report.mjs](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/verify-report.mjs)：保存 report-verified.json 前，对匹配该 reportId 的库条目执行了数量等于 1 的断言，UI 对同一路径也断言恰好 1 项。这里的唯一性是本次报告，不是全库只有一份报告。

独立重算 [bundle.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/report-disclosure/published-v1/bundle.json) 的规范化 manifest 摘要，并逐个比较其 base64、blob 元数据与下载文件，以下 4 项全相符：

| 文件 | 字节数 | SHA-256 |
| --- | --- | --- |
| [run.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/report-disclosure/published-v1/run.json) | 77586 | `42133a96279b16d3a8367f371145c78f9aac41583916d97e05eb6196e57a648a` |
| [dataset.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/report-disclosure/published-v1/dataset.json) | 7434 | `b97ea26378a6a782651c518856627cad9ff45e687275a7cb3ecd689e2a006984` |
| [factors.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/report-disclosure/published-v1/factors.json) | 21778 | `ce935f7273601dc3ee728d666bd6586d369beb075c71d39a1217079153813506` |
| [report.html](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/report-disclosure/published-v1/report.html) | 168579 | `5fa3f4cea49c20fe4ee66ea56a4b98d1fe00b8384e5604bf733e99d3f8cc7be8` |

报告 UI 保存的 `viewport=658 / width=650`、`noOverflow=true`、`errors=[]`，不消除 inspector 的失败。原始检查 `inspection_3ac1463e-bbc4-4697-82ae-0fbea47348b8` 对 1000 和 390 宽度各检查 2 次交互，诊断在 1000 宽度指出首屏文字 `6302 > 3000`，建议目标 1500。本证据中的原报告没有通过视觉验收；随后任何渲染器修复或新报告都应另列证据，不能反向改写本次结果。

[baseline.json](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/baseline.json) 保存 317 个旧 Run、178 条旧主会话消息、14 个暂停关联对象的内容 hash，以及 14 个互不重复的旧暂停 Run ID。这 14 个 ID 全部包含在旧 Run 基线中，未出现在本轮 27 个新 Run 列表。已只读检查 [progress.mjs](E:/brief2great/sesame/outputs/live-plugin-qa-r5-20261021/progress.mjs)：其 `unchanged` 比较会按 kind/id 查询并重算存储 body 的 SHA-256；冻结 progress.json 三项比较均 true，故保留声明有实际 hash 比较依据。本次审查未重新访问数据库，也没有后置完整原始快照可在离线再次计算全部 body hash；结论限定到该冻结时间，不推断之后状态。

仍未通过或未覆盖的项目：

- **原报告首屏信息密度验收失败**：需要后续修复后的正式 inspector 与 UI 回归证据；本 R5 不标全通过。证据为 report-verified.json 和 published-v1 原文件。
- **本次报告的 PDF/PNG 实际导出、所有附件逐一点击交互**：上述限定证据只证明 blob 完整和页面加载，不能借用 R3 的导出通过结果覆盖 R5。
- **真实子会话的完整权限/留出隔离观察**：已证明 prepare 输出无留出行、实际工具摘要仅 context/submit，但未打开 child DB 或真实 restricted context；不能声称已完成逐条动态隔离审计。
- **更复杂研究与经济有效性**：单角色、单轮、单候选的极短观察样本，没有覆盖多角色复核、多轮优化、候选冗余比较或可交易性；本次工程链路通过不代表这些能力通过。

以上未重跑业务、未修补研究内容、未恢复历史暂停任务。R6 及其他后续验收由主线程另行记录。
