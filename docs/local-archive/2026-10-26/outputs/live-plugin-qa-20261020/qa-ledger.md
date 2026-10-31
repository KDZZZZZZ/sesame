# Sesame 最新插件真实模型验收

## 最终收尾（2026-10-20 17:00Z）

本轮已结束，整体为部分验收。当前结论以[26插件逐项效果表](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-results-summary.md)为准；下方旧进度和缺陷记录保留各自时间截点，不是继续执行的待办。反复不稳或缺前置条件的分支已停止，没有追加研究、交易或恢复历史任务。

- [最终状态七项检查](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/final-session-check-2026-10-20T17-00-31.042Z.json)全部通过：原9暂停Run内容摘要不变；既有插件版本与启停状态不变；无额外安装、无活动Run，主Agent空闲；openai/gpt-6.1-sol及认证不变，sesame-2仍PAUSED。55个启用插件ready；原有manual-trading为disabled/stopped，保留原状。当前总暂停14个，新增QA失败记录也保留。新版仍使用原profile/workspace打开。
- 临时notes及qa/local-inbound-20261020均正式卸载，后者16:39:59Z完成、能力查询为空；保留QA草稿、冻结证据和审计。QA交易计划保持停用，无触发器，不存在真实订单。限定清理完成不代表W1归档失败已解决。
- 测试索引同路径已发布v5，source与published一致，1000/390宽检查rendered且diagnostics为空。[16:58Z实际界面](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-index-v5-2026-10-20T16-58-24.671Z.json)确认主题/布局、10资源附件绑定、16个默认关闭折叠、无全页横向溢出及pageErrors，并保持打开；没有声称v5所有交互或导出均重测。旧量化/证据报告的实际PDF14/12页和PNG、附件证据仍有效。
- [本地通讯回环](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-verification.json)完成：两次独立host调用→同一event→一个来源可辨的用户输入→一个精确ACK。ACK主动工具0；同期7个后台能力事件经精确调用和checkpoint匹配，属于自动记忆维护，其中validatePlan通过、saved:1。这补齐#16一次真实自动整理复验，不证明私人记忆内容质量或全部作用域。正文13.476秒出现，整轮77.525秒完成，记忆模型9.410秒；长尾效率问题记录但没有盲目修复。
- W1的MT5归档10秒超时仍未解决；Kraken限流、部分联合fixture不稳、交易终端许可、依赖与因子输入准备缺口继续保留。团队综合被根助手误关窗口干扰，未完成且报告未发布，不能算产品崩溃或成功验收。判断闭环、实际交易评审和完整因子流程未验。
- 收尾出现两条Agent脚本失败：原文件与物化JSON哈希比较口径错误、内联命令引号丢失。Agent改文件脚本，逐行深比较一致并分别保存摘要，一次纠正通过；失败Run保留。根助手最终验证器对disabled插件的错误ready断言、报告目录展开等待也只修在QA助手中，不计产品bug。
- [最终覆盖快照](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/coverage-target-final.json)：26包/271能力，146项有候选（113 observed、33 blocked），125项无候选；Agent 181项中111有候选，host-only 90项中35有候选。**这些不是通过数。**旧13:18分类已保存到coverage-observed-baseline-1318.json和coverage-host-observed-baseline-1318.json，target-plugin-acceptance的94/177仍是历史计划。

最终阶段只更新QA脚本与证据文档，没有新增产品代码变更、部署或业务重试。[Agent收尾回执](%LOCAL_USER_PROFILE%)保留发布和卸载关联。

## 以下为收尾前的记录

这是外部测试记录，不是业务研究报告。业务请求、取数、分析、交易与报告均由 Sesame 内的真实 Agent 执行。

环境基线：现有本地工作区、当前 openai/gpt-6.1-sol、55 个启用插件。验收范围排除 Kurumi、纯 skill/知识指南、ABU 系列及已停用的旧 manual-trading 包；其余插件按设计效果验收，不能以调用无错代替。范围计划由同目录 `target-plugin-acceptance.json/md` 维护；55 ready和下述289能力候选仅保留历史环境/取证指标。账号已确认为模拟盘，只允许触碰本轮QA对象；9个暂停Run（含6个原有历史暂停）保留，MT5交易不再循环重试。

## 16:19Z进度截点（收尾前历史记录）

15:12Z误关属于root_interference；15:18Z同EXE/profile/workspace恢复后，原9暂停逐字保留，158条报告、修订、文档和安装等受保护记录一致；模型/auth状态另核且不变。最新[26插件效果表](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/plugin-results-summary.md)已纳入notes九项验收及[W1独立结果](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-strategy-effect-audit.md)：117次扩展函数trace、114 gold/6 control提交、原生编译及2025 Tester的115 bars/27269 ticks均有固定证据；2026零样本、原生trace仅2/9片、workflow的netPosition unsupported、vnpy ready=false和因子未运行边界仍保留。risk一次历史模型halt与timeline复用、目录筛选/推荐已核对，不能替代交易决策插件或完整原生等价验收。

策略v1错误页被report_check明确判failed，Agent自行一次修成同路径v2，rendered且无诊断；[16:03Z实际UI](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-strategy-v2-2026-10-20T16-03-10.432Z.json)通过，见[检查审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/strategy-report-render-audit.md)。16:06Z报告内5节点图、above节点定义及test:compare.gt函数展开已有实际证据；不等于独立账户SvlView或全Netron布局通过。根助手仅撤回尚未消费的自己那条反馈（[回执](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/strategy-feedback-withdrawn.json)），没有打断业务。索引v4于16:16:39Z ready，UI结论仍只覆盖已保存的v2检查；待最终清理修订后再作一次UI验收。

[daily-state-effects-audit.md](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-state-effects-audit.md)已补齐限定状态结论：一条QA记忆的候选接受、读回、markUsed的0→1、归档/恢复/最终归档均通过；不泛化为自动整理或质量提升。交易计划仅save/pause，execute:false、enabled:false、lastRunId:null，没有实际评审；Judgment只有空列表/空队列，未登记前瞻判断。QMT缺行情端口、userdata_mini与授权账户，SDK未验。W3已正常清理，28,841字节副本及135字节中文哈希核验通过，分页/编辑/移动/删除等冻结附件证据为partial。团队综合、自动记忆整理、判断闭环、实际评审、通讯回环和全局cleanup仍未验，不再笼统写成这些状态全部待审。

通讯请求已于16:19:12Z通过正常UI提交，见[message-ingress-submission.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-submission.json)；来源身份、去重和真实ACK尚未验收，全局cleanup尚未运行。

接续归因更正：15:27Z恢复说明确实排队，但16:09Z仍未消费；W1/W3由原主任务与内部通知自行接续，不能归功于人工提示。根助手于16:09:59Z只撤回自己这条过期输入，未取消活动Run，见[恢复说明撤回回执](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/recovery-steering-withdrawn.json)。W3于15:59:34Z completed。下方历史段的排队记录只证明提交发生，不证明已被消费。

[W1收尾审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/run-release-effect-audit.md)已定位16:02Z的MT5 resources.publish撞上protectArtifacts 10秒截止；此前46个资源创建事件跨9.511秒，32文件17,484,642字节低于容量上限。保护机制保留报告v2、已发布研究/编译/回测和任务现场，最终归档未发布，Run为RUN_RELEASE_FAILED interrupted。16:04:43Z只是复报旧错误，cleanup_attempts仍1，没有第二次清理。具体性能慢点未决，未延长截止、修产品或继续恢复；不能归因于队列撤回，也不能由报告通过判整轮完成。

此前PDF14/12页、三附件下载、单v5引用及历史SMA证据保留；Kraken限流、联合fixture不稳、SourceRecovery现场鼠标和MT5交易许可边界不变。目标26插件/271能力及94候选、旧111/289均不当通过率。下表保留15:34Z截点，后续状态以上述增量及26插件效果表为准，不改机器统计。

