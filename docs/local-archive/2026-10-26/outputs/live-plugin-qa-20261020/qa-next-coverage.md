# QA20261020 后续覆盖建议

**17:00Z收尾说明：本轮测试已结束，以下建议与进度均为历史记录，不自动续跑。**最终结果见[26插件逐项表](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-results-summary.md)及[验收账本的最终段](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/qa-ledger.md)。临时插件已卸载、索引v5实际UI已核、原9暂停和模型/插件状态保持，主Agent空闲；新版与原数据保持打开。通讯回环及一次自动记忆整理已补证，不能再按旧段落当待办重跑；未解决分支按用户要求保留。

[最终候选快照](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-target-final.json)为26包/271能力、146项有候选/125项无候选，非通过率。原13:18文件另存为coverage-observed-baseline-1318.json与coverage-host-observed-baseline-1318.json；以下94/177、111/289等仅保留旧截点。

## 以下为收尾前的建议和取证记录

本文件仅汇总既有测试证据和后续方案，不执行业务、不修改产品或机器生成的覆盖分类。所有业务调用仍由真实 Sesame Agent 完成；排除 Kurumi。实际报告交付与视觉验收单独记录，不能用本建议代替交付。

最新范围进一步排除纯skill/知识指南及ABU系列，其余插件须达到设计效果。当前主验收表为同目录 `target-plugin-acceptance.json/md`：26个可执行插件、271个能力（181 Agent/90 host-only），94项仅有候选、177项无候选。按实际业务结果和可观察效果判断，优先一次综合任务、必要时最多一轮有依据的复测；反复不稳则记录并停止。下述55/289与111候选只保留历史取证口径，不作为当前完成率；MT5交易不再循环测试。

## 证据截止与当前结论（已合并状态效果、收尾审计与接续归因）

- `plugin-matrix.json` / `scenarios.md` 是 08:03Z 的计划基线：55 个插件、289 个能力，其中 199 个 Agent 可见、90 个仅宿主调用；另有 11 个无可执行能力的知识或指南插件。356 个资源路径不是 356 项独立业务能力。
- `coverage-observed.json` 分类截止13:18:47Z：651个调用、59项observed、17项blocked候选、213项not_run。与 `coverage-host-observed.json` 宿主专用证据去重后为111/289个候选，178项尚无候选；90项host-only中25项observed、10项blocked候选、55项未观察。分类变化不是通过数增加或功能退化证明；observed、包装器或Run completed均不等于业务成功。`remaining-coverage-plan.json`仍保留12:17Z的107项历史基线，本次不改机器生成账本。
- 两份方法报告最终实际导出已核：final-export-acceptance.json确认量化v1 PDF14页、证据v3 PDF12页，均每页有正文、表格/代码尾部保留；量化逐页文本与静态fixture一致，两份PNG各3片SHA及字节不变。旧13/11页保留为前版截点。跨市场v3已有PDF9页及114/114黄金行证据。输入不足、时序拒绝和来源部分覆盖仍保留，报告成功不代表方法全部通过。
- `passive-wake-audit.json` 于 11:19Z 已确认两次独立 idle-wake：主 Agent 空闲时子 Run 分别于 11:02:42Z、11:06:55Z completed，自动回复分别于 11:02:43Z、11:06:55Z启动并完成；精确通知进入模型，各有后续 7 个工具调用，没有人工催促或插件代用户输入。不再把空闲唤醒列为未完成，也不将此泛化为多角色业务流程通过。
- 当前恢复身份见`../live-plugin-qa-ui-close-recovery-20261020/launch.json`与`verified.json`：15:18Z同EXE/profile/workspace重新启动PID15664、URL4967，55 ready、模型/auth不变、原9暂停逐字保留、158条受保护记录一致，启动后子库读取0。此前已停机备份24份数据库，本次产品变更0；14:20Z四包与14:41Z宿主文件版本继续保持。恢复原因是根助手误点关闭，属于root_interference，不能算产品崩溃或团队失败；ready也不替代业务效果。
- #20静态PDF6936ebe已有上述实际14/12页验收。#21初版612727d漏掉报告JS晚生成的链接，追加ed7c46d于14:41Z载入，report-attachment-links-after.json于14:42Z确认三文件34572/407581/92879字节、原SHA、JSON全部匹配，报告仍开且pageErrors/strayRequests为空。动态附件联合fixture仍35/37，Electron单独7/7；真实正向不覆盖该不稳，不再重跑。独立PDF/PNG不嵌入JSON。
- #23/#25已有真实黄金历史UI证据：chart-history-final-ui.json记录正常缩小686→1025根、5919ms、pageErrors空，latest.json后续1365根live；wide.png可见原QA SMA覆盖较早历史，配置/脚本不变。1365是K线数，不能冒充SMA点计数；隔离Worker281→681数值证据和LWC联合fixture未决错误分别保留。在线冷加载、历史回填不代替离线冷启或来源完整性证明。
- 12:42–12:44Z已成功初始化Python IPC并再次确认原DEMO；终端trade_allowed=false。12:55–13:15Z权限专项已结束，未调用下单/改撤单工具，报告最终检查通过；不把completed或报告发布当作交易、临时开关或恢复成功。
- #24由report-reference-after.json确认同消息仅显示单v5 chip、原v4/v5存储引用保留。#22虽然CCXT2.0.3已部署且46项隔离通过，14:36Z BTC仍RATE_LIMITED、500根stale，不能声称实际退避节奏或远端恢复通过。旧绘图source revision改绑被拒绝是绑定守卫，新ID保存/回读不等于旧对象迁移或完整像素验收。
- report-data-namespace-audit.md已确认三个不同MT5 dataset_id按裸ID走host#datasets被正常拒绝，真实Agent改用同ID及明确MT5 SourceRef调用data_snapshot，三次均published、rowCount=1。不是同一请求重试三次或旧schema问题；说明歧义另行修正，不重做已成功冻结的证据。
- 08:20 的 SQLite 锁已标为 potential_harness_interference；子进程清理时消失也不等同产品错误，勿混入插件失败清单。

