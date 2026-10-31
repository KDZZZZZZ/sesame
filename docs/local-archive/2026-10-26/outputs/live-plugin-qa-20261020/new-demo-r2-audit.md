# 新模拟账户续测 R2

用户已连接新模拟账户并要求继续测试。沿用现有工作区、真实 `openai/gpt-6.1-sol` 和已安装插件，业务操作均由 Sesame Agent 通过普通聊天入口执行。本文记录新增结果，不替代前一阶段的 26 插件汇总，也不把旧覆盖数当成本轮通过数。

**R2 本轮于 2026-10-21 05:21 UTC 收尾。** 新账户读取、真实只读交易评审、限定团队复核、仅展示重排及最终报告 v4 已核验；实际交易、判断登记后闭环等仍未通过。主 Agent 空闲，新版和最新报告保持打开。下文按时间记录过程，早期“待核验”以末节的最终状态为准。

## 已交叉核验的新增结果

| 项目 | 真实结果 | 验收边界 |
| --- | --- | --- |
| 新账户配置 | 正式配置入口将旧尾号 0893 的绑定同步到终端当前尾号 4344，配置版本升至 8；旧账户密码按插件规则清除。终端和 Python 均读回同一模拟账户。 | 未读取或补填密码，未切换终端登录、重启终端或修改交易开关。最初受限还包含 QA 提示词过度约束，已明确纠正。 |
| Python 连接 | 原 `No IPC` 在一次正式 initialize 后恢复；原始回执的模块版本为 `5.0.6231`。 | 连接成功不等于终端允许交易。账户 `trade_allowed=true/trade_expert=true`；终端 `trade_allowed=false/tradeapi_disabled=false`。 |
| 原生市价与挂单 | EURUSD 0.01 手市价买入、远价 buy_limit 各实际提交一次，均收到原生 `trading is not permitted`，没有订单/成交票据。 | 外层工具返回成功不算交易成功；内层 `isError=true`，命令状态 `failed`。没有后续改撤/平仓票据，不重放被拒意图。 |
| 组合账户快照 | 新绑定读到空持仓、空挂单及查询范围内空成交。 | 历史覆盖未证明完整。`manual_trade_observe` 被 STALE_QUOTE 拒绝，未产生观察 ID，未执行目标仓位。 |
| 真实只读交易评审 | 2026-10-21 03:23:48–03:27:45 UTC，一个工作流、两个真实模型角色完成；检查角色调用 `trading_decision_check`，经理调用 `trading_decision_decide`。两角色合计 9 次工具调用，无交易/apply；冻结结果为 `decision_only`。 | 仅此 `execute:false` 分支通过；不代表有执行器、成交或策略挂载。新 QA 计划已暂停且无周期/事件调度。 |
| 旧暂停任务 | R2 开始保存了 14 个 interrupted Run 的完整 body SHA256；05:20 UTC 最终复核 14 个均未变化。 | 只保护既有暂停记录；本轮新产生的失败回执按事实保留，不将其抹去。 |

六项评审交叉核验见 [主库和原始工具回执审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/resume-demo-receipt-audit.json)。只读取主 app.sqlite 的 WAL 快照、主会话公开工具回执和已冻结文件，没有打开子任务 runtime.sqlite 或读取私有推理。

## 报价时间异常

一次真实取样得到 Python `time=1792564624`、`time_msc=1792564624959`。直接按 Unix 毫秒解释是 **2026-10-21 06:37:04.959 UTC**，宿主 UTC 的取样前后界限为 **03:36:53.148–03:37:27.594**。源时间比这两个界限均晚，差值为 **10,777,365–10,811,811 ms**，约 3 小时。终端同品种原始 `update_time` 是没有偏移量的 `2026-10-21T06:37:04`。

这证明当前 Python 时间字段与宿主 UTC 不一致，不能单凭这些值确定是哪端时钟/时间口径的问题。没有修改时钟、回拨时间戳或放宽新鲜度校验，也没有据此重试交易。完整原始文件摘要及计算见 [时间审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/resume-demo-time-audit.json)。源码中 `portfolio-execution/adapters.js` 直接使用 `tick.time_msc`，`service.js` 与 MT5 `execution_guard.py` 均要求其落在宿主 UTC 新鲜窗口；本次保留为未解决的时间口径阻碍。

## QA 过程归因与剩余工作