| 场景 | 已观察结果 | 未完成或限制 |
| --- | --- | --- |
| 最新包加载与恢复 | 14:20Z四包、14:41Z宿主文件版本保留；15:18Z误关后同EXE/profile/workspace恢复，55 ready、模型/auth不变，原9暂停及158条受保护记录一致，启动后子库读取0 | 当前恢复身份见ui-close-recovery的launch.json/verified.json；本次无产品变更。ready不等于功能通过，memory整理仍需独立结果 |
| 模拟交易 | 12:42:43Z Python initialize成功；12:43Z原始trade_mode=0（DEMO），账户侧trade_allowed/trade_expert为true，但terminal_info.trade_allowed=false。12:55–13:15Z权限专项已完成，未调用下单/改撤单工具 | 终端许可仍是已证阻碍，不能继续归为IPC未连接；没有执行或开关恢复成功的证据，开仓/修改/平仓/挂单/撤单不计通过 |
| 报告交付 | Agent 已实际发布 `QA20261020 模拟交易闭环验收报告`，报告区可打开，单 HTML 文件 | 原报告明确展示未执行交易，不冒充通过 |
| 导出 | final-export-acceptance.json确认实际量化v1 PDF14页、证据v3 PDF12页，均每页有文本、表格/代码尾部保留；量化逐页文本与静态fixture一致，两份PNG各3片摘要及字节均不变 | 旧13/11页是维护前截点；14/12页为整行分页结果，不是空尾页。旧证据v2超预算拒绝保留，不能由导出通过推导研究方法全通过 |
| 固定证据附件 | 初版612727d漏掉报告JS动态生成的a；补丁ed7c46d已载入，14:42Z真实点击下载34572/407581/92879字节，均匹配原manifest SHA且JSON有效，报告仍开、pageErrors/strayRequests均空 | 动态附件联合fixture仍35/37，Electron独立7/7；真实正向通过不抹去该不稳。PDF/PNG不嵌入JSON，附件通过只覆盖本固定报告三文件 |
| 数据来源命名空间 | 12:44Z三个不同MT5数据集的裸dataset_id被report_data按host#datasets拒绝；12:45Z真实Agent用同ID及明确MT5 SourceRef调用data_snapshot，三次均published、rowCount=1 | 正常来源守卫与说明歧义分开记录；不是同一ID重试三次，也不是旧schema/数据丢失。说明修正另行处理，未计载入 |
| 主题/折叠 | 浅色蓝橙、深色蓝紫；实际切换主题并恢复浅色；报告 details 可展开/折叠；报告区无横向溢出 | 本报告没有 strong 节点，不将它作为中文强调新验收证据 |
| 配置绑定 | 原10个密钥输入不回显证据保留；15:34Z临时notes统一入口显示2项配置依赖，已配置writeOnly输入仍空。未配置notes_query被拒绝，配置后及版本更新后已有正向调用 | 页面检查没有读取密钥或提交变更；调用内容和完整生命周期仍待Agent交接，不能仅凭成功调用判通过 |
| 跨市场工作台 | 旧冻结BTC120根及黄金114根保留；新黄金明确区间查询115根、图表窗口346根，来源时间和订阅证据支持连接恢复 | 115/114/346对应不同引用或范围，不能直接比较成数据不一致；当前live不能替代离线专项，A股分支仍待 |
| 图表 UI | 14:35Z正常缩小视图触发686→1025根回填、5919ms，随后到1365根live；宽视窗截图有历史SMA，配置/脚本未改、pageErrors为空。证据chart-history-final-ui.json、chart-history-final-latest.json及截图 | 来源仍未证明历史完整；1365是K线数，不是SMA点数。真正离线冷启、周期切换/订阅释放及所有绘图模式未覆盖；隔离LWC联合渲染错误仍保留 |
| 限流与引用显示 | report-reference-after.json确认原消息保留v4/v5引用、UI只显示带版本的单v5 chip；CCXT2.0.3已部署、46项隔离退避检查通过 | 14:36Z BTC仍RATE_LIMITED、500根stale，未证明远端恢复或实际请求节奏；旧绘图改绑拒绝属绑定守卫，不是重复chip或数据丢失 |
| 来源恢复与旧绘图 | source-recovery-final-ui.json记录真实focus+Enter恢复主图：仅source revision更新、generation推进一次、346根live，其他图/脚本/布局保留；空图按钮避让品牌岛已修并于14:41Z部署 | 真实鼠标当时被品牌岛挡住；新布局仅有876×707/360×420隔离鼠标命中证据，尚无部署后真实鼠标复验。旧绑定绘图不可原地迁移，新ID保存/回读不等于全部像素通过 |
| 跨市场报告/中文强调 | v3实际桌面PDF9页，无空白页，固定黄金表114行全部7列按行匹配；PNG下载成功，用户折叠状态保留。中文强调已有strong证据 | 早期v2隐藏正文遗漏和v3 Printing failed留作历史；不把单个提取器跨列交错误判为正文截断 |
| 方法报告/知识应用 | 两真实子任务和报告视觉验已完成；新PDF14/12页、PNG原摘要、固定三附件下载均有真实证据 | 方法的输入不足、时序守卫拒绝和被排除范围保留，报告交付通过不等于每项方法或整个插件通过 |
| 被动唤醒 | 两个子 Run 分别于 11:02:42Z、11:06:55Z 完成，主 Agent 当时均空闲，随后自动续作；精确通知进入模型，两次均无人工催促或插件代用户输入 | 证明本轮两次空闲唤醒，不代替子任务业务结果或多角色研究流程验收 |
| 策略工作流、团队复核、工作区与通信 | W3在关闭前因MAIN ONLY主动暂停；W1自建stage2.py多匹配断言失败；W2被误关宿主中断。15:27Z恢复说明排队后，主Agent自行接续W1并处理notes | 三分支尚未完成，不能把不同原因合并成产品或团队失败。只允许恢复明确的新测试Run，原9暂停不可恢复；通讯入站与cleanup未跑 |
| 测试索引与有限来源 | 15:28Z索引v1真实发布，实际UI无pageErrors、无全页横向溢出；15:31Z正确读取data-report-resource确认9附件绑定 | 早先helper误读属性得到null不是产品缺陷；绑定不等于9附件下载验收。网页导航/Lock残余保留partial并停止补测 |

当前SVL视觉边界：16:06Z实际报告内5节点图可点击above查看定义，并展开test:compare.gt函数图；这是报告内展示，不是账户独立SvlView。单独发布source仍没有独立节点图入口，选择策略只有勾选，旧成果对话框仅JSON且无当前菜单入口。独立组件可达性和完整Netron风格布局仍留缺口，不新增产品bug或通过数。详见[SVL入口与效果审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/svl-entry-effect-audit.md)。

## 已确认的产品缺陷