最新已核效果见[26插件逐项表](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-results-summary.md)。notes九项生命周期/配置检查通过；[状态效果审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-state-effects-audit.md)确认QA记忆候选→接受→读回→markUsed 0→1→归档/恢复/最终归档通过。交易计划只save/pause（execute:false、enabled:false、lastRunId:null），没有实际评审；Judgment空列表/空队列未形成前瞻登记；QMT缺端口、userdata_mini和授权账户，SDK未验。W3已completed/cleaned，保留副本和中文哈希通过，其余文件中间操作因原inline清理保留partial，不重复补测。

W1固定回放、有限原生编译/Tester、历史risk halt和目录推荐已有独立结果；策略报告v2和报告内节点交互已真实验收，独立SvlView缺口仍在。索引v4于16:16:39Z ready，UI证据仍只覆盖v2，待最终清理修订后再作一次UI验收。[收尾审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/run-release-effect-audit.md)定位MT5 resources.publish在16:02Z触及10秒截止，46个资源创建事件跨9.511秒，32文件17,484,642字节未超容量。报告/研究/编译/回测及现场保留，最终归档未完成；16:04仅重报旧错误，cleanup_attempts仍1。具体性能慢点未决，不延长截止、不改产品、不继续恢复。自动整理、团队综合/实际评审、判断闭环、通讯入站与全局cleanup仍未验；网页导航/Lock为partial并停止，MT5交易不再重试。

通讯请求已于16:19:12Z通过正常UI提交，见[message-ingress-submission.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-submission.json)；来源身份、去重和真实ACK尚未验收。全局cleanup尚未运行，不能以notes卸载、W3正常清理或QA记忆归档代替。

接续归因更正：15:27:56Z恢复说明排队的历史事实保留，但该提示从未被消费；W1/W3依靠原主任务和内部通知自行接续，不能归功于人工提示。根助手16:05Z及16:09Z分别只withdrawn自己两条尚未消费的过期输入，未取消活动Run，见[strategy-feedback-withdrawn.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/strategy-feedback-withdrawn.json)及[recovery-steering-withdrawn.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/recovery-steering-withdrawn.json)。原9暂停继续保留。下方建议和阶段记录按原时点保留，不用其“待验”状态覆盖本段，不自动重跑已核验分支。

## 建议执行顺序（已提交部分不重复执行）

