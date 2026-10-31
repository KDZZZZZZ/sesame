# 最新插件真实使用覆盖缺口计划

**17:00Z收尾说明：本轮测试已结束，以下为历史计划，不自动恢复或补跑。**最终按[26插件实际效果表](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-results-summary.md)区分已证效果、受阻和未验。通讯回环、一次自动整理、临时包卸载与索引v5实际UI均已补证；原9暂停内容和现有模型/插件状态不变，主Agent空闲，新版保持原数据打开。反复不稳的问题已停止尝试。

[最终候选快照](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-target-final.json)为26包/271能力，146项有候选/125项无候选，不能当通过率。旧94/177、107/289和111/289及下方待办均是历史截点，详情见[最终账本](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-ledger.md)。

## 以下为收尾前的计划与状态

任务口径：排除Kurumi、纯skill/知识指南、ABU系列及已停用的旧manual-trading，其余插件按**设计效果**验收。范围计划由同目录`target-plugin-acceptance.json/md`维护；本文件以下55插件逐项映射及remaining-coverage-plan.json保留为12:17Z历史基线，不再作为当前完成率或排除包的补测要求。

当前结论已合并状态效果、收尾审计及接续归因，目标仍为26个可执行插件/271能力；94候选/177无候选、旧107/289或111/289均不是通过率，本次不改机器计量。15:18Z的`../live-plugin-qa-ui-close-recovery-20261020/launch.json`及`verified.json`确认同EXE/profile/workspace恢复、55 ready、模型/auth不变、原9暂停和158条受保护记录保持，停机备份24库、产品变更0。此前PDF14/12页、PNG/三附件摘要、单v5引用、黄金1365根live及历史SMA证据仍有效。策略v2报告与报告内5节点/函数展开已有真实UI，独立SvlView仍未验；索引v4于16:16:39Z ready，UI仍只核过v2，待最终清理修订后再作一次UI验收。Kraken限流、旧绘图守卫、MT5交易许可、联合fixture不稳及SourceRecovery现场鼠标边界保留。

W1有限策略结果已审，W3已completed/cleaned。[W1收尾审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/run-release-effect-audit.md)定位MT5 resources.publish于16:02Z触及10秒截止：此前46资源创建事件跨9.511秒，32文件17,484,642字节未超容量。已发布报告/研究/编译/回测和现场保留；16:04仅复报旧错误、cleanup_attempts仍1。性能慢点未决，未改产品、延长截止或再次恢复。15:12Z误关闭仍归root_interference；15:27:56Z提示排队但从未被消费，W1/W3靠原任务/内部通知自行接续。16:05及16:09根助手只withdrawn自己两条过期输入，未取消活动Run，见[strategy-feedback-withdrawn.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/strategy-feedback-withdrawn.json)及[recovery-steering-withdrawn.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/recovery-steering-withdrawn.json)。原9暂停不得恢复。

最新逐包效果见[plugin-results-summary.md](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-results-summary.md)。notes九项检查通过，完整配置/版本消费与卸载不再待验；[daily-state-effects-audit.md](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-state-effects-audit.md)确认一条QA记忆候选接受、读回、markUsed 0→1、归档/恢复/最终归档通过。交易计划仅save/pause、execute:false/disabled/lastRunId:null，没有实际review；Judgment空列表无前瞻登记；QMT缺端口/userdata_mini/授权账户且SDK未验。W3的28,841字节副本及135字节中文哈希通过，分页/编辑/移动/删除等冻结附件证据为partial，不能用相邻接口或完成状态补齐。网页导航/Lock仍为partial并停止。

通讯入站I已于16:19:12Z通过正常UI提交，见[message-ingress-submission.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-submission.json)，来源身份、去重和真实ACK尚未验收；全局cleanup C尚未运行。notes卸载、W3正常清理和记忆最终归档不等于全局cleanup。先取得来源可辨识输入、去重和真实ACK证据，再清理限定QA对象，保留原9暂停及报告证据。团队综合、实际评审、自动记忆整理、判断闭环与因子运行仍未验，MT5交易不再重试。下方映射保留历史，不据旧待办重复已验分支；本次仅更新文档，未发模型/网络/业务请求、未读数据库、未启动应用或改产品。

## 12:17Z 历史映射

以下原始分析截止 Agent 摘要 2026-10-20T12:17:15.435Z、宿主摘要 2026-10-20T12:17:15.448Z。当时仅只读核对指定的3份JSON与5份提示词，以下计数和条件不覆盖后续恢复或新范围。

55 个插件、289 个 capability ID 中，**39 个插件 / 107 个能力有调用或宿主事件候选**。其余不能一概称为缺功能；有 11 个纯知识插件、90 个 host-only 能力，以及需要未来时间、环境或执行授权链的分支。这里没有新增“通过”结论。按下一步互斥分组：107 项先审已有候选，75 项已有场景意图，16 项可按所述前置条件合并补测，51 项需宿主路径/生命周期取证，40 项没有明确场景且需输入、环境、时间或排除。289 是能力 ID 数，283 个声明 mode 路径值也不是业务任务数，更不能混成全排列验收目标。

`coverage-observed` 的 returned、`coverage-host-observed` 的 settled/completed 只表示工具/包装层完成；既往失败与后来返回可以并存。WAL 的共享能力记录不能自动当 UI 调用。订阅缺少完整 start/settlement journal，not_run 也可能是证据缺口。知识插件没有可执行能力，plugin_read 不能证明应用；当前输入没有报告正文或知识引用参数，需从真实成果另行核对。

矩阵是 07:58Z 本地源码声明基线，不是已安装运行版本证明。每项验收还需对应本轮真实 Run/operation、实际业务结果、当前 package digest/锁定修订和产物引用；生命周期记录本身不带 digest。仅看 enabled、模型读过说明、报告中列了插件名均不满足。

## 场景顺序与合并方式