1. **升级插件丢失原 mounted 状态**：修复 `modules/agent/plugin-system/manager.js`，已部署。更新前捕获有效状态，提交时保留最新显式状态；新装默认行为不变。
2. **提示词把工作区生命周期 ID 称为 Run ID**：真实报告子任务据此查错 Run。修复 `modules/agent/resource-policy.js` 的口径，已部署；不添加 ID 兼容转换。
3. **MT5 Python 未传 portable 模式**：所选终端实际使用 portable，SDK 默认 false。插件根据终端目录传明确 portable，已更新 MT5 2.1.1 并真实重试。修复不等于券商已连接，重试仍超时。
4. **导出 PDF 标题为 report.invalid**：顶层打印宿主未设置报告标题。共享导出渲染器改用纯文本 `document.title`，真实 PDF 回归覆盖英文、中文、emoji、特殊字符及单文件报告；相关 10 项测试通过。已部署，09:33Z 实际桌面 UI 导出并用 pdfinfo 验证中文 Title。
5. **只读等待阻塞同批其他工具**：两个 60 秒等待被共享队列串行，后续读取多等约 122 秒，与“仅等待调用暂停”契约不符。最小修复完成，保留其他工具顺序；4 项新增并发/取消回归和 34 项相关现有测试通过，已部署。
6. **图表脚本读取说明错误**：真实 Agent 按 `read` 可省略实例 ID 的说明调用后失败。已统一 canvas-control 的能力说明、提示与技能；实例读取必须使用 `canvas_inspect.scripts[].id`，枚举走 canvas_inspect。schema 结构不变，相关集成测试 6 项通过，已部署。
7. **中断通知无条件要求恢复原 Run**：本次安装能力带有副作用且未声明恢复，调用 resume 得到正常的 `RESUME_UNSUPPORTED`。已修正通知口径，Run 状态机不变；恢复后真实通知使用新口径。
8. **MT5 typed 历史缓存发现与读取割裂**：旧缓存为空但标准缓存有 44809 根 bars，XAUUSD/H1 有 506 根。inventory、离线品种发现与本地历史读取现在复用标准缓存并明确 stale/OFFLINE_CACHE；继续校验来源与绑定，不伪造实时连通。相关 52 项通过、1 项环境 gate 跳过；已部署，真实 Agent 已通过目录发现和标准历史入口冻结 114 根闭柱。离线画布首屏另见 #15，不合并计通过。
9. **取消子任务导致桌面退出**：09:00:25Z 原 workspace AbortSignal listener 在 Promise.resolve 参数中同步调用已失效 Host port，AbortError 逃逸到 EventTarget，整个 Node 进程退出。改为 Promise 链内调用；独立子进程修前同型崩溃、修后通过。vn.py 同型点一并修复并覆盖同步/异步/已取消信号；已部署。
10. **更新插件误取消暂停 Run**：隔离真实 SDK + 失败进程回归证明，旧 stopService 取消 interrupted direct Run，插件所属 Agent 还会因此丢失恢复记录。仅更新、回滚、失败恢复路径保留暂停 Run 和版本锁；卸载/禁用仍按原语义取消。新增 6 项及相关共 29 项通过；已部署。
11. **恢复错误被 task_private 掩盖**：`plugin-agent-tasks.js` 的 catch/finally 在宿主隔离作用域之外注册，恢复版本冲突后清理子队列时继承主会话权限并误报。处理链现保持原宿主作用域，冻结版本锁与主会话隔离不变；实际 `host_runs_resume` 红→绿，33/33回归与独立 strict unhandled-rejection 7/7通过。10:05Z已空闲重启载入，源码摘要匹配。
12. **CCXT 限流类别丢失**：官方 RateLimitExceeded 和 Kraken 明确限流码被归入 SOURCE_UNAVAILABLE。现窄映射为 RATE_LIMITED，其他拒绝/封锁保留原义；5项Python、36项Node及6项已安装SDK离线异常检查通过。已通过正式管理入口载入 CCXT2.0.2，9条暂停Run全文hash保持。没有改变轮询或退避。
13. **正常代码曲线说明误用错误色**：面板所有p均套danger导致正常说明红色；改普通p为muted，只有role=alert保留danger。TypeScript/Vite构建通过，10:05Z已载入；实际UI正常说明rgb(98,98,98)、无效JSON错误rgb(178,67,67)，无提交请求，字段恢复且脚本全文未变。
14. **静态导出遗漏折叠内容**：实际跨市场报告v2 PDF只有8行，漏了112行及折叠方法/来源。共享导出器现仅在导出独立页展开details、等待原生toggle更新表行后测量；长表分页保留表头。源报告和用户界面的折叠状态不变。四种 published/source × PDF/PNG 红→绿，相关15项通过。10:26Z已部署；v3实际PNG导出为1000×12096、1518103 bytes（该版黄金表114行，隐藏106行），用户3处折叠仍关闭。实际桌面PDF两次HTTP422 Printing failed，而独立Electron同报告9页成功；Windows 内存计量和错误传递修复已列入后续维护 handoff，尚未部署，桌面 PDF 仍待复验。
15. **黄金离线历史不能加载图表首屏**：标准历史读取已有数据，但frontend只等待在线订阅且没有可信墙时时间范围。使用已有ReadMeta.sourceTime，MT5离线仅提供同server/symbol typed bar观测锚点，前端用原历史接口加载；不新增宿主接口，不猜券商UTC偏移，不把缓存声明实时。63项针对性回归及TypeScript/lint通过，前端构建通过（index-tCR0dXSA.js）；MT5 2.1.3 已更新，前端仍未部署，不能计首屏修复通过。
16. **记忆整理把运行会话类型当作记忆作用域**：本轮3次真实模型合法JSON均输出scope.kind=main，被严格validator拒绝；主上下文压缩成功，长期记忆未整理。已将内部模型输入scope改为executionContext，明确global/project/strategy与ID规则，保留原validator；先红后绿，共53项相关测试通过。memory 3.1.1 已于11:13Z更新且ready，回执标记待会话刷新；真实模型整理复验仍未进行，详见compaction-audit.md。
17. **默认工具说明仍有误导口径**：plugin-manager 默认鼓励整包 manifest、data-access 未清楚区分来源 operation 与 Agent 工具、configuration 未区分“未声明配置”与“缺密钥”。三处提示词按已有实现纠正，保留职责分类与接口；45项现有测试通过。plugin_discover 的三处文本也已与真实 id/title/description 搜索范围对齐，追加4项声明/管理测试通过，schema 和行为不变。plugin-manager 3.0.3、configuration 3.1.2 已更新且ready，回执标记待会话刷新；data-access 仍3.0.0，修正未载入。该问题有先前 QA 窗口与源码证据，不把本轮 16 次不同发现查询直接判为无效重试。
18. **静态导出静默截断滚动 PRE 与表格容器**：展开 details 后，量化报告仍有15个pre及1个表格滚动容器被420px上限裁切；证据报告有31个pre被448px上限裁切。旧导出能产出文件，但正文不完整。最小修复只解除导出副本中pre及表格裁切祖先的高度/溢出限制，再执行原尺寸和预算检查，源报告及交互UI不变。共享导出/HTTP回归18/18、真实隔离Electron15/15通过。量化完整高度19092px，修后PDF14页、PNG3片，裁切区尾部恢复；第14页空白另记为分页残余问题。证据报告完整高度341613px，超过原64000px预算，修后PDF/PNG在打印/截图前明确422 report_export_invalid，不能将拒绝计为成功导出。修复状态为 source_verified_not_deployed；证据：[handoff.json](../live-plugin-qa-methods-export-20261020/handoff.json)、同目录README与红绿日志。主维护和真实桌面复验尚未执行。

19. **PDF 打印重排留下空白尾页**：#18 首轮修复后的量化报告按屏幕样式固定 iframe 高度，打印 CSS 移除 padding/控件并改变文字排布后，多余高度产生第14页空白。现仅在 PDF 测量前切换打印媒体并重新测量；最终共享导出/HTTP19/19、隔离Electron16/16通过。量化PDF由14页变13页，保留13页文本逐页一致，末页Poppler图片SHA256一致；PNG三片尺寸、字节及SHA256均不变。最终量化高度为PDF18695px/PNG19092px；证据报告PDF340249px/PNG341613px仍超过原预算，明确拒绝而非截断。见最新[handoff.json](../live-plugin-qa-methods-export-20261020/handoff.json)、同目录README及quant-methods-pdf-print-fixed/print-reflow-proof.json。源码已修复，实际桌面UI验收仍待完成；19/19和16/16替代#18中的首轮回归计数，不将修复完成计为已部署。