| 顺序 | 综合场景 | 本次应取得的最小有效证据 |
| --- | --- | --- |
| 0 | 联合维护后的版本与任务检查（S01） | 15:18Z误关闭恢复已核验，原9暂停及158条受保护记录一致，无产品变更；不重复维护或恢复原9Run。memory与临时配置的效果仍按现有daily实际结果记录。 |
| 1 | 缓存与图表剩余分支（S02） | 黄金1365根live、历史SMA及回填已有实际证据，不重做研究。真正离线冷启、周期/订阅释放及未发生的绘图模式仍留缺口；Kraken保持限流记录，不追加压力。SourceRecovery现场鼠标与隔离点击分开。 |
| 历史保留 | 纯知识/ABU方法（原S04） | 两份方法报告和已有回执保留，最新范围已排除这些包；不再补similarity、model-lab、trade-judges或知识逐项测试，也不将已有材料阅读计入新目标通过。 |
| 3 | 可用来源的证据与解析缺口（S03） | 证据报告已有网页、Feed、JSON/XML及宏观/持仓的分类结果。先关联已有分支回执，再补仍缺且当前可用的 kind/格式；保留部分覆盖和真实来源时点。Kraken已有固定样本和图表证据，订阅限流独立记录，不再泛称公开行情全不可用。 |
| 4 | 一次有界实验 → SVL → 已就绪原生引擎 | 按运行插件的正常指南组织一个真实假设；factor_evaluate四阶段有实际测量与选择依据，空选择也是有效结果。SVL源码、图、执行和回放对应同一输入。先完成一个已就绪引擎，再决定其他独立引擎是否具备条件，不能互相替代通过；不追加已排除的ABU能力。 |
| 5 | 团队复核 → 只评审交易决策 → 判断与记忆（S06） | investment-research 真实角色、追问和综合结果可追溯；明确以 execute:false 验证只评审路径不会调用执行器。两次空闲唤醒已有充分证据，无需为计数再测。判断保留事前时间，无后验真值不强行 resolve；memory 3.1.1 会话刷新后的真实整理结果仍待观察，不能以插件ready代替。 |
| 6 | 工作区文件 → 临时插件 → 配置绑定 | 在 QA 副本和临时插件范围验证搜索、导入、分页读取、编辑、移动、删除，核对内容摘要和中文。临时插件安装、调用、更新、重载、卸载分别留回执；更新后 mounted 状态保留。用该插件的临时配置验证未配置时能力受限、配置后可用、清除后重新受限，不清除已有真实凭据。 |
| 7 | 报告导出与附件（S07） | #20实际PDF14/12页、尾部和PNG摘要，#21三附件真实下载，#24单v5引用均已有固定证据，停止重复验收。保留联合fixture不稳与PDF不嵌JSON的边界；新daily报告按其自身实际交付另验。 |
| 保留阻碍 | 模拟交易及策略部署 | 权限专项已完成且未执行交易，按最新要求不再重试MT5 trade；开仓/改撤单/平仓保留未验。SVL只读状态或已就绪Tester分支仍独立取证，不能利用工作流挂载绕过交易阻碍或影响既有EA。 |

原ABU输入分组仅作历史解释：18项分别依赖OHLCV、多标的、假设持仓或真实成交/训练记录。最新范围已排除，不再安排补测；历史输入不足不改写成当前产品失败，也不编造数据消除缺口。

## 明显遗漏及重复

1. **缓存体验已有部分界面证据。** BTC拖动预取、500根缓存对约160根视口、75秒隐藏后72ms恢复已有记录；黄金reload在线冷加载346根、2843ms已观察。仍缺周期切换/订阅释放及真正离线首屏，不能以当前live证明离线回退。
2. **读写模式不能由一次调用代替。** 84 个能力含显式模式，283 个模式值需要按真实业务挑选。尤其 chart_script 的 put/read/remove、chart_drawing 的读写更新删除、factor_evaluate 四阶段、交易计划和记忆的不同状态变化，必须分开记录。先用 canvas_inspect 枚举实例，无实例不调用 chart_script read。
3. **宿主能力、配置与生命周期缺口较大。** 90 项 host-only 能力、hooks/services 应由真实 UI、生命周期或所属流程触发并观察；加载插件不等于执行 hook。33 个配置字段、10 个密钥字段、53 项依赖配置的能力不能仅靠打开配置页判通过。密钥只验证存在性、脱敏及依赖状态，不抄出值。
4. **大任务可按输入边界分段。** `strategy-workflow.txt` 同时跨因子、SVL、多引擎和 MQL/部署；`evidence-methods.txt` 跨多来源、8 项知识和异步协作。先固定可复用输入，再补依赖独立的分支，比一个超长任务连续安装、等待、压缩上下文更易判断失败位置。
5. **报告重排和界面回归不用重新研究。** 已有各 prompt 指定的报告仍应交付；后续只改排版/导出时复用对应冻结结果和路径的新修订。不要把一次子报告中断扩大为重新取数、重新团队研究。
6. **现有提示词有两个边界容易误解。** `workspace-plugin.txt` 的“删除/恢复”没有独立文件 restore 能力；应验证从保留副本重建并核验摘要，不能虚构恢复接口。`demo-trade.txt` 的固定 QA1020 标记跨重试不唯一；后续新对象需结合唯一批次/Run 和 ticket 明确归属，不能仅凭 comment 匹配旧对象。
7. **自动工作流需受控覆盖。** `team-review` 的默认只评审应明确到 execute:false；事件触发、周期计划和执行器不因团队复核完成而自动算通过。若测试本轮计划，限定一次且结束后关闭该 QA 计划。
8. **读资源不是应用知识。** 11 个无可执行能力插件包括编排指南、8 个分析知识插件、2 个研究方法指南。只读取与当前任务相关的材料，分别记录它如何改变输入、步骤或结论；不必为凑计数遍历 356 个资源。