- 根助手最初把“数字 trade_mode=0”和“不改账户绑定”作为额外测试限制，导致已连接的新模拟账户先被阻断。后续明确接受原生 `account.type=demo`，通过正式配置同步绑定；该耽搁不算产品故障。取消的旧排队补充未被消费，仅保留最终更正。
- 根助手原生窗口检查的 Node runtime 两次初始化报 `failed to write kernel assets`，重置一次仍失败，因此没有执行原生窗口输入；不能声称已检查或切换了 MT5 工具栏开关。根助手代码审计子代理也因其指定模型不被账户支持而未运行。这两项属于 QA 工具环境，不归因于 Sesame 插件或已完成的真实模型评审。
- 03:29 UTC 全账户读回为 0 持仓、0 挂单；正式管理的部署列表为空。两个已有 QA 候选均 `live_capable=false`，未挂载。空管理列表不能证明不存在外部 EA。
- 交易报告已在同一路径发布 v6；03:52 UTC 实际 UI 确认统一主题、7 个真实附件绑定、没有 pageErrors 或全页横向溢出。源与发布内容一致。证据见 `r2-trading-report-ui-summary.json`。本轮没有重新导出 PDF/PNG，不扩大前轮导出的验收范围。
- 团队综合经独立普通聊天请求补测，最终于04:41:30 UTC完成；真实两成员、一次QA及综合通过。首次同名空报告预留经公开入口移入可恢复回收站，恢复暴露的宿主绑定缺陷经修复后不再复现。判断的回复全文审计有实际证据，但登记、到期核验和规则演进仍未通过，不能把团队通过替代判断闭环。

## 同版本账户配置变更后图表滞留的修复

03:44 UTC 真实 UI 中 US100 与黄金均为 `ACCOUNT_MISMATCH`、0 根 K 线，BTC 为 721 根 live。账户配置已正确同步，但两个 MT5 图表仍复用旧账户配置建立的 provider binding；插件 source revision 没有改变，原“更新来源”按钮覆盖不到这个情形。

本次给已失败的连接增加“重试当前连接”：保持原 source、connection、脚本及绘图参数；同连接的图表共享一次重连，释放旧绑定后重建，期间禁用按钮并显示加载状态。没有放宽账户匹配或修改宿主接口。真实 React/Electron 双图回归在旧版本上失败，新版本通过；与连接生命周期及来源恢复共 **42/42** 定向检查通过，TypeScript、定向 oxlint 和前端构建通过（保留原有 bundle 大小警告）。

04:03 UTC 只更新并重载前端资产，后台和插件没有重启，真实团队成员继续运行。04:04 UTC 正常滚动回图表后，US100 为 **346 根 live**，黄金为 **687 根 live**，原 SMA 可见，无 pageErrors，保存的图表/脚本和认证摘要一致，14 个旧暂停保持。此现场证明重载后的连接与显示恢复；按钮的并发点击、旧绑定释放等由隔离真实 Electron 回归证明，没有在现场伪造账户失败来点击按钮。见 [现场图表](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/binding-retry-frontend-deployment/live-charts.json)。

底层重连修复已独立提交 **7123a77**（3 文件、6 项新回归），未推送。UI 两文件及 Electron 测试与既有未提交来源恢复代码相邻，保留在工作区并导出 [精确 UI 差异](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/binding-ui-delta/ui-only.patch)，没有把先前大量改动一并提交。本轮插件版本和模型均未变。

## 团队报告恢复缺陷及一次修复复测

两名真实成员分别于 04:09:30、04:14:44 UTC 完成（12轮/52次资源读；11轮/33次资源读），均为原配置 `gpt-6.1-sol`。04:14:45 综合者在模型启动前返回 **report_parent_unbound**，本轮父工作流和综合子任务自然中断。主 Agent 随完成通知从空闲自动继续，这段不是根助手发消息唤醒；根助手随后才于04:17发维护等待反馈。

根因是 `capability-service.workflowContext` 只在执行会话第一次创建时绑定报告。此前同名冲突发生在保存会话之后，恢复便漏过预留。这是宿主恢复缺陷，不归因于模型或研究观点。隔离真实宿主/本地模型传输 fixture 先红后绿；最小两行修复与新回归已提交 **66d33ce**，相关 **21/21** 通过。已有报告被移动后保持原身份，原路径替代文件不被覆盖，已完成模型成员没有重复调用。

主 Agent 保存失败证据与检查点后空闲；04:20 UTC 备份主库、两次确认无活动 Run/回复/待处理 Agent job，正常关闭并确认进程退出，停机再备份主库，只替换该单一宿主文件，沿用同 EXE/profile/workspace 启动。退出前后所有 Run/Agent job 的稳定状态及输出摘要保持；没有访问活动子库。这里没有使用内部 UpdateGate IPC 维护锁，不宣称检查与退出之间具备原子隔离。