20. **固定全高 iframe 打印导致跨页字形切片（实际导出已复验）**：量化实际PDF第4/5页将同一括号切成两片；普通pre/details分页CSS修补无效的红测保留在fragmentation-probe。后续产品修复在原隔离iframe完成数据与展开后，冻结为无脚本、无网络的新顶层静态文档，仅PDF使用；保留沙箱、资源与预算守卫，不重放报告JS。共享21/21、Electron20项通过，合成230行由旧2780个glyph恢复为正确2760个、每页整行。冻结量化v1新PDF14页无空页，22个pre/115个实际td/th全部提取；跨市场v3仍9页、853个实际td/th全部保留，量化PNG三片hash不变。新14页是整行重排后的真实正文，不是#19空尾页回归。证据：[static-product-handoff.md](../live-plugin-qa-methods-export-20261020/static-product-handoff.md)、static-product-proof.json和static-product-red-green/proof.json。独立修复提交6936ebe（commit-pagination.json）与前序60fb5b1基线分开；14:20Z已核验部署；14:28–14:29Z实际下载量化14页/证据12页，均无空白页、尾部保留、PNG不变，见final-export-acceptance.json；量化逐页文本与已验静态fixture一致。

21. **已登记报告附件相对链接解析到宿主根并404**：证据v3三个JSON（34572、407581、92879字节）实际随固定报告打包，但artifact-host只处理脚本/样式/图片，遗漏a[href]。源码现只为登记资源转换链接，经现有隔离MessagePort下载已校验字节；沙箱、外链规则和公开接口不变。先红后绿，Chromium/Electron与现有导出、安全回归30/30通过，lint/语法/whitespace通过；14:20Z初版已部署，但实际晚生成a仍漏绑；追加ed7c46d统一初始/动态/替换链接和href变更处理，14:41Z载入，14:42Z三文件真实下载大小/原SHA/JSON全部匹配、无pageErrors或宿主根请求。联合fixture35/37和Electron单独7/7分别保留，不称全绿。独立PDF/PNG不嵌入JSON附件，不能宣称静态附件交付通过。证据：report-attachment-links-before.json、report-evidence-v3-bundle-metadata.json及[handoff.json](../live-plugin-qa-report-attachments-20261020/handoff.json)。

22. **CCXT共享请求队列绕过订阅退避**：收到RATE_LIMITED后，订阅通道有2/4/8/16/30秒退避，但同路由worker立即派发已排队的历史/其他图表请求。隔离fixture证实这个放大路径，不等于真实Kraken限制的唯一原因。源码现让该worker全部排队请求等待冷却，取消不清除截止时间，缓存markets成功不清零，实际bars/ticker成功才复位；前端和宿主产品代码不变。46项隔离检查通过，本地提交f19d822；CCXT2.0.3已于本轮维护更新并ready。证据：[handoff.json](../live-plugin-qa-ccxt-recovery-20261020/handoff.json)、README及commit-ccxt.json。14:36Z真实BTC仍为RATE_LIMITED、500根stale，未证实远端恢复或实际请求节奏；不再为验证额外施压。

23. **行情宽视窗左侧空白且历史未继续回填**：13:31Z黄金H1已有500根，1172px图窗中仍大面积留白。跟随最新时onWindow(null)丢失左侧逻辑范围，首张非空历史页又提前结束回填；覆盖不完整警告本身不是根因。源码现保留包括空白区的视窗边界，合并rAF通知，按既有needsEarlier继续最多8页，预算、取消、绑定和墙时守卫不变。新Electron红→绿1/1、完整生命周期1/1、缓存/历史19/19及price-chart-render-ui、类型/lint通过。14:20Z已核验部署，14:35Z六次正常缩小后686→1025根、随后1365根live，回填5919ms且无pageErrors；见chart-viewport-before.json/png、chart-viewport-fix.md。不能用早先较窄视窗成功覆盖此分支。

24. **同一助手消息连续发布报告v4/v5产生重复无版本chip**：13:38Z固定主消息包含同一report_id的v4、v5，UI显示两枚相同标题且缺revision标签。源码仅在每条原始助手消息内按report_id展示最新修订并显示固定版本，保留存储消息、历史、用户/委派引用、同标题不同报告及不同回复的独立修订。9项回归、类型/lint通过，本地提交4f1f844；14:20Z已核验部署，report-reference-after.json于14:25Z确认同消息只显示单v5 chip，原v4/v5记录仍保留。证据：report-reference-before.json、report-duplicate-chips-before.json、commit-references.json及对应提交说明。不是重复创建报告，也不删除历史修订。

25. **已加载的历史K线被指标输入再次截成lookback尾段**：实际SMA脚本计算完整，但ScriptRunner对图表输入再次slice(-lookback)；lookback=300时，700根历史的20期SMA应有681点，旧路径只传300根、仅产281点。提交1f0eb03移除图表有界窗口的二次截断，仍保留20000根预算、closed_only、零lookback与固定输入截断。新增真实Worker回归覆盖历史前补后681点、原尾段值不变、窗口重置、预热不足和超预算拒绝；证据为该提交的script-runner.tsx、indicator-results-ui.cjs及rendering.md。已随前端部署；14:35–14:36Z真实黄金加载1365根live，chart-history-final-wide.png可见原QA SMA延伸到历史区间，配置与脚本未改。1365仅为bar_count，未单独计量真实SMA点数；隔离Worker281→681的数值证据与实际像素证据分开。HANDOFF中LWC联合fixture的Value is null未决，不被本次正向截图覆盖。

截至14:42Z，#20分页、#21三固定附件、#24单v5引用、#23历史回填与#25历史SMA均有实际UI正向证据；不泛化到全部插件/模式。#22真实Kraken仍限流，#16真实整理及真正离线冷启未验；附件联合fixture与LWC联合fixture的不稳各自保留。当前26目标/271能力的94候选，以及旧范围111/289，均不是通过数；回归数和commit数也不计入业务通过数。

## 10:05Z 空闲更新与缓存复验

- 独立备份及校验目录：`../live-plugin-qa-resume-fix-20261020-v2`。仅更新恢复作用域JS和3份已构建前端文件；通过正常关闭/启动，沿用原profile/workspace。
- 10:07Z只读验证55个ready、模型及认证配置保持；9个暂停Run（6个历史）、38条已完成主回复、8份文件及停机时6个子库均保留。只清理了产品启动时正常确认的1条已终态QA控制消息，没有启动历史任务。
- 当前实际地址 `http://127.0.0.1:10231/`，PID4364；后续以DevToolsActivePort发现为准。
- 10:07:21Z通过正常输入框提交cache-retest。真实Agent已确认目录列出506根XAUUSD/H1缓存，标准market_read冻结114根闭柱；保留FTMO-Demo墙时/tick volume/不完整覆盖标记。券商仍离线，画布与报告修订仍在进行。
- 真实Agent后续明确：黄金画布仍因在线订阅离线而0柱，历史读取通过不等于显示通过。已单独调查首屏离线加载路径；BTC重新绑定当前来源后有500根/rendered/live回执。
- `drawing-retest-audit.md`：一次drawing_binding_changed为旧source.revision与当前不同的正常守卫；随后真实Agent新建4条绘图，均独立读回完整源码/几何/ArtifactRef。旧BTC绘图保留inactive，不能把新建成功当作旧对象改绑通过。
- `chart-cache-grace-ui.json`：自然隐藏75002ms（60秒TTL、120秒grace），首帧72ms、无历史请求返回前已经显示K线，整个观察窗口无chart-empty。仅操作视图和无效JSON本地校验，未变更绑定/脚本/业务数据。

## 10:26Z 导出更新与并行综合场景