## 外部依赖：已知阻碍与尚未验证要分开

| 能力分支 | 当前证据与处理 |
| --- | --- |
| MT5 在线行情、交易及在线部署 | 在线行情、Python初始化及原DEMO确认已有证据；终端trade_allowed=false，12:55–13:15Z权限专项未提交订单。不能继续统称IPC未连接，也不能由在线行情、账户侧许可或报告完成推导执行许可/部署通过。 |
| Kraken / Coinbase 公开行情 | Kraken已有目录、固定样本和图表，维护前订阅仍限流；现已安装2.0.3共享队列退避。外部限制可能仍持续，需实际请求节奏与新数据证明恢复，ready不够。Coinbase分支独立记录，不要求交易所账户或密钥。 |
| CCXT / AKShare 环境 | CCXT私有依赖导入检查已有成功证据，不能沿用早期prepare中断判永久未安装；AKShare具体阻碍仍按已有Run诊断分类，不重复盲装，也不以包装器completed判就绪。 |
| FMP / FRED / SEC / Reddit / CFTC | 证据报告已有五分支状态和部分FRED/CFTC材料；先用已有回执逐分支确认，不再一概标未运行，也不把报告列名当完整权限证明。key、token、user-agent与远端权限分开；CFTC无独立密钥，不被其他分支配置连带阻塞。 |
| QMT | 依赖 Windows、xtquant、已运行的 MiniQMT，账户业务另需券商授权。当前仅能标 not_run / 前置条件未核验，不能宣称已发现离线。矩阵中的 5 项 user_operated_live_only 能力不在本轮自动实盘测试范围。 |
| Backtrader / vn.py / MT5 Tester、MetaEditor | 版本、解释器、引擎或工具链均是分支前置条件，当前尚无通过或缺失证明。已就绪引擎可独立测试，缺依赖不以模拟结果补齐。 |
| 多角色模型 | 本轮已有真实主/子 Agent 完成证据，不能沿用旧会话接口拒绝认定当前所有模型阻塞。保持现有模型；若再失败，只记录实际受影响成员/Run。 |
| 判断的后验结算 | 真实未来结果尚未发生时是时间/证据前置条件，不是网络故障；记录与排队可先验证，resolve 留待真实后验。 |

chart_script 缺实例 ID、配置目录调用错误、workspace/host Run ID 混淆、原生 Run 不可恢复、缓存目录漏读、PDF Title 和取消崩溃均不能简单归为“外部依赖”。对本轮已定位修复，只在实际载入对应版本后做最小复验。

## 下一批场景映射