1. **先复核已有证据，避免重复。** 对已返回的量化基线、解析、公开来源、画布/报告读回实际结果；区分预期负例、产品错误、输入不足和已恢复。只读一次当前安装摘要并比对锁定版本，不再次遍历所有完整 manifest。当前快照晚于某任务实际运行与否应由根助手核对，不能仅因计划文字存在重复发任务。
2. **W1 与 W2 保持综合任务。** W1 负责受控因子→SVL→真实可用引擎；W2 复用证据做团队与 execute:false 风险评审、判断和 QA 记忆。把后文 G1 本地小缺口合并进去，不为每个 ID 起一份报告。context/submit/check/decide/apply 必须由各自真实角色链触发。
3. **N 完成工作区与临时插件闭环。** 文件操作、脚手架、真实查询、统一配置依赖、writeOnly 脱敏、更新 mounted 保持、卸载合成一个日常资料任务。测试秘密只属于 QA 且无外部权限；不改已有真实凭据。
4. **I 单独验入站，C 后清理。** 固定本地发送者映射、as:user、唯一 messageId、同内容重试、只一条可见输入、一次 ACK、无循环。events.emit 的保留主题是宿主入站协议，不是这 55 包中一个虚构的 capability ID；它与知识型 orchestration、子任务完成唤醒分别验收。不能在 ACK 之前清理入口或宣称处理完成。
5. **D 只在 gate 成立后做一次。** 不与 W1 的挂载/卸载同时写同一账户；先确认原始 DEMO、连接、许可与 QA 归属，UNKNOWN 查状态，不重新下单。D 的自然语言没有锁定 manual_trade 或 mt5_trade 通道，只计实际路径。W2 明确 execute:false，因此不会覆盖 trading_decision_apply/portfolio_execution_apply；D 直连下单也不能替它们。不要为补 ID 再制造交易。
6. **G2/G3 保留条件。** 知识方法先审核既有“证据与方法对照”中的实际推理；缺失才补有限同源分析。ABU/原生方法、外部数据和后验判断按真实输入/环境/时间继续；不能用假历史、回填结果或换来源标签凑覆盖。最终 C 的索引应明确未覆盖清单。

W1/W2 对应 `workflows-parallel.txt` 两分支；N=`workspace-plugin.txt`；I=`message-ingress.txt`；D=`demo-trade-retest.txt`；C=`qa-cleanup.txt`。表中“规划”仅是提示词意图，未证明开始或完成。

## 可合并且当前不依赖新增外部账户的缺口

- **目录与文档选择**：`sesame/quantskills-catalog#catalog_list_categories/catalog_filter/catalog_recommend` 对同一真实任务选择方法；只证明目录工作，不证明推荐方法已执行。
- **QA 文件/插件配置**：N 已覆盖主要场景，补记录实际经过的 `plugin_load`、`plugin_set_state` 与 `configuration_open`；`plugin_catalog` 仍以当前目录可访问为前提。当前没有可安全下载的 QA 目录包证据，`plugin_install_catalog` 不能由本地 install 代替。
- **画布整理**：已有 QA 实例上 `canvas_focus`；核对 `chart_script/chart_drawing` 已用 action，再只补未证实的读回/临时修改/清理，不动原图。单次调用不能证明所有形状/实现模式。
- **记忆与语义审计**：W2 的 QA 非风险笔记加入候选审阅；确实用于索引后才 `memory_mark_used`。`judgment_audit_source` 必须读完当前 QA 回复，再 `judgment_coverage`；`judgment_rules` 可只读。真正的 resolve/reflect/rule 不属于现在可无条件完成的清单。
- **冻结数据与函数素材**：`report_data` 仅在确有登记 dataset 与新增采集需求时固定并读回；已有 DataRef 不重冻；`strategy_functions` 写 QA 扩展后由 W1 的源实际引用。`strategy_decision`、`report_backtest_template`、MT5 translation/conformance 仍依赖 W1 产物，不能列为现在已有可独立验收。
- **只读环境/回执**：`akshare_status/catalog`、`ccxt_catalog`（akshare_discover 成功会保存私有环境选择，不归为严格只读）、已有 command_id 的 `mt5_command`、`portfolio_execution_status`；这些发现/诊断只覆盖对应读取，不能算行情、连接或交易通过。

## 明确阻断、条件及排除

- **已观察的错误不等于当前外部状态**：MT5 Python `-10004`、trade `-10005` 是本轮历史候选；CCXT 有 `SOURCE_UNAVAILABLE`，AKShare prepare 的宿主记录有阻断候选。摘要没有足够正文定位所有环境/网络根因或确认恢复。由真实 Agent 的当前一次必要检查和既有回执裁定，不循环重试。
- **模型/数值输入**：auto-factor/factor-evaluator 要有合法面板与真实嵌套角色；investment-research 要真实成员完成；ABU model-lab/similarity/trade-judges/exit-rules 的正向证据不能从目前通用阻断标记臆断。合法训练标签、可比窗口、完成交易及事前特征缺失就保持未覆盖。
- **时间依赖**：judgment 的 resolve/review_due→reflect→rule/retire 需要真正到期、后验材料和既有准则；自动转有效还需前瞻样本/时间门槛。不得回填旧判断或更改期限制造通过。
- **环境/来源依赖**：AKShare、CCXT、Backtrader、vn.py、MetaEditor/Tester、QMT 各自环境单列。金融研究的凭据存在、套餐权限、user-agent 与具体站点响应分别核验；不新增/修改真实密钥。公开 CFTC 也不能免除网络和时间窗口前提。
- **执行边界**：QMT 交易、实盘/未知账户、原有订单策略与历史暂停任务排除。DEMO 许可并不授权篡改 risk/allow_trading，也不自动覆盖需要嵌套 executor 的路径。保留 `manual_trade_*` 现属 portfolio-execution 的事实，不恢复被删除的 manual-trading 旧 ID。
- **宿主分支**：host-only hooks/services/source operations 按真正 UI/数据源/工作流生命周期观察，不能让模型直接构造内部权限调用。不能为一个 dispose/config hook 重启、卸载或改 55 个现有插件；订阅验收需真实 source/版本/时间/feed 更新及释放证据，不能用目录或 bind 成功代替。
- **排除项**：Kurumi、旧版兼容、远端目录发布、全机扫描、为枚举制造账户/虚假历史/交易。没有安全 QA 对象或真实调用需求的破坏性分支明确保留未覆盖。