- `../live-plugin-qa-export-fix-20261020/verified.json`：仅更新共享导出器，原profile/workspace；55插件ready，9暂停（6历史）、39条完成回复、8份保留文件和6个停机子库通过。启动后未打开子库。
- 10:26:49Z正常输入框提交methods-parallel，主回复msg_03cb02d0-577a-4844-8d76-07ac0c4eac16于10:34:51Z结束。真实Agent启动的量化方法实验、证据与方法对照两个子任务均已完成；两次自动续作也已完成，未再向主会话发送人工催促。
- 两次被动唤醒均已成立：第一例主会话自10:34:51.745Z空闲，量化子Run在11:02:42.152Z completed，通知11:02:42.153Z创建，11:02:43.213Z自动启动主回复，11:06:27.119Z完成；随后主会话11:06:27.123Z再次空闲，证据子Run在11:06:55.761Z completed，11:06:55.991Z自动启动第二次主回复，11:09:40.479Z完成。两次精确通知均进入模型，随后各有7个核验工具调用，无人工或插件代用户输入；均为idle-wake，而非仅在忙碌中排队。详见11:19Z的passive-wake-audit.json；此证据不替代报告业务验收。
- methods-report-visual.json于11:08:51Z记录两份报告实际可读：`reports/QA20261020-量化方法实验.html`（21折叠、3表、8处strong）和`reports/QA20261020-证据与方法对照.html`（81折叠、21表、3处strong）；均使用report-kit、无inline style，容器宽658px、scrollWidth648px，无横向溢出。截图为methods-report-quant.png及methods-report-evidence.png。视觉验收不等于静态导出完整，后者见#18。
- 本轮分工前元数据：16次plugin_discover返回约102542bytes；read复用清单37176bytes，configuration_read30487bytes，2次host_capabilities_list31515bytes，2次data_query29925bytes。约8分钟后启动分工。仅记录输出体积与时间，不能把全部发现工作直接判作无效；详见methods-efficiency.json。
- 上述字节为 content JSON 序列化大小；37176是业务复用清单，configuration_read 明确 section:model，不是完整插件 manifest 或 all 配置。纯文本大小和原窗口/本轮的归因边界见 qa-efficiency-observations.md 的后续更正。
- 11:10:45Z的coverage-observed.json记录467个调用、59项observed、13项blocked候选、217项not_run；coverage-host-observed.json将90项host-only能力中的25项observed与6项blocked候选归属到operation/lifecycle/started Run证据。与Agent候选去重后为103/289，仍是覆盖候选，不是通过数；186项尚无归属证据。知识加载、ready、包装器completed不自动算业务通过。

## 11:19Z 插件更新后、联合维护前

- 四份正式更新回执分别为mt5-2.1.3-update.json（11:12:59Z）、memory-3.1.1-update.json（11:13:13Z）、plugin-manager-3.0.3-update.json（11:13:17Z）、configuration-3.1.2-update.json（11:14:51Z）：均HTTP200、receipt completed、runtime ready，且pending_session_refresh:true。
- round2-plugins-before-restart.json于11:19:44Z确认上述四版本及安装digest匹配，55插件ready，主会话idle、无活动回复、pending0；现有openai/gpt-6.1-sol和认证状态保留。data-access仍3.0.0。
- 更新脚本逐次核对9个暂停Run全文摘要一致，四次执行输出均为pausedPreserved:9；核对逻辑见update-fixed-plugin.mjs的基线保存及assert.deepEqual。四份更新回执本身未持久化暂停前后hash，不能冒称这些JSON包含暂停证据；联合维护随后再完整落盘，不为补账本读取live数据库。
- 此截点仅完成四插件更新，尚未执行联合停机维护。data-access提示词、新前端、Windows导出修复和滚动PRE完整性修复仍待部署；未计维护或更新后的真实模型/桌面复验通过。

## 09:31Z 崩溃恢复与维护证据

- 备份 8 份 SQLite，目录 `workspace-backups/qa-crash-20261020-090025`；未手改任何数据行。
- 一次性维护 harness 关闭模型四个推理入口、Agent 调度、通知投递及非维护插件服务；只通过正式插件管理入口更新。模型请求为 0，通知全文哈希保持。
- reports 暂时回滚到已有 bundled 修订以解除 workspace 锁，升级 workspace 后立即重测/升级最新 reports；没有卸载 reports 或删除会话 loadout。
- 11 个暂停 Run、其中 6 个原有历史暂停、暂停任务关联与实际子库/文件通过前后校验。配置和 PI auth/settings 哈希保留。
- 同一 profile/workspace 已启动 PID 39304，实际地址 `http://127.0.0.1:11799/`；7 个宿主 JS 文件摘要匹配、5 个插件版本/digest 匹配，55 个启用插件 ready。
- 正常桌面启动后按产品逻辑投递本轮保留通知；这证明中断通知恢复投递，不替代“主 Agent 空闲后子任务完成唤醒”的单独验收。

## 需区分的情况

- 首轮子任务出现 SQLite locked 时，外部观察脚本仍在轮询 DELETE-journal 子库，可能造成干扰。已停止此做法，现只读主 WAL 库和本轮 JSONL。此项不算已确认产品 bug。
- 跨市场 typed cache 入口割裂已修复；10:24Z 前真实 Agent 已通过标准入口冻结 114 根黄金 H1 closed bars。离线画布首屏仍失败，作为独立问题 #15 修复，尚待新前端部署复验。
- 下载超时、缺依赖与远端断连按原始证据记录，不标为插件逻辑已通过，也不伪造替代输出。
- CCXT 私有依赖最终通过导入检查；早先 Kraken/Coinbase 公开目录请求失败。09:34Z 真实 Agent 使用机器已有的无凭据 HTTPS 代理后 Kraken 目录返回，但首项 TBTC/USD 不等于 BTC/USD；继续核准品种。没有新增密钥或替用户取数。
- 截图中的US100.cash是上方旧图底部信息栏，BTC/USD是下方新图；并无标题绑定串错。旧图Source revision changed是旧不可变来源引用被正确拒绝。未据此改UI或放宽来源守卫。
- Agent于09:46取消的是本轮卡住报告写作任务，并自行完成报告；不是QA脚本恢复或取消历史任务。其未投递控制消息在Run终态后不会唤醒模型，启动时只会被正常标记为无法投递。
- 所有用量与能力调用计数见 `evidence-meta.json` 与 `coverage-observed.json`；后者仅为候选覆盖，不自动判通过。

## 构建核对

早先已部署版本核对过构建入口与桌面 SHA-256 相同，等待修复的三份 JS 文件 scoped oxlint 通过。10:38Z 为 #15 重新执行 `npm run build:frontend`（TypeScript + Vite）通过，仅有既有大 chunk 提示；最新源码构建为 `index-tCR0dXSA.js`，仍未部署到正在运行的桌面，不能混淆这两个验证时点。

## 11:36–11:43Z 联合维护进行中（尚未复制或启动）

- 11:36Z 已正常停机。首轮 Node `--import` 传入 Windows 路径失败，属于 QA 启动脚本的路径格式问题；改为 file URL 后接续。证据目录为 `../live-plugin-qa-history-fix-20261020/`，初次 failure.json 不作为产品缺陷。
- 11:42Z 正式管理步骤均已成功落盘：先回滚 reports 到现有3.0.0以解除依赖锁，再更新data-access3.0.1，最后更新reports3.0.3。三份 plugin-maintenance-step-1/2/3.json 分别记录11:42:51Z、11:42:55Z、11:42:59Z；每步modelRequests=0、blockedBusinessAttempts=0、notificationsDeferred=true。这是维护操作成功，尚无新模型或业务验收。
- 11:43Z 末尾保护校验发现 Runtime.init 的正常 recover 对5个已paused Agent任务追加状态事件，并更新主job的version（+1）/updated_at，导致严格摘要比较失败。主任务报告目前差异限这些恢复元数据；child实体、旧事件前缀及9个paused Run的输入/冻结内容保持。主任务与核心审查仍在做精确只读验证，未将此归为产品bug。
- plugin-maintenance-failure.json 保留3项completedOperations且automaticRollback=false、automaticStartup=false；resume-stopped-failure.json明确停在isolated-plugin-maintenance。当前没有复制新前端/导出文件或启动桌面的完成证据，也没有最终verified；等待接续及独立验证后再更新验收状态。