1. **已完成的固定复验不再重复：S02 + S07。** 真实PDF14/12页、PNG摘要、三附件、单v5引用和黄金1365根/历史SMA均有证据；保留Kraken限流、联合fixture、真正离线冷启、周期/订阅释放及SourceRecovery现场鼠标缺口。memory整理只在当前daily自然触发后记录。
2. **等待现有daily的实验与评审分支：S05 + S06。** W1源码映射断言与W2误关中断分别归因；主Agent已自行接续W1，实际输出仍待验。因子/SVL/原生引擎、investment-research和execute:false决策各自验收，不另发宽泛任务、不重复两次通知唤醒。
3. **等待现有daily的工作区分支：S08 + S01。** W3正常暂停请求MAIN ONLY协助，主Agent正处理临时notes插件。统一入口2项配置依赖和已配置writeOnly不回显已有UI证据；未配置拒绝、配置后及更新后正向调用不替代内容与生命周期验收。索引v1及9附件绑定已确认，最终修订和cleanup仍待；网页导航/Lock残余保持partial，不再补测。
4. **有前提再补：S03 + S05/S06非交易分支。** 仅补新目标内缺输入/权限的来源、可用引擎或真实评审；纯知识/ABU与反复MT5交易排除。未发生的后验、缺依赖引擎和未知账户保持未验证，不用另一插件替代设计效果。
5. **通信入口与收尾尚未跑。** 等daily三个分支完成，再分别验证入站来源/唯一消息/真实ACK及QA清理；不以既有idle-wake代替入站。MT5无执行结果，不假定有测试订单；全部9暂停（6历史+3本轮）和报告引用证据保留。

## 执行效率与结束条件

固定一份有来源的输入，多处复用完整引用；每个失败保留实际参数摘要、错误类别和 Run 状态。环境、配置、连接或输入没有变化时，不重复同一失败动作。对真正独立的流程可使用现有编排能力；空闲唤醒测试期间不靠主动 wait 循环代替通知。

每阶段结束记录“已证实通过、产品失败、外部依赖阻碍、输入不足、尚未运行”，再记录实际输出修订和残余副作用。最终索引只链接用户确实能在报告区打开的文件；明确未覆盖项，不把计划覆盖数或 accepted 回执写成通过数。

## 11:43Z 增量事实（最终 verified 待补）

- 空白尾页已按打印媒体重新测量修复：最终共享导出/HTTP19/19、Electron16/16；量化PDF14→13页，保留页文本及末页图片一致，PNG三片不变。详见qa-ledger.md的#19和最新 `../live-plugin-qa-methods-export-20261020/handoff.json`。该源码验证替代前文“空白末页未修”的阶段状态，真实桌面UI仍待验。
- 11:36Z 初次维护因 Node `--import` 的 Windows 路径格式失败，属于QA脚本问题；改file URL后，11:42Z正式rollback reports→data-access3.0.1→reports3.0.3三步成功。三份回执位于 `../live-plugin-qa-history-fix-20261020/plugin-maintenance-step-1/2/3.json`，模型请求和业务尝试均为0，通知继续延后。先前data-access未更新的记录仅代表11:19Z截点。
- 末尾严格保护比较遇到Runtime.init正常recover元数据变化：5个既有paused Agent任务新增状态事件、主job version+1/updated_at；主任务报告child实体、旧事件前缀及9个paused Run输入/冻结内容不变。精确只读核验仍在继续，不将维护校验失败记成产品bug或历史任务被恢复执行。
- 新前端/导出文件尚未复制，桌面尚未启动，暂无最终verified。S01/S02/S07仍等待维护接续后的实际载入、保留证据和UI复验；本次不新增业务通过数，也不重复执行方法研究。

## 12:25Z 后续证据更新

上节仅保留11:43Z历史。最终finalise-v2已完成并于11:57Z正式启动，前次finalise的TLA循环为QA脚本问题，所有失败回执保留。当前状态以顶部和qa-ledger.md的“11:57–12:25Z”记录为准。

- 部署：`../live-plugin-qa-history-fix-20261020/verified.json`、round2-plugins-after-restart.json。
- 实际PDF/PNG内容：`../live-plugin-qa-real-pdf-acceptance-20261020/acceptance.json`与README；证据v3另见methods-export-evidence-repaired.json（PDF11页、PNG ZIP、66/66末单元格）。
- 尚未修复：`../live-plugin-qa-methods-export-20261020/fragmentation-probe/README.md`、proof.json和红测，量化PDF第4/5页字形切片不因内容仍在而忽略。
- 在线冷加载：chart-cold-history-ui.json（346根live、2843ms、0pageErrors、保存图表及脚本不变）；连接语义见market-health-audit.md，离线冷启仍未验收。
- 当前候选107/289不代表通过；demo-trade-retest正在执行，工作流、工作区、通信入口及QA清理仍有待验分支。

## 12:55Z 增量边界

顶部已按近期结果更新；12:25Z段是历史截点。`qa-1255-check.json`和`report-data-namespace-audit.md`分别保留IPC/账户与终端许可、三次来源纠正的证据。`demo-permission-test-submission.json`是新请求回执，不能提前推导执行或清理成功。