## 55 个插件逐项映射

每项的 A 是真实模型调用摘要，W 是 WAL 候选；同一共享调用可能出现在两者，不相加。`!` 表示包含阻断候选，不表示当前仍失败或后续恢复已验证。完整准确的 qualified ID、计数、代表证据 ID、声明模式和计划映射在同目录 `remaining-coverage-plan.json`，不包含凭据或结果正文。

### 01. sesame/canvas-control — 工作台与图表编排

已有证据：A：`canvas_inspect`、`canvas_binding` !、`canvas_apply`、`chart_script` !、`chart_drawing` !、`indicator_publish`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 打开真实 SVL 图；C 清理仅本轮 QA 图表/对象。现有提示词没有明确补齐 canvas_focus 或 chart_script/chart_drawing 未证实的 action。
- 可补缺口：G1：canvas_focus 的 center/maximize/restore；先查当前 QA 实例，再按需要验证 chart_script read/put/remove 和 chart_drawing read/put/remove；只补回执中缺的模式。
- 条件/排除：绑定须有准确 SourceRef/InstrumentRef；drawing trend/horizontal/rectangle/fibonacci、indicator_publish implementation=code/series 不能由一次工具名记录推定全覆盖。无新业务需要时不强行生成所有图型。
- 最小验收：保存当前 revision 与渲染回执；源码、实例 ID、几何及刷新后状态一致；删除只作用 QA 对象。

### 02. sesame/configuration — 配置助手

已有证据：A：`configuration_read`、`configuration_integration_catalog` !、`configuration_integration_check`、`configuration_integration_open`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：N 明确测试临时插件普通字段和无外部权限的 QA writeOnly 字段；I/C 只保留/清理本轮临时配置。
- 可补缺口：G1：configuration_open；N 顺便核对 integration catalog/check/apply/open 的依赖能力提示。
- 条件/排除：不切模型、不动真实密钥/账户/allow_trading；configuration_update target=model/environment 不因临时插件配置成功而算覆盖。最新 N 已明确授权假测试 writeOnly 值，优先于旧 matrix 的较窄配置测试说明。
- 最小验收：缺项时真实查询受限；配置后查询实际消费测试值并产出校验标记；目录/回执不泄值；null 清除后再次受限。保存成功不证明远端认证。

### 03. sesame/data-access — 数据与研究证据

已有证据：A：`market_read`、`data_sources`、`data_query`、`data_snapshot`、`data_read`、`research_register` !、`data_providers`、`market_instruments` !。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1/W2 复用冻结证据，D 获取执行前所需事实；不是重跑既有来源。
- 可补缺口：已有 8 个能力均有候选；先复核 research_register/market_instruments 的失败与后续恢复，而非整组重跑。
- 条件/排除：market_instruments search/describe 的实际模式未保留；远端来源可用性分别核验；快照必须保留原时间、单位和不完整覆盖说明。
- 最小验收：固定 ref 可读回，行数、来源/截止和消费者所用版本一致；失败/空数据不能算查询通过。

### 04. sesame/memory — 长期记忆

已有证据：A：`memory_search`、`memory_trading_context`。 W 新增候选：`memory_index`、`memory_activate`、`memory_before_compact` !、`memory_before_run_release`、`memory_dispose`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W2 读取上下文、保存一条 QA 非风险笔记、读回并归档。
- 可补缺口：G1 并入 W2/N：memory_propose→memory_manage candidates/accept 或 reject 的候选链；QA 笔记 restore；真正用于索引后才 memory_mark_used；memory_manage stats 可只读核验。
- 条件/排除：forget 仅确属无用的 QA 副本并保留必要证据；不为覆盖修改风险红线或全局保留策略。memory_tree/stats/configure 等 host-only 不能由 Agent 伪造内部调用；before_compact 只随自然生命周期观察。
- 最小验收：候选 ID 与正式 memory.id 分开；expected_version 生效；使用记录关联真实成果；归档/恢复状态读回；未采用不刷新使用时间。

### 05. sesame/orchestration — Sesame 使用与编排指南

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W1/W2/I 真实子任务编排、完成唤醒与入站排队均能形成应用场景。
- 可补缺口：先审阅实际任务选择、Run 关联与汇总；plugin_read 只证明读取，本文所限输入没有可归属的知识应用正文。
- 条件/排除：被动唤醒/入站是宿主机制，不是本插件不存在的可执行 ID；不能替代业务插件能力。
- 最小验收：实际按用户目标选择功能并解释界面/流程；不猜工具，不将资料内容当权限。

### 06. sesame/plugin-manager — 插件管理

已有证据：A：`plugin_discover`、`plugin_read`、`plugin_inspect`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：N/I 用最新脚手架建两个职责分开的 QA 插件；N 安装、业务调用、更新、确认挂载状态、卸载；I 等 ACK 后由 C 清理。
- 可补缺口：G1 并入 N：plugin_load 与 plugin_set_state 的 QA 会话/工作区状态；plugin_catalog 只读最新目录（需当前目录可访问）。
- 条件/排除：plugin_install_catalog install/update 需要真实可用的 QA 目录包；本地安装不覆盖它。不得为补覆盖替换既有 55 包或发布新的远端目录；I 不是覆盖了全部 integration 类型。
- 最小验收：保留精确版本/digest、校验诊断、查询实际结果与 update 前后 mounted 状态；卸载后查询能力撤销。

### 07. sesame/reports — 交互报告

已有证据：A：`report_template`、`report_read`、`report_check`、`report_publish`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1/W2/N/D/C 都要求实际检查与发布；W1 的真实策略/引擎成果适合 report_backtest_template。
- 可补缺口：G1：仅若有实际已登记 dataset 且需要新增固定采集时，report_data 固定并读回；若仅已有 DataRef 则不重复冻结，保留此入口未覆盖。report_backtest_template 等 W1 真实产物。先核对已有渲染/导出证据。
- 条件/排除：现有摘要不含 report_template.kind，不能认定 21 种图型均用过；按实际数据需要选择，不把枚举全排列当业务。PDF/PNG 是宿主链路，当前三份文件不能替代 UI/下载内容验收。
- 最小验收：路径存在、不可变 revision/data refs 可读取，report_check 真正渲染；发布与渲染分别验收；静态导出完整性另附实际文件证据。