## 11:57–12:25Z 维护已验证与实际UI复验

- `../live-plugin-qa-history-fix-20261020/verified.json`于11:56:50Z确认成功，11:57:20Z的round2-plugins-after-restart.json再次核对：55 ready、同openai/gpt-6.1-sol及auth、9暂停含6历史、42完成主回复、8份输入文件保留；6子库仅停机时核验，启动后子库读取0。data-access3.0.1、reports3.0.3及2个导出JS、前端bundle和index.html共4文件正式部署。
- 首次finalise-stopped的顶层await循环属于维护harness；改为只读subprocess --recheck后finalise-v2成功。此前Node路径、严格恢复元数据比较及finalise失败回执均保留，不计产品缺陷，也未恢复历史业务。正式维护模型请求0。
- `../live-plugin-qa-real-pdf-acceptance-20261020/acceptance.json`及README核验实际下载：跨市场v3 PDF9页、标题正确、无空白页，raw16/16末单元格和黄金114/114行全部7列匹配；量化v1 PDF13页每页文本与隔离最终文件一致，PNG三张逐字节一致，原折叠状态保留。先前连续尾串匹配失败分别是表格提取跨列交错和#20字形切片，未发现新增正文截断，不能据此称排版无瑕疵。
- 旧证据v2在methods-export-evidence.json中PDF/PNG均HTTP422 report_export_failed并明确超尺寸，无下载。真实Agent随后修订业务报告；methods-export-evidence-repaired.json于12:23:06Z记录证据v3 PDF11页（2082582 bytes）及PNG ZIP（2745327 bytes）下载成功，66/66末单元格保留。旧失败和新修订分别保留，不把v2拒绝改写为成功。
- 12:01:57Z通过正常UI发cold-history-retest。market-health-audit.md确认新sourceTime及新115根历史无OFFLINE_CACHE，旧114根固定artifact仍保留旧时间/离线标记；图表346根属于当前窗口。连接在所观测时刻已恢复，未证实缓存把离线伪装为live。
- chart-cold-history-ui.json于12:24:59Z记录普通reload清除前端内存后2843ms绘制346根，receipt rendered/live、pageErrors0、保存图表/绘图/脚本不变；本机历史缓存未清除。这是在线冷加载证据，离线冷启专项尚未通过。
- 12:17:15Z覆盖快照为513次调用，Agent候选59 observed/13 blocked，host-only29 observed/6 blocked/55未观察；去重候选107/289，182项尚无归属证据，不是通过数。12:25Z真实Agent正在demo-trade-retest，当前没有交易结果；工作流、工作区、通信入口及最终QA清理继续待验。

## 12:41–12:55Z 增量复验

- 主QA JSONL中12:42:43Z的Python initialize返回true；12:43:14Z与12:44:28Z快照均为原始trade_mode=0（DEMO）、账户侧trade_allowed/trade_expert=true。12:43:33Z terminal_info为connected=true、trade_allowed=false，因此未提交订单。`qa-1255-check.json`只保留白名单状态字段，不包含账户标识或凭据；早先未初始化的-10004和更早离线时的-10005不能继续代表当前IPC状态。
- `report-data-namespace-audit.md`证实12:44Z三次裸dataset_id调用对应三个不同的MT5数据集，均被宿主命名空间以“资源不存在”拒绝；12:45Z同ID改用`sesame/mt5#datasets`的SourceRef调用data_snapshot后三次均published、rowCount=1。它们是原生命令的证据行，不能证明交易执行成功；不用重新取数或重做报告。
- 12:55:37Z的`demo-permission-test-submission.json`仅证明新请求已提交，根任务正在观察执行。授权范围是通过既有正式入口、再次确认同一DEMO并隔离既有EA后临时测试，结束恢复原开关；当前不写成已打开、已下单或已恢复。该轮的最终回执与清理结果待补。
- #21源码修复及30/30隔离回归已经交接，#20静态打印仍是POC；均未部署本轮运行桌面。后续维护和真实UI复验另记，不改写已有成功导出或历史失败记录。

## 13:15–13:49Z 增量事实与范围收窄

- `demo-permission-efficiency.json/md`确认权限专项主回复于13:15:04Z completed，19分26.666秒、50次工具调用，无下单/改撤单工具。`qa-1255-check.json`独立支持原DEMO、IPC成功和terminal trade_allowed=false。主回复`msg_3602f130-6ac6-46d5-b562-9752e3077011`的公开总结另报告：目录未找到正式独立toggle/restore路径，10个原生图表缺少可核验“EA为空”的字段，无法安全验证开关与既有EA隔离。这是Agent当轮报告的阻碍，未独立证明整个产品不存在相关接口；不能把不交易误说成账户非DEMO、Python未连接或模型接口失败。按最新指示不再循环MT5 trade。
- 权限报告v4首次检查因首屏3566单位超过3000上限失败，v5收敛后通过；属于有效检查和报告返工，不将其计为检查器故障。同一消息中的两个发布引用引出#24显示缺陷，报告/修订本身均保留。
- 三个独立本地修复提交均未push：附件`612727d`（commit-attachments.json）、CCXT共享队列`f19d822`（commit-ccxt.json）、报告引用显示`4f1f844`（commit-references.json）。`60fb5b1`（commit-export-base.json）只记录前序导出基础并保留当前工作区分页改动，不是#20新增分页修复或安装成功证明。宽视窗#23和分页#20以各自handoff/红绿回归为证据，不能借其他commit计部署。
- 新维护harness已完成纯隔离验证，见`../live-plugin-qa-final-fixes-20261020/HARNESS-REVIEW.md`及harness-validation.json；该回执明确maintenancePhasesRun=0。本台账不把计划、脚本测试或prepared补丁当更新/重启通过，冻结plan与正式执行回执由root另行维护。
- 13:18:47Z classifier合并111/289项候选（Agent76、独有host-only35），没有新增“通过率”结论。用户最新排除Kurumi/纯skill/ABU后，当前目标由target-plugin-acceptance另表按设计效果重算；本台账保留历史55插件观察，不再为排除包或数量补测。
- 四份剩余prompt的建议见qa-next-coverage.md和remaining-coverage-plan.md：W1不借策略挂载重复交易；W2合并成一条QA记忆生命周期；工作区更新后应验证实际查询；入站ACK成功后才清理，清理保留全部9暂停。这里只审阅文字，未发送请求或修改业务成果。

## 14:08–14:20Z 最终维护与启动核验