#21的部署和点击下载依据`../live-plugin-qa-report-attachments-20261020/handoff.json`继续；#20的`../live-plugin-qa-methods-export-20261020/static-print-poc/`只代表隔离方案进展，两者都尚未部署。后续维护前后的保护校验、真实UI回执和静态导出的附件边界需要分别记录。

## 最新四份剩余prompt审阅

上面的12:25/12:55Z段保留历史；最新状态以顶部、qa-ledger.md的13:15–13:49Z增量和新的target-plugin-acceptance表为准。本次只审阅现有prompt，没有改写或提交它们。

| Prompt | 明显重复或遗漏 | 下一次实际执行前的建议 |
| --- | --- | --- |
| `workflows-parallel.txt` | W1同时串候选嵌套评估、SVL、三个原生引擎、模型决策、MQL/Tester和可选EA挂载，输入/环境前提不同；W2先“读回后归档”，又要求候选、使用、归档/恢复，容易生成两份笔记。它们不是已有方法报告的重复，但单分支较重 | 仍复用已有固定输入；先过合法面板与已就绪引擎gate，再执行一个最小真实结果，其余引擎分别留缺口。删除本轮继续EA挂载/交易的意图，不能绕道重试MT5 trade。W2用同一QA笔记完成“候选→审阅→读回/实际使用→mark_used→归档→恢复→最终归档”；不重复测两次已证idle-wake，不追加纯skill/ABU验收 |
| `workspace-plugin.txt` | 早期“恢复文件”歧义已修为从保留原件导入；配置值实际被消费、清除后受限、挂载状态保持均已写明。更新后主要核对挂载，尚未明确新版查询的实际效果；此时称“最终索引”早于入站和清理 | v2更新后再做一次真实查询并核对输出/版本，卸载后确认能力撤销；仅临时QA配置。此阶段只发布当前进度索引，C复用同一路径追加最终修订，不重新取数或重建整份证据管线 |
| `message-ingress.txt` | 固定发送者映射、唯一ID、同内容重试、一个可见用户输入、一次ACK、禁止循环和不连接外部账户均已明确；不能由emit回执或“计划发送”证明设计效果 | 等真实主Agent收到来源可辨识的输入并回复一次ACK后才记通过，保留同ID两次提交关联和去重证据。若未来要宣称完整协议校验，需另有同ID不同内容/未映射发送者拒绝证据；当前单个正向回环不自动覆盖这些负例，也不为补模式无界增发 |
| `qa-cleanup.txt` | 开头假设回环已观察完成，必须先有真实ACK；只写“不碰6个历史暂停”遗漏另外3个需保留的本轮暂停。工作区场景和本场景都要求最终索引，可能重复生成 | 仅ACK验收后提交；明确9个暂停Run全部保留。用正式入口只清理已登记的QA临时插件、配置、副本、计划/bridge，读取状态确认移除，不因缺交易执行而假定有订单。保留报告引用的证据文件，复用索引追加最终结果，不重跑业务 |

旧remaining-coverage-plan.json的107候选与55插件逐项表继续作为12:17Z历史映射，未机械重算或修改机器证据。最新111候选也不代替目标插件的业务效果；每项需要实际输入、结果、持久化/界面反馈及清理状态，失败最多进行一轮有依据的复测。

## 15:12–15:34Z 接续边界与证据

- 误关与恢复：`daily-effect-audit-followup-findings.md`、`../live-plugin-qa-ui-close-recovery-20261020/backup.json`、launch.json及verified.json。W3正常主动暂停、W1自建脚本断言、W2的root_interference分别保留；24库停机备份，原9暂停和158条记录不变，禁止以恢复为由重跑历史任务。
- 接续与交付：`qa-interference-recovery-submission.json`是15:27:56Z正常UI排队的恢复说明，不是新研究；`daily-report-index-v1-2026-10-20T15-28-09.980Z.json/png`证明索引v1发布与本次UI布局，`daily-index-resource-links.json`证明9附件绑定，不宣称9次下载通过，也不把旧helper属性读错当产品bug。
- 配置与后续：`daily-notes-configuration-ui.json/png`证明2项依赖及writeOnly不回显，页面检查无读取密钥或修改请求。等Agent交接查询内容、版本更新效果和完整生命周期；三分支、入站及cleanup尚未完成。本次只改文档，不新增候选计量，不发任何业务/模型请求。