### 08. sesame/strategy-authoring — SVL 策略创作

已有证据：A：无。 W 新增候选：`strategy_activate`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 已规划 SVL validate/publish/graph、适用 workflow/pipeline/replay 和可视化。
- 可补缺口：G1 并入 W1：strategy_functions 写 QA 函数扩展并在同一源中实际使用；strategy_decision 的模型决策仍无明确场景，等固定源/输入后再做一个有界 signal/risk 决策，不下单。
- 条件/排除：strategy_decision models/submit/status/timeline、cancel/invalidate、bridge_start/stop 是不同状态分支；缺请求/合法源不得硬调；不留下 bridge。图形布局不是执行或原生等价证据。
- 最小验收：AST/semantic digest、source artifact 与图一致；固定事件重放有真实 traces/intents；PNG/节点图只是展示；需要模型时保存实际决策 ref。

### 09. sesame/workspace — 工作区、文件与执行

已有证据：A：`read`、`write`、`edit`、`bash` !、`host_files_read`、`host_files_run`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：N 已规划少量 QA 副本的搜索、导入、分页读取、编辑、移动、删除；W1/I/C 使用同一 QA 工作区边界。
- 可补缺口：不另起文件任务；N 注意 read/write/edit/bash 与 host_files_* 是不同入口，只计实际经过的 ID。host_files_list/mkdir/write 若由其他入口代替，仍需保留未覆盖。
- 条件/排除：只动 QA 副本；报告源改动不等于发布版本更新；终端失败/取消不能算脚本成功；不扫描全盘或执行破坏性命令。
- 最小验收：UTF-8 中文、内容摘要、分页边界、移动后路径、删除归属与保留原件读回；进程真实退出码。

### 10. sesame/abu-backtest-lab — 回测审计基线

已有证据：A：`abu_backtest_lab_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 11. sesame/abu-breakout — 突破信号基线

已有证据：A：`abu_breakout_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 12. sesame/abu-exit-rules — 退出规则基线

已有证据：A：`abu_exit_rules_analyze` !。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：有阻断与另一调用候选，先复核是否预期负例/后续恢复；无必要不重复。
- 条件/排除：需要适用的仓位/退出规则输入；没有合法输入不为测试制造历史成交。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 13. sesame/abu-indicators — 技术指标基线

已有证据：A：`abu_indicators_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 14. sesame/abu-ml-features — 交易特征基线

已有证据：A：`abu_ml_features_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 15. sesame/abu-model-lab — 轻量模型基线

已有证据：A：`abu_model_lab_analyze` !。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：仅阻断候选，先核对原诊断；G3 有合法训练/验证样本和标签时补正向。
- 条件/排除：训练/标签可用时点与验证隔离；当前材料不足以判定是环境还是输入错误。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 16. sesame/abu-moving-average — 均线信号基线

已有证据：A：`abu_moving_average_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 17. sesame/abu-parameter-search — 参数实验基线

已有证据：A：`abu_parameter_search_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 18. sesame/abu-position-sizing — 仓位计算基线

已有证据：A：`abu_position_sizing_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 19. sesame/abu-price-structure — 价格结构基线

已有证据：A：`abu_price_structure_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 20. sesame/abu-seasonality — 日历效应基线

已有证据：A：`abu_seasonality_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 21. sesame/abu-similarity — 市场相似性基线

已有证据：A：无。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：当前完全无调用候选；G3 仅在现有固定数据能形成合法可比窗口时补一次真实相似性比较。
- 条件/排除：可比维度/距离/历史截止点与窗口输入；不得伪造历史结果。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 22. sesame/abu-stock-screening — 股票筛选基线

已有证据：A：`abu_stock_screening_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 23. sesame/abu-trade-judges — 历史交易裁判基线

已有证据：A：`abu_trade_judges_analyze` !。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：仅阻断候选，先核对原诊断；有真实完成交易历史与事前特征时再补。
- 条件/排除：需要完成交易与 decision/outcome chronology；不能把之后 D 的交易倒填成更早判断已知结果。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 24. sesame/abu-trade-metrics — 交易绩效基线

已有证据：A：`abu_trade_metrics_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 25. sesame/abu-trend — 趋势分析基线

已有证据：A：`abu_trend_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 26. sesame/abu-trend-pullback — 趋势回撤基线