- 首次目录`../live-plugin-qa-final-fixes-20261020/`在capture的本地verifyPlan阶段因ID正则不允许数字而错拒绝sesame/mt5，未连接桌面、创建备份或更新插件。修正后独立重试目录为`../live-plugin-qa-final-fixes-retry-20261020/`，冻结plan SHA仍为`357b61c3ba77a75dee2d895a0f4b53b3eafa778238d219bf15fa7af63e44c1c9`；4个实际目标回归通过，总计12/12，原attempt/failure/capture日志保留。
- 重试通过正式`/plugins/manage`完成MT5 2.1.4、reports3.0.4、canvas-control3.0.2、CCXT2.0.3更新。`pre-close.json`记录14:15:07.032Z与07.534Z两次全局活动计数均为0、保护摘要相同；没有建立UpdateGate reservation，不宣称存在写入隔离。`normal-close.json`记录正常CloseMainWindow被接受，6个Sesame进程全部exit0、最迟279ms退出，脚本未强杀，退出早于产品10秒worker.kill兜底。
- `stopped.json`在全部Sesame进程退出后确认保护状态，再备份主库和6个子库；`deployment.json`记录6个精确hash应用文件，包括新report-export-static.js、共享/Electron渲染器、附件宿主及前端dist。旧前端资产保留。没有在运行时打开子库，也没有用Runtime初始化替代正式维护入口。
- 后续两个失败均为QA harness问题，原日志保留：首次launch继承ELECTRON_RUN_AS_NODE导致`bad option --remote-debugging-port`，仅清除父进程环境未生效；`resume-launch.ps1`改用显式`Start-Process -Environment`清除该项。随后verify误把插件注册表重启后的排列变化当成差异，改为按id排序后比较每个完整对象，未忽略version/digest/state/dependency_lock等字段。接续仅启动与只读核验，`resume-launch.json`明确updatesRepeated=false、filesCopiedAgain=false。
- `verified.json`于14:20:30.510Z确认新桌面URL`http://127.0.0.1:58417/`、55 ready、同openai/gpt-6.1-sol及auth、9暂停含6历史、历史报告与配置保留，启动后子库读取0；`resume-launch.json`记录主PID42412。5个原有paused job只发生启动recover允许的version/updated_at变化，stableSha256保留；没有恢复其业务。`verify-identity.stdout.log`为verified，父任务记录进程exit0。
- #20分页独立提交为6936ebe，#25历史指标为1f0eb03；同附件、共享退避、视窗和chip修复一起进入本轮部署。真实UI正在检查固定报告、附件、图表与限流节奏，本次只记安装身份与数据保留通过，不提前记这些功能通过，不重试MT5交易。

## 14:24–14:42Z 实际UI与宿主补丁收口

- `source-recovery-final-ui.json`记录14:24Z真实键盘focus+Enter恢复主图，只更新source revision并让scene generation推进一次，其他图、脚本和布局保留，主图346根live。鼠标当时被固定品牌岛挡住；空图布局小修的隔离鼠标证据在`../live-plugin-qa-source-recovery-layout-20261020/HANDOFF.md`（876×707和360×420），14:41Z已载入布局，但尚无新布局的真实桌面鼠标验收。不能把键盘成功写成鼠标已通过。
- `report-reference-after.json/png`于14:25Z确认原消息仍有v4/v5两条存储引用，UI只显示`· v5`的单一chip。没有删历史或重新发布业务报告。
- `methods-export-quant-final-fixes.json`及`methods-export-evidence-final-fixes-repaired.json`记录14:28–14:29Z真实PDF/PNG下载；`final-export-acceptance.json`确认量化14页、证据12页，每页有正文、表格/代码尾部保留，量化逐页文本与已验静态fixture一致。两报告PNG各3片，SHA256完整列在该acceptance文件，均与此前PNG逐字节一致；量化首片为`e01fd54874c1…`、证据首片为`9665882cce8b…`。整行重排后的14/12页不沿用旧13/11页，也不据页数增加判断空白尾页。
- `chart-history-final-ui.json`记录14:35Z仅六次正常缩小和hover，黄金686→1025根、5919ms回填，两次历史读取区间向前推进；随后`chart-history-final-latest.json`记录1365根live。`chart-history-final-wide.png`可见原QA SMA覆盖较早历史，配置和脚本未改、pageErrors为空；1365是K线数，未对现场SMA点数作独立计数。来源覆盖警告仍成立；`../live-plugin-qa-indicator-history-20261020/HANDOFF.md`中的隔离Worker数值与LWC联合fixture未决错误继续分别保留。
- 同一14:36Z快照中BTC仍有500根stale、Kraken RATE_LIMITED；共享队列退避源码回归不能证明远端已恢复。`drawing-retest-audit.md`已确认旧BTC绘图仅source revision不同也不可原ID改绑；四次新建/读回是新的成功路径，不把它们误写成旧更新重试成功。
- `../live-plugin-qa-ui-followup-20261020/verified.json`于14:41:29.023Z确认host-files-only切换，当前URL`http://127.0.0.1:9041/`，55 ready、9暂停含6历史、模型/auth/报告/配置保留、启动后子库读取0。`deployment.json`仅列4个文件（JS/CSS/index及artifact-host），本轮没有插件更新；该目录README“仅准备”属于执行前说明，当前以verified为准。
- 附件动态漏绑修复提交`ed7c46d27634dc00bd1a91b62d98ccbb2ccb4a08`，artifact-host摘要`75397f925a0d1887cae30fbb39095e09f3fa2ccdb9b5d864cf0c7bd1d9fb630b`已载入。`report-attachment-links-after.json/png`于14:42:13.776Z记录真实展开原报告折叠后点击三链接：34572/407581/92879字节与固定v3原SHA全部一致，JSON有效，报告仍开、pageErrors/strayRequests为空；文件在downloads-evidence-attachments。`../live-plugin-qa-report-attachments-dynamic-20261020/handoff.json`仍保留Chromium通过、Electron单独7/7、联合35/37的不稳，停止追查，不把现场正向验收改写成fixture全绿。
- `daily-integrated-submission.json`仅证明14:42:52.769Z正式提交，主任务报告当前仍运行；策略/团队判断/工作区与有限来源补验不能提前判完成。通讯入站与最终cleanup尚未执行；MT5交易开关受阻及全部9暂停保留，不新增交易重试或恢复历史任务。本次文档更新无数据库、应用启动、网络或模型调用。

## 15:12–15:34Z 误关闭恢复与综合任务进度

- 根助手误点全局“关闭窗口”，15:12:44.906Z的取消原因为`Host is closing`，归类`root_interference`；不能计作产品崩溃、取消链缺陷或团队业务失败。`daily-effect-audit-followup-findings.md`区分此前两个独立事件：W3于15:11:29Z主动请求MAIN ONLY协助并正常暂停；W1于15:12:21Z因自建`stage2.py`把`qaLastAbove=false;`匹配到三行而断言失败，尚未到MT5编译/Tester。W2才受到误关闭影响，三者不能合并成“三次同因失败”。
- `../live-plugin-qa-ui-close-recovery-20261020/backup.json`记录15:17Z停机备份24份数据库；`launch.json`记录同EXE/profile/workspace于15:18Z重新启动PID15664、当前URL`http://127.0.0.1:4967/`。`verified.json`确认原9暂停Run逐字保留，158条报告/修订/配置/安装记录全部一致、差异为空，启动后子库读取0、产品变更0；55 ready及原模型/auth保持。仅明确授权的新测试Run可以接续，原9暂停不得恢复。
- `qa-interference-recovery-submission.json`记录15:27:56.905Z通过正常UI排队恢复说明，是接续既有任务，不是新研究。主Agent随后自行恢复W1并操作临时notes插件；本台账不替它完成业务，也不把恢复动作计为三分支通过。
- `daily-report-index-v1-2026-10-20T15-28-09.980Z.json/png`确认测试索引已发布v1、源与发布一致，实际UI的pageErrors为空、没有全页横向溢出。`daily-index-resource-links.json`于15:31Z确认9条附件均有正确`data-report-resource`、`href="#"`及下载名；早先helper读错属性产生的null属于取证错误，不是附件缺陷，也不代表已逐一下载9文件。网页提取仍含导航/Lock残余，保留partial并停止补测。
- `daily-notes-configuration-ui.json/png`于15:34Z确认临时`qa/notes-20261020`的2项配置依赖在统一入口可见，writeOnly项显示已配置但password输入无值；检查未读取密钥、未发修改请求。未配置时notes_query被拒绝，配置后及版本更新后已有正向调用；完整查询内容、版本效果与生命周期验收仍待真实Agent交接，不能用UI或调用状态替代。
- 截至15:34Z，daily-integrated三分支、通讯入站和最终cleanup均未完成；不新增通过率或修改机器候选统计。既有Kraken限流、旧绘图绑定守卫、MT5交易许可、联合附件fixture不稳及SourceRecovery键盘/隔离鼠标证据边界继续保留。本次仅更新三份文档，未访问数据库、启动应用或调用网络/模型。