初次45秒启动核验超时，程序实际已用新 PID 38436 打开；仅重新运行只读核验，于04:23通过，**没有再次关闭、复制或启动**。原因未确立，不把验证超时写成程序崩溃。核验确认14个旧暂停完整内容、216条报告/修订/配置记录、已安装插件和模型认证一致，见 [维护核验](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/report-resume-deployment/verified.json)。04:23:24 经普通聊天提交原 Run 的一次续测，要求复用两名已完成成员；最终综合、判断和发布结果仍待核验。

## 实际综合与报告观察（04:41 UTC）

- 两名原成员的输出 SHA256 与修复前逐字一致。定向追问实际由原配置的真实模型完成，5轮、16次资源读取；它把“可能漏掉本应处理的闭柱”修正为“已披露的观测采样边界，现有契约没有逐柱追赶承诺”，综合报告采用了该修正。没有因为静态推导便修改业务策略或冒称完整原生等价。
- 两名成员分别33次/52次资源读取，公开回执的工具耗时中位数418/380ms、上限559/602ms。它们合计85次调用、23轮模型交互，属于值得关注的成本；公开Run工具账本不含参数，不能判定其中重复比例，也不能把工具耗时之和解释为非重叠墙钟时间或模型延迟。
- 04:35:29报告v1实际发布，04:35:39检查器在1000/390宽度均报告`absoluteClose`的JavaScript异常，实际UI同样显示错误。原因是作者脚本把容差读成`audit.extension.nativeTolerancePrespecified`；Agent自行改为真实字段`audit.nativeTolerancePrespecified`，04:37:52发布v2，04:38:02检查通过。根助手没有编辑研究报告；这不算渲染器漏检或新产品修复。“先发布再检查”让用户短暂看到错误页，作为流程体验问题保留。[修订与检查回执](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/team-r2-render-audit.json)保存两版真实结果。
- [04:38实际v2页面](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-team-v2-2026-10-21T04-38-40.919Z.json)确认统一字体/主题、10个附件绑定、无全页横向溢出或pageErrors。两个折叠区真实点击展开并恢复；实际下载4145字节附件索引，与v2固定包SHA256一致，见[交互与下载](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/team-r2-report-interactions.json)。本轮没有重新导出这份报告的PDF/PNG，也没有逐一下载其余9个附件。
- 04:39:21综合者因无报告文件树能力而正常请求主Agent核对稳定fileId，公开状态为主动暂停；不是原`report_parent_unbound`再次发生。主Agent自动从空闲醒来，04:39:45读取报告文件/修订，04:40:22经父子恢复接续，没有根助手额外输入。权限隔离和协助接续均被实际触发；完整工作流终态与判断登记仍待核验。
- 实际UI同时打开v1/v2时，两个dock标签只有同一标题，选中后正文栏才显示版本。这是版本标签辨识问题，不是文件树出现两个相同报告；尚未修改。

## 团队终态、仅展示重排与判断边界

原研究工作流于04:41:30 UTC完成，结果为`artifact_2c107308-9099-44ef-9761-40a94ef56a86 / revision_b1e1c7b3-7fde-4df7-8d99-7b67b4668e37`。04:43:45正式`investment_research_report`调用精确复用该引用，04:56:41完成，**耗时776,583ms（约12分57秒）、15轮、31次工具调用**。只新增一个报告角色，没有新增研究或QA工作流；原两成员输出不变。原九份JSON附件摘要全部相同，新增的完整原研究结果附件也与原固定数据字节摘要一致。见[七项重排核验](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/team-r2-reorder-audit.json)。

重排稿先在`QA20261020/team-r2/展示重排验收.html`暂存发布v1，实际页面统一主题、11个附件绑定、无pageErrors/溢出，见[重排页面](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-reorder-v1-2026-10-21T04-55-10.858Z.json)。这证明复用冻结研究来生成新展示，不证明操作足够轻量：两个报告角色都因无报告库读取权限，在发布/检查成功后主动暂停，请主Agent核对当前fileId，再自动恢复。权限分工可工作，但重复交接和重排耗时是明确的效率问题，未为此新增宿主权限或反复修改。

判断插件实际审计4条本分支回复（1613/387/296/354字符），每条读完全文，source hash与coverage回执一致，状态reviewed。list仍0条，due检查0项，rules仍0条；没有编造登记/核验/评分/规则。候选工程检验尚缺确定的UTC窗口和确认可用的原生输入及核验来源。[判断审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/team-r2-judgment-audit.json)明确区分已测的全文核对与未测的登记后闭环；其他历史分支还有待覆盖项，不声称全队列清空。

**QA范围归因更正：**用户已授权模拟交易、策略挂载和功能测试。此分支只复核冻结证据是根助手安排的任务范围，不是用户没有授权。04:59:44通过正常UI发出一次文字归因反馈并移到下一安全点，要求保留真实零台账、纠正“需另行授权”表述、只继续既定报告收尾。上述04:39/04:41/04:54/04:56的自动协助与完成通知均早于这条反馈，不能归功于该人工输入。