已有证据：A：`abu_trend_pullback_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 27. sesame/abu-volatility — 波动与跳空基线

已有证据：A：`abu_volatility_analyze`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 可引用已有结果，不等于已计划重新调用本能力。
- 可补缺口：已有真实调用候选；先审阅现有量化报告/回执，不重复整套方法比较。
- 条件/排除：historical/live/synthetic 是来源语义；不能改标签来凑模式覆盖。
- 最小验收：核对固定输入/输出 ref、实际数值/诊断、来源与截止点及方法限制；有过程回执才算应用；不将确定性基线称作原生引擎回测。

### 28. sesame/akshare — AKShare A股研究数据

已有证据：A：`akshare_status`、`akshare_prepare` !。均待业务回执/版本复核，不能据此记 passed。

- 已规划：五份待执行提示词没有 AKShare 独立行情正向场景。
- 可补缺口：G3：akshare_status/catalog 可只读发现；akshare_discover 不下载或升级，但成功会保存私有环境选择。已有 prepare 候选不等于 ready；合法环境后再补 query/quote。
- 条件/排除：兼容 Python/AKShare 与公共行情网络；当前 prepare 的 WAL 有阻断候选。不能凭这些摘要判断仍然缺包或具体网站不可达。market_* host 分支必须经真实数据/图表路径；轮询不等于逐笔订阅。
- 最小验收：实际响应、来源/单位/时区/覆盖、最新时间；准备与查询分开验收；不重复盲装。

### 29. sesame/auto-factor-mining — 自动因子挖掘

已有证据：A：无。 W 新增候选：`auto_factor_activate`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 一个候选、一轮有界实验，真实嵌套 factor-evaluator。
- 可补缺口：并入 W1 读取 auto_factor_runs list/read、auto_factor_report、auto_factor_activity；不另外挖掘第二批因子。
- 条件/排除：需要真实模型、合法数值面板和 evaluator；context/submit 只能由已授权角色调用。pause/resume/cancel 仅新 QA 活跃 Run 的自然需要，完成 Run 不可 resume，历史暂停任务不动。
- 最小验收：prepare→candidate→select→finalize 的真实会话/子 Run 链；评估器算分，允许空选择；成员与报告关联完整。

### 30. sesame/backtrader — BACKTRADER optional backend

已有证据：A：无。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 环境检查；具备依赖才跑一个真实最小样本。
- 可补缺口：并入 W1 backtrader_result 读回固定结果；无需再做独立回测任务。
- 条件/排除：当前环境/固定 UTC 数据/真实 Strategy 源码要实测；environment prepare 仅确实缺依赖且适用时；原生中断不可冒充可恢复 replay。
- 最小验收：保存真实 Cerebro/引擎版本、输入 ref/源码/成本/过程与固定结果；不把 ABU 基线叫原生回测。

### 31. sesame/behavioral-finance — 行为金融研究

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：将注意力、偏差或拥挤解释连接实际来源，给出可区分的替代机制。

### 32. sesame/ccxt — CCXT optional backend

已有证据：A：`ccxt_environment` !。 W 新增候选：`market_bind`、`market_unbind`、`market_searchInstruments` !、`market_describeInstrument` !、`market_queryBars` !、`ccxt_dispose`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：五份待执行提示词没有新的 CCXT 正向取数场景；已有跨市场路径有候选。
- 可补缺口：G3 先 ccxt_catalog 只读核对支持来源；已有环境成功证据可复用，不重 prepare。
- 条件/排除：公开网络与所选交易所可用性；WAL 的 SOURCE_UNAVAILABLE 不能独自定位 DNS/代理/交易所限制。queryBars 有失败/返回候选，subscribeBars 缺完整 journal，需对应真实 feed 证据。无交易 API。
- 最小验收：具体 provider/market/timeframe 与源时间、数据覆盖一致；无认证与无订单副作用；正向成功与不可用诊断分开。

### 33. sesame/dow-theory — Dow Theory 趋势确认

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：说明主要/次级趋势及跨序列确认，缺少第二个有效序列时不伪造确认。

### 34. sesame/elliott-wave — Elliott 波浪候选

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：给出可检验的浪形候选及替代计数、失效位置；证据不足时保留不确定。

### 35. sesame/factor-evaluator — 因子数值评估

已有证据：A：无。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 明确通过 auto-factor-mining 走 prepare/candidate/select/finalize。
- 可补缺口：不另开主 Agent 直调场景；四阶段都需真实工作流回执。
- 条件/排除：同一个冻结 evaluator session、开发/验证范围与合法输入；不接收 Agent 手填评分或绕过角色。
- 最小验收：阶段顺序、session、候选/选择/最终验证 ref 和实际数值/空选择可追溯。

### 36. sesame/factor-research — 因子研究

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W1 的候选/固定选择/样本外及真实策略实验计划，是现成应用场景。
- 可补缺口：不用另做研究；从 W1 成果引用具体假设、切分、全试验记录、成本和选择冻结位置。
- 条件/排除：方法文档的读取与角色启动均不等于方法已经应用；缺合法面板/引擎时保持不足。
- 最小验收：实际形成假设/候选/评价/固定选择/样本外安排；将流程与ICT等局部知识区分。

### 37. sesame/financial-research — 金融研究工具

已有证据：A：`financial_research_status`、`financial_research_query`、`financial_research_read`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W2 复用已冻结研究，不重新拉全量财务资料。
- 可补缺口：已有 query/read/status 候选先核对真实来源；这三个摘要未保留 query.kind，不能认定九类数据均覆盖。
- 条件/排除：FMP/FRED/SEC/Reddit 各自已有凭据或 user-agent/权限，CFTC 公开来源也依赖网络与实际窗口；不修改真实密钥。research_evidence_query 是 host-only 来源路径，不能以 financial_research_read 替代。
- 最小验收：来源、观察日期/生效时点、单位/频率/修订、原始与规范化 ref；query 成功仅证明当次范围。

### 38. sesame/ict — ICT 价格结构研究

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：用本轮固定OHLC定位流动性、结构位移和FVG候选，注明时点与反证，不把形态直接当订单。

### 39. sesame/institutional-analysis — 制度与经济历史研究

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：用制度、参与者、约束与激励解释实际材料；不从价格推造机构身份。

### 40. sesame/investment-research — 投资研究工作流

已有证据：A：无。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W2 实际多角色综合、按需追问、保存成员和综合报告。
- 可补缺口：不重做已有取数；investment_research_ask 只有真实缺口时使用，若没有缺口则明确未调用。
- 条件/排除：当前可用模型与角色权限、固定 evidence refs；模型接口拒绝是阻断，不是团队完成。
- 最小验收：成员实际回执与综合结果/引用；report 复用固定成果不启动第二轮研究；追问回执可关联原成员。

### 41. sesame/judgment-evolution — 判断复盘与准则演进

已有证据：A：无。 W 新增候选：`judgment_activate`、`judgment_after_turn`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W2 登记一条未来可验证判断并读到期/覆盖队列。
- 可补缺口：G1 并入 W2：judgment_list/read/rules；对本轮一条完整回复 judgment_audit_source 分页读完后 judgment_coverage，不能只查关键词。
- 条件/排除：resolve/review_due 的正向核验、reflect、rule、retire_rule 需要真实期限、后验数据与先前复盘；缺证据只 defer，不把时间改到过去或回填历史成功。成熟准则还需前瞻样本和时间门槛。
- 最小验收：冻结概率/期限/条件/来源；读回一致；完整语义审计引用原文；未到期/证据不足保持待核验。

### 42. sesame/market-data-parser — 公开汇率解析

已有证据：A：`parse_fx_json`、`parse_fx_xml`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：已有 parse_fx_json/xml 候选；后续无必要重复。
- 可补缺口：先对原输入与规范化输出做证据复核，不因为只有工具返回就判通过。
- 条件/排除：需真实 JSON/XML 与正确基准币、单位、新鲜度；不同来源格式不是任意字符串都应解析成功。
- 最小验收：输入 ref/时间、精确汇率字段、错误诊断与原始材料相符。

### 43. sesame/mt5 — MetaTrader 5

已有证据：A：`mt5_catalog`、`mt5_call`、`mt5_cache`、`mt5_python` !、`mt5_trade` !、`mt5_settings`、`mt5_connect` !、`mt5_dependencies`。 W 新增候选：`activate`、`dispose`、`beforeAgentTurn`、`beforeDeactivate`、`beforeRunRelease`、`market.bind`、`market.unbind`、`market.searchInstruments` !、`market.describeInstrument`、`market.queryBars`、`account.bind`、`account.unbind`、`account.listAccounts` !、`account.snapshot`、`account.queryPositions`、`account.queryOrders`、`account.queryFills`、`datasets.query`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 原生工程/编译/Tester 和有条件 QA 部署；D 模拟盘闭环；W2 账户与风险只读。
- 可补缺口：G1 可用已存在 command_id 的 mt5_command 读回；mt5_cache symbols/inventory/bars/trades 仅本地已有数据且只补未知分支。W1 后再按真实 SVL 需要补 target/translation(_file)/conformance；现在不能用普通回测冒充一致性验证。
- 条件/排除：DEMO、连接/许可、准确账号 revision 与 QA 归属是 D 前提；mt5_python 曾 -10004，trade 曾 -10005，connect 阻断，不能由 host operation settled 或图表 live 推定恢复。现有 config/token/交易开关/账户与终端启动状态保持；cache remove/sync_trades 需 QA 数据归属和明确需要。native tool 名从当前 catalog 获取，不虚构方法。
- 最小验收：真实 retcode/票据/后续状态与稳定 command_id；工程 frozen build、Tester 过程、数据/trace 真实；历史缓存时钟口径与原记录一致；QA 结束无遗留。

### 44. sesame/narrative-analysis — 市场叙事研究

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：比较有来源与时间的叙事传播、证据和价格机制，不把流行程度当事实。

### 45. sesame/portfolio-execution — 目标仓位执行

已有证据：A：`manual_trade_inspect`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W2 需要精确执行绑定/只读账户；D 的直接交易闭环可能选择 manual_trade 路径，但当前文字未指定具体通道。
- 可补缺口：G1 可读 manual_trade_inspect/portfolio_execution_status；只有已有准确绑定时读取 context，不能因 inspect 成功声称账户可用。
- 条件/排除：manual_trade_observe/execute/status/cancel 要 DEMO 与新鲜报价；若 D 走 mt5_trade，不计这些 ID。portfolio_execution_apply 必须匹配真实 executor 嵌套链；W2 execute:false 不覆盖它，不为凑 ID 再制造一笔交易或强行执行。configure 不是后端连接/授权。
- 最小验收：实际 observation 时效、operation_id、原生 receipt/ticket 与订单状态；UNKNOWN 先读回，不重复下单；一次路径不替另一条路径。

### 46. sesame/price-action — Price Action 价格行为

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：用同一行情解释摆动、区间/趋势与突破或失败；将图上标注关联真实bar及反例。

### 47. sesame/qmt — QMT 行情与股票账户

已有证据：A：无。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W2 仅依赖检查，明确不下单。
- 可补缺口：qmt_environment inspect 已在 W2；没有独立行情正向场景，若已有兼容环境可只读 qmt_read search/describe/quotes，再决定是否有业务必要。
- 条件/排除：需要券商授权 Windows MiniQMT/xtquant；本轮没有已核验模拟 QMT。qmt_order/cancel/trading_order/trading_cancel 及 positions_close 排除；不改配置或账户，不借通用命令绕过。下载历史需真实行情环境。
- 最小验收：准确 environment 状态与缺项；若能读行情记录实际来源时间/字段；无权限不算插件功能通过。

### 48. sesame/quantskills-catalog — QuantSkills 目录

已有证据：A：`catalog_search`、`catalog_get_item`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：已有 search/get_item 候选，五份后续提示词没有目录筛选/推荐场景。
- 可补缺口：G1 与 W1 选方法合并：catalog_list_categories→catalog_filter→catalog_recommend，仅对同一个真实任务读取候选条目。
- 条件/排除：目录是离线指导索引，不是引擎执行或代码质量背书；不由推荐自动安装第三方软件。
- 最小验收：筛选字段和推荐理由对应实际任务；返回 ID 可 get_item 读回，不捏造上游能力。

### 49. sesame/rss-collect — RSS / Atom 解析

已有证据：A：`parse_feed`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：已有 parse_feed 候选；W2 可复用既有解析证据。
- 可补缺口：无需另造订阅源；复核 Atom/RSS 实际分支，未用分支不冒称通过。
- 条件/排除：完整已取得材料、日期/时区和来源；解析不证明网络拉取/登录成功。
- 最小验收：真实条目标题/链接/日期、重复项/缺日期处理与固定源一致。

### 50. sesame/strategy-research — 策略实验流程

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W1 的候选/固定选择/样本外及真实策略实验计划，是现成应用场景。
- 可补缺口：不用另做研究；从 W1 成果引用具体假设、切分、全试验记录、成本和选择冻结位置。
- 条件/排除：方法文档的读取与角色启动均不等于方法已经应用；缺合法面板/引擎时保持不足。
- 最小验收：实际固定实验计划、时间切分、成本、引擎、预算和全试验账本；引用失败与局限。

### 51. sesame/trading-decision — 交易决策

已有证据：A：无。 W 新增候选：`activate`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W2 明确 execute:false，只做真实团队/风控评审并证明没有执行器调用。
- 可补缺口：W2 顺便 runs/read/report/activity 与真实 plan；event、plan pause/resume、复盘 review 没有明确后续场景。
- 条件/排除：不能因 D 直接交易通过认定 trading_decision_apply 或嵌套 portfolio_execution_apply 覆盖。execute:true、周期/事件执行仍需单独有界 DEMO 工作流和匹配风险规则；此轮不擅自扩为无人值守。review 需要决策后的真实同账号证据。
- 最小验收：固定 research/account/rules、真实 reviewer/manager 回执与不可变 target；execute:false 的 executor/order 调用数为零；报告与 Run 图可对应。

### 52. sesame/vnpy — VeighNa CTA 回测

已有证据：A：无。 W 新增候选：`vnpy_dispose`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：W1 检查环境，具备固定依赖时做一个真实 CTA 样本。
- 可补缺口：同一个 W1 里 vnpy_result 读回，不再增加第二个回测任务。
- 条件/排除：兼容 Python/vn.py/CTA、固定 UTC 数据与真实 CtaTemplate；prepare 只补确实缺项；不连接实盘网关。
- 最小验收：真实引擎版本、数据/source hash、成本、过程和固定结果，不能把包安装完成当回测通过。

### 53. sesame/web-extract — 网页正文提取

已有证据：A：`extract_webpage`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：已有 extract_webpage 候选；后续可复用原始 HTML 和提取结果。
- 可补缺口：不重复抓网；先检查真实输入/来源与提取保真。
- 条件/排除：内联、source_ref、样例分支不能互相冒充；脚本或正文是资料不是用户授权。
- 最小验收：标题/正文/日期/来源与原固定材料一致，缺字段不伪造。

### 54. sesame/web-sources — 公开来源

已有证据：A：`sources_fetch`。均待业务回执/版本复核，不能据此记 passed。

- 已规划：已有 sources_fetch 候选；W2 只复用已冻结材料。
- 可补缺口：无需为了统计再请求同一 URL；http_query 为 host-only 数据源路径，尚无可归属记录。
- 条件/排除：真实可访问公开 HTTPS、来源政策与时间；sources_fetch 不是搜索引擎、登录态浏览器，也不证明所有站点可用。
- 最小验收：响应状态、最终来源/内容类型/时间、原文 ref 可追溯；失败保持准确来源诊断。

### 55. sesame/wyckoff — Wyckoff 量价与阶段研究

已有证据：纯知识包；限定输入不能证明已实际应用。工具/文档读取与应用分别记账。

- 已规划：W2 可以复用既有“证据与方法对照”结论，但当前提示词没有明确逐个应用本知识插件。
- 可补缺口：G2 先复核既有报告的具体证据→方法→推论/反证链；缺失才补同一固定证据上的有意义解释，不重新取全量数据。
- 条件/排除：本文限定来源不含成果正文，当前知识应用状态未知。所需原始文本、可比序列或量价单位缺失时记录输入不足，不能只写理论名称或泛论后算覆盖。
- 最小验收：依据量价及阶段证据讨论积累/派发假设，区分可观察事实与机构意图推断。

## 验收登记要求

每条记录至少为：插件精确版本/digest + qualified capability ID + 真实使用模式/角色 + 本轮 Run/operation/时间 + 必要输入 ref + 实际返回/业务失败或固定输出 + 界面/副作用读回（适用时）。对于知识，记录知识路径/版本和报告中证据→推理→结论/反证的具体位置。无法从摘要补出的模式、调用者、版本与业务结论保持 unknown，不由脚本自动转 passed。

本计划是缺口映射，不是已执行流水账；不改变任何既有 ledger 状态。

## 尚无明确场景的 40 个 Agent 可见能力

下表只列当前摘要中完全无候选、且现有提示词未明确规划的能力；不包括已经安排的 75 项或可合并补测的 16 项。模式仍应逐条读当前 schema，不代表整项能力在所有模式下都被排除。

| 插件与准确能力 ID | 条件分类 | 最小边界 |
| --- | --- | --- |
| `sesame/configuration#configuration_update` | 本轮明确排除 | 不修改现有模型、真实环境凭据或应用偏好；N 的 QA 插件配置走 integration_apply，不能代计 update target 分支。 |
| `sesame/plugin-manager#plugin_install_catalog` | 需要真实 QA 目录包 | 需可安全安装/更新的真实 QA 固定目录包；目前 N 是本地包，不能修改已有 55 包或为测试发布远端包。 |
| `sesame/strategy-authoring#strategy_decision` | 需要固定输入与模型 | models 可发现；submit/status/timeline 等须 W1 冻结源/输入与真实模型，cancel/invalidate/bridge 分支须实际请求状态，不能人为留桥。 |
| `sesame/abu-similarity#abu_similarity_analyze` | 需要合法可比输入 | 真实固定序列可形成合法同维度比较后再测；当前摘要不能证明已有适用输入。 |
| `sesame/akshare#akshare_query` | 需要环境与网络 | 先确认兼容现有 Python/AKShare 与具体公共源可访问；prepare 的返回不是 ready。 |
| `sesame/akshare#akshare_quote` | 需要环境与网络 | 先确认兼容现有 Python/AKShare 与具体公共源可访问；prepare 的返回不是 ready。 |
| `sesame/financial-research#financial_research_configure` | 本轮明确排除 | 不改真实来源凭据；N 的模拟 writeOnly 字段不算该能力覆盖。 |
| `sesame/judgment-evolution#judgment_review_due` | 需要未来时间与后验材料 | 等待本轮前瞻判断到期并获得真实后验数据，按事前口径计算；不能倒填。 |
| `sesame/judgment-evolution#judgment_resolve` | 需要未来时间与后验材料 | 等待本轮前瞻判断到期并获得真实后验数据，按事前口径计算；不能倒填。 |
| `sesame/judgment-evolution#judgment_defer` | 需要真实判断与证据缺口 | 需真实待核验判断与实际证据缺口；正确保留待核验，不以 defer 证明 resolve 成功。 |
| `sesame/judgment-evolution#judgment_reflect` | 需要先前核验/归因链 | 需要已核验判断/已完成归因或实际候选准则；成熟准则还需前瞻样本和时间。 |
| `sesame/judgment-evolution#judgment_rule` | 需要先前核验/归因链 | 需要已核验判断/已完成归因或实际候选准则；成熟准则还需前瞻样本和时间。 |
| `sesame/judgment-evolution#judgment_retire_rule` | 需要先前核验/归因链 | 需要已核验判断/已完成归因或实际候选准则；成熟准则还需前瞻样本和时间。 |
| `sesame/mt5#mt5_chart` | 需要原生方法声明与 QA 对象 | 先从运行 catalog 获取真实 tool/schema/副作用；只允许本轮 QA 对象，不为覆盖重启系统或更改原图/策略。 |
| `sesame/mt5#mt5_edit` | 需要原生方法声明与 QA 对象 | 先从运行 catalog 获取真实 tool/schema/副作用；只允许本轮 QA 对象，不为覆盖重启系统或更改原图/策略。 |
| `sesame/mt5#mt5_system` | 需要原生方法声明与 QA 对象 | 先从运行 catalog 获取真实 tool/schema/副作用；只允许本轮 QA 对象，不为覆盖重启系统或更改原图/策略。 |
| `sesame/mt5#mt5_update_configuration` | 本轮明确排除 | 保留真实配置、原账户与已运行终端状态；启动可能恢复已有 EA，不为覆盖调用。 |
| `sesame/mt5#mt5_import_configuration` | 本轮明确排除 | 保留真实配置、原账户与已运行终端状态；启动可能恢复已有 EA，不为覆盖调用。 |
| `sesame/mt5#mt5_start_terminal` | 本轮明确排除 | 保留真实配置、原账户与已运行终端状态；启动可能恢复已有 EA，不为覆盖调用。 |
| `sesame/mt5#mt5_target` | 需要 W1 源/构建/trace | 依赖 W1 固定 SVL/目标/合法 source_map；conformance verify 还需真实 Tester 逐输入/事件/function trace；先后端普通回测不能替代。 |
| `sesame/mt5#mt5_translation` | 需要 W1 源/构建/trace | 依赖 W1 固定 SVL/目标/合法 source_map；conformance verify 还需真实 Tester 逐输入/事件/function trace；先后端普通回测不能替代。 |
| `sesame/mt5#mt5_translation_file` | 需要 W1 源/构建/trace | 依赖 W1 固定 SVL/目标/合法 source_map；conformance verify 还需真实 Tester 逐输入/事件/function trace；先后端普通回测不能替代。 |
| `sesame/mt5#mt5_conformance` | 需要 W1 源/构建/trace | 依赖 W1 固定 SVL/目标/合法 source_map；conformance verify 还需真实 Tester 逐输入/事件/function trace；先后端普通回测不能替代。 |
| `sesame/mt5#mt5_trading_pause` | 需要 DEMO 与真实 executor 链 | 需真实受授权 executor 链和精确 QA 策略/订单；W2 execute:false 不走此分支，D 直接下单不能替代。 |
| `sesame/mt5#mt5_trading_order` | 需要 DEMO 与真实 executor 链 | 需真实受授权 executor 链和精确 QA 策略/订单；W2 execute:false 不走此分支，D 直接下单不能替代。 |
| `sesame/mt5#mt5_trading_command` | 需要实际工作流回执 | 需合法同 owner/account 的计划订单 command；不冒用 D 另一通道 ID。 |
| `sesame/portfolio-execution#portfolio_execution_apply` | 需要 DEMO 与真实 executor 链 | 需要 matching live workflow executor 与保存 target；W2 execute:false 明确排除此阶段，不额外造交易。 |
| `sesame/qmt#qmt_configure` | 本轮明确排除 | 不修改券商 MiniQMT 账号、userdata 或凭据。 |
| `sesame/qmt#qmt_read` | 需要授权 QMT 环境 | 行情与账户权限分别证明；缺兼容 xtquant/MiniQMT 时不绕过；账户无已核验模拟许可。 |
| `sesame/qmt#qmt_download_history` | 需要授权 QMT 环境 | 行情与账户权限分别证明；缺兼容 xtquant/MiniQMT 时不绕过；账户无已核验模拟许可。 |
| `sesame/qmt#qmt_order` | 本轮明确排除 | 当前没有已核验的 QMT 模拟账户；只做依赖检查，不提交/撤销任何真实订单。 |
| `sesame/qmt#qmt_cancel` | 本轮明确排除 | 当前没有已核验的 QMT 模拟账户；只做依赖检查，不提交/撤销任何真实订单。 |
| `sesame/qmt#qmt_command` | 需要实际同归属回执 | 只可读取本轮真实存在的同归属命令，不构造订单来制造回执。 |
| `sesame/qmt#qmt_trading_context` | 需要授权 QMT 环境 | 行情与账户权限分别证明；缺兼容 xtquant/MiniQMT 时不绕过；账户无已核验模拟许可。 |
| `sesame/qmt#qmt_trading_order` | 本轮明确排除 | 当前没有已核验的 QMT 模拟账户；只做依赖检查，不提交/撤销任何真实订单。 |
| `sesame/qmt#qmt_trading_cancel` | 本轮明确排除 | 当前没有已核验的 QMT 模拟账户；只做依赖检查，不提交/撤销任何真实订单。 |
| `sesame/qmt#qmt_trading_command` | 需要实际同归属回执 | 只可读取本轮真实存在的同归属命令，不构造订单来制造回执。 |
| `sesame/trading-decision#trading_decision_event` | 需要有界 QA 计划事件 | 需要 W2 新 QA 计划确实订阅的独立 event key；不能触发旧计划，且 execute:false；当前提示词未明确事件验收。 |
| `sesame/trading-decision#trading_decision_apply` | 需要 DEMO 与真实 executor 链 | W2 明确不执行；只有单独有界且合法角色链的 DEMO 工作流才可覆盖，不把 D 直连交易算作它。 |
| `sesame/trading-decision#trading_decision_review` | 需要决策后的真实证据 | 真实同账号、发生于该决策之后的注册证据；目标与报价不能冒充成交。 |

以上分类反映当前任务计划与证据，不声明产品功能不存在；运行时条件变化后可由根助手更新，不自动创建任务。