## 2026-10-21 03:09–04:42Z 新模拟账户 R2 续测

- 2026-10-20前段已于17:00Z完成限定收尾；26包效果与未验边界见`plugin-results-summary.md`，不是全部通过。用户随后连接新模拟账户并要求继续。R2沿用现有工作区、真实openai/gpt-6.1-sol及最新已安装插件，排除范围不变；业务仍由Sesame Agent执行，根助手只做QA和产品缺陷修复。
- 正式配置入口同步到新模拟账户，Python 5.0.6231一次initialize后连接正常。原生EURUSD 0.01市价与远价买入挂单各一次均被`trading is not permitted`拒绝，无票据。账户侧许可true、终端trade_allowed=false。组合observe返回STALE_QUOTE；单次时间诊断的Python tick比宿主UTC晚约3小时，未改时钟/放宽守卫/重放意图。不能把外层工具成功写成成交成功。
- 实际execute:false交易评审由两个真实模型角色完成，9次工具调用，冻结decision_only；新QA计划暂停、无调度。此分支通过，执行/改撤/平仓/策略挂载未过。交易报告v6已发布，实际UI7附件、统一主题、无报错，未新增PDF/PNG导出。详情和六项独立检查见`new-demo-r2-audit.md`、`resume-demo-receipt-audit.json`。
- 新账户配置变更但source revision不变时，旧chart binding滞留ACCOUNT_MISMATCH。显式共享重连修复及42项定向检查通过，前端构建/typecheck/定向lint通过；底层独立本地提交7123a77，UI与Electron回归的精确差异冻结为`binding-ui-delta/ui-only.patch`。只部署前端、重载后实际US100346/gold687根live，未中断后台团队；现场没有伪造失败来点击按钮，按钮并发行为仅由隔离真实Electron回归证明。
- 团队报告首次同名空预留被Agent经公开入口移至可恢复回收站，恢复后暴露宿主report_parent_unbound。`workflowContext`缺失绑定时补绑定的两行修复及回归独立提交66d33ce，21/21通过。主Agent空闲后备份、两次空闲确认、正常关闭、单宿主文件替换并用同数据打开；初次启动验证器45秒超时而进程仍在，仅重跑只读核验成功。14旧暂停完整内容、216报告/配置记录、55启用插件及模型认证均保留。没有UpdateGate原子锁，不声称有；启动后子库读取为0。
- R2市场/策略两成员真实完成，原输出SHA保持；真实一次定向QA修正了对闭柱采样契约的判断。综合者v1作者字段错误被report_check及实际UI共同发现；Agent自行修正为v2，两宽度rendered、无诊断。根助手未编辑报告内容。实际v2UI无溢出/pageErrors，10附件绑定；两折叠区交互与4145字节索引下载哈希验证通过。
- 综合者因缺报告树读取权限主动请求主Agent协助，04:39Z主Agent从空闲自动醒来核对原fileId、发布修订并恢复本轮，未收到新人工催办。综合子Run于04:41:25完成，父工作流04:41:30完成并实际投递`origin=automation, role=delegation`的完成通知。不是以新用户授权替代原任务，也没有重跑已完成成员。
- 两成员85次资源读取/23轮模型交互及报告先发布再检查是本轮效率/体验关注项。读取参数不在公开Run摘要，不能判定重复比例；多版本dock标签相同是辨识不足，不是重复文件。04:39复核14旧暂停SHA均未变。判断登记与仅展示重排还在主Agent执行，不能提前计通过；最终状态另补。

## 2026-10-21 04:43–05:21Z R2 最终交付与保留核验

- 正式`investment_research_report`精确复用原`result_ref`，04:43:45–04:56:41完成，耗时776583ms，15轮31次工具调用，仅新增一个报告角色。原两成员输出、九份JSON附件及完整原结果字节保持；没有新增研究或QA工作流。`team-r2-reorder-audit.json`七项检查全部通过。暂存重排v1实际UI通过，但其再次主动请求主Agent核对报告路径，重复交接和近13分钟耗时保留为效率问题。
- 判断实际全文审计4条来源、hash与coverage相符，list/due/rules仍为0，没有登记/评分/规则变更。工程检验缺确定窗口、确认输入和核验来源，不是用户没有授权。04:59:44经正常UI提交一次归因反馈后，Agent接受更正、保留旧原始回执。主Agent此前的自动唤醒/协助和原子任务完成均早于这条反馈，不归功于该人工输入。
- 05:08辅助进程执行复制后因`Get-FileHash`不可用退出1。Agent读回复制结果、取消本轮已退出的辅助Run，没有恢复14个旧暂停。根助手05:11独立读回源/目标均6704字节且摘要相同；之后目标为最终报告正常修改，不把过去的相等摘要写成当前状态。失败归因未查明，保留`team-r2-aux-process-error.json`，不直接判成产品缺陷。
- 原指定报告路径整合发布v3后，检查明确报首屏3962单位超过3000，实际UI可显示不是内容检查通过。Agent一次折叠长表修成v4，05:16:55的1000/390检查rendered且无诊断。05:19实际页面确认统一主题、7个折叠区默认关闭、16链接对应15个唯一资源、无pageErrors/报告全页横向溢出；截图已查看。未逐一操作v4所有交互或新增导出，不把v2交互及前轮导出转算为v4全验。
- `final-session-check-2026-10-21T05-20-42.516Z.json`七项全部通过，55启用插件ready、旧manual-trading disabled/stopped、模型与认证保持、无额外安装、无活动Run、主Agent空闲、旧切换自动化PAUSED。`final-protected-state-r2.json`确认R2基线14个旧暂停完整body SHA全不变；七条QA主报告源与发布均一致。
- 05:21仅关闭QA打开的旧v3标签页，保持最终v4唯一选中，之前的旧v1/v2和暂存稿标签也已关闭；没有删除报告/修订或关闭应用。新版同profile/workspace继续打开。两项修复本地提交7123a77/66d33ce未push，图表UI相邻未提交差异另冻结，不能称所有工作区改动已提交。完整结果和未通过边界见`new-demo-r2-audit.md`与`plugin-results-summary.md`，不重算过时的271能力候选快照为通过率。


## 2026-10-21 06:19 UTC：Agent 自助开启 MT5 算法交易权限

MT5 已正式更新到 2.1.5。真实主 Agent 在同一 FTMO-Demo 模拟账户、配置版本 8 上，通过新增 mt5_trading_permissions 执行 read→enable→同命令重复 enable→read。终端正常重启，experts_trade_allowed 从 false 变成 true，mcp_trade_allowed 始终为 true；重复调用返回完全相同回执，最终读回确认已开启。原账户可交易，原阻碍是终端算法开关，不能归因为缺少用户授权。

51/51 定向回归及独立 HEAD 核心 30/30 检查通过；核心修复本地提交 73dc565，完整集成已安装，相关架构集成差分单独冻结、未混入提交。全部原 Run、14个旧暂停、报告与模型配置保留，宿主零修改、未打开子数据库，新版保持打开。本次没有发送订单或挂载策略；报价时间口径和下单闭环仍待后续验证。

证据：[权限修复与验收](E:/brief2great/sesame/outputs/mt5-trading-permissions-20261021/README.md)、[真实调用独立核验](E:/brief2great/sesame/outputs/mt5-trading-permissions-20261021/verified-live.json)。