## 最终交付与保留核验（05:21 UTC）

最终整合稿仍为 `reports/QA20261020-团队与判断复核.html`、同一 `rep_5a77ae77-050d-4cb1-af1c-d5345ba762fc` 和稳定 fileId，发布到 **v4**，源文件与发布版本一致。05:12 的 v3 检查发现首屏 3962 单位，超过 3000 上限；这是有效的内容检查，实际 UI 可显示不代表这一项通过。Agent 只做一次针对性折叠修正，05:16:55 的 v4 检查在 1000/390 宽度均 rendered、无诊断。没有再次调用重排或重启研究。

[05:19 的真实 v4 页面](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-team-v4-2026-10-21T05-19-35.101Z.json)使用统一主题和 Source Serif 字体，7 个折叠区默认关闭，16 个链接对应 15 个唯一附件资源（索引有两个入口），无 pageErrors 或报告全页横向溢出。正文明确“判断台账保持零条：缺的是核验前提，不是用户授权”，区分外部 QA 反馈与自身工具证据。截图已实际查看。v4 未逐个操作折叠区、下载全部附件或重新导出 PDF/PNG；v2 的交互和前轮导出证据不能直接扩大成 v4 的全项通过。

05:08 的辅助文件复制命令在 `Get-FileHash` 不可用时退出 1。Agent 通过 workspace 读回校验已完成的复制，取消这个已退出、不可恢复的本轮辅助 Run，没有重放复制。根助手在 05:11 独立读回源与目标，两者当时均为 6704 字节、SHA256 为 `0af7fc129fed0d4d0022d3fc7d3ccabf13b4636044b90c6d3c61c8250cb80f45`；目标随后为 v4 合法修改，该摘要不是当前目标摘要。[失败与读回证据](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/team-r2-aux-process-error.json)保留，没有确定 PowerShell 模块配置或产品层根因。

[最终状态七项检查](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/final-session-check-2026-10-21T05-20-42.516Z.json)全部通过：原九暂停、插件版本与状态、模型/认证保持，无额外安装、无活动 Run，主 Agent 无活动回复或排队输入，旧切换自动化仍 PAUSED。另按 R2 的完整基线校验，**14 个旧暂停 Run 的完整 body SHA256 全部不变**，见[14 项保留结果](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/final-protected-state-r2.json)。55 个启用插件 ready，旧 manual-trading 仍 disabled/stopped。已发布的七条 QA 主报告均源与发布一致。

只关闭了 QA 打开的旧版本和暂存稿标签页，未删除任何报告或修订；05:21 保留唯一选中的最终 v4，新版继续使用原数据打开，见[标签页收尾](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/team-r2-final-ui-cleanup.json)。两个产品修复提交为 `7123a77` 和 `66d33ce`，未推送；图表 UI 的工作区差异范围另见前节。

本轮仍保留的主要限制：终端禁止交易且报价时间与宿主 UTC 不一致；策略执行/挂载及原生完整等价未通过；判断登记、到期核验和规则演进未覆盖；因子输入登记链和部分外部引擎依赖未打通。仅展示重排耗时、重复主 Agent 路径核验、先发布后检查和同标题版本标签属于已观察的效率/体验问题。前轮归档超时与联合渲染 fixture 不稳没有反复修补。完整 26 包边界见[插件效果矩阵](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-results-summary.md)。


## 2026-10-21 06:19 UTC：Agent 自助开启 MT5 算法交易权限

MT5 已正式更新到 2.1.5。真实主 Agent 在同一 FTMO-Demo 模拟账户、配置版本 8 上，通过新增 mt5_trading_permissions 执行 read→enable→同命令重复 enable→read。终端正常重启，experts_trade_allowed 从 false 变成 true，mcp_trade_allowed 始终为 true；重复调用返回完全相同回执，最终读回确认已开启。原账户可交易，原阻碍是终端算法开关，不能归因为缺少用户授权。

51/51 定向回归及独立 HEAD 核心 30/30 检查通过；核心修复本地提交 73dc565，完整集成已安装，相关架构集成差分单独冻结、未混入提交。全部原 Run、14个旧暂停、报告与模型配置保留，宿主零修改、未打开子数据库，新版保持打开。本次没有发送订单或挂载策略；报价时间口径和下单闭环仍待后续验证。

证据：[权限修复与验收](E:/brief2great/sesame/outputs/mt5-trading-permissions-20261021/README.md)、[真实调用独立核验](E:/brief2great/sesame/outputs/mt5-trading-permissions-20261021/verified-live.json)。
