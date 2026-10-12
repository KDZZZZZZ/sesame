# 第二轮 CORE 开发与维护交付

版本草稿：`sesame/kurumi-replay 0.1.3-dev.1`。仅独立 `plugin-round2-draft`，没有安装/更新/加载、正式lifecycle、控制首轮、模型/券商调用。不是久留美交易角色任务。

## 1. 显式实验生命周期

1. 等旧实验引擎确实 `status=complete`、outcome为victory/not_reached/bankrupt、结算空仓；所有角色已终态并有双副本sealed证据。
2. 主会话未来显式 `kurumi_archive_terminal(command_id,expected_version,run_id)`：完整旧document/engine/逐章frames/源文件/consumed journal ref/角色封存/周报和展示record/封存时包源代码双副本存档，逐文件核验digest，最后原子写 `experiment-history/<runId>`。源代码注明为封存时版本，历史角色模型/输入另有原始证据，不能把新代码当旧代码运行证明。
3. `challenge/continuous`不改、不充值、不复活。未确认任务、recovery/continuation、unknown事务、未完成hooks/weekly/归档、丢失来源阻塞。失败保留`experiment-commands`预约；同一请求显式重试补齐。不删失败占位规避门槛。
4. 主会话未来 `kurumi_new_experiment(...previous_run_id,profile_id='informed-replay-50x-v1')`验证双副本和history完整性，预约唯一newRunId、先双副本归档initial document、CAS写新`challenge/<runId>`与`experiments/current`。资金=另一个实验的300000JPY，目标20000000JPY，不是旧轮补款。创建不选模型/不submit，运行默认paused；model=null。
5. 稳定command相同输入（键顺序无关）返回同run/同receipt；不同输入拒绝。并发同command共用Promise；其他unknown预约阻塞。history/head与新run用不同collection记录；新回放同历史，**不是独立样本外**，无通过前瞻门槛的专属规则。

## 2. 冻结50x规则

`experiment-profiles.js`是唯一可选profile定义。旧无profile的native checkpoint仍500/25/25；新显式profile全部50/50/50。原强平比率0.2/0.5/0.3、手续费3JPY/1000/side、融资10JPY/1000/UTCday、FX60000ms不变。

JS validate/snapshot与Python入口独立核验profile的id/content/digest和engine/rules；未知profile或在checkpoint改规则均拒绝。Python实际native leverage、adapter margin与stopout从冻结profile读。JS display从reference /25精确有限Decimal校正到500/25/50，不用Number金额。角色instructions及observe规则传当前章50x/profile和知情重放限制；report/UI以rules.experimentProfile读取。本次没有修改旧历史数据窗口配置（其中旧杠杆字段是原数据窗口出处，不是新run执行杠杆）。

## 3. H1提交与spectator outbox

只有新50x profile启用：每根H1的金融CAS同时写`committed-hooks/<runId>:<engineVersion>`，保存before/after完整checkpoint。原始H1归档后await两个独立模块hook；成功后emit订阅再推进下一H1；失败保留已提交账本与outbox，暂停后续调度。

`native-engine.consumedInterval`只读取**实际追加nativeJournal的消费前缀**（owned路径/regular/no symlink/hash/count验证），不读next execution slice。`batchFromCommittedJournal`再次核对单步version/journal后形成真实bid/ask聚合。正常H1披露cutoff为区间end，实际last quote clock单独保存quoteTimeMs；破产partial cutoff为最后实际消费tick，不制造closed bar。chapter transition时取consumedChapter旧章，而非已经切换的下一章frame。初始视图为空consumed bars，明示尚无tick，不用未来H1补warmup。

每H1（含章settlement/terminal）调用`onReplayCommitted`和`onWeeklyBoundary`，精确账户mark=after.equity最后一行；周界保存actual quote clock、UTC披露边界、成本/订单/成交前缀。首次章hook附pre-step真实空仓余额与空consumed view；不存在虚拟初始报价。

重启只持久化暂停/保留待办，不自动submit模型/重放交易。`kurumi_retry_committed_hooks`为显式恢复，模块按同run/version幂等。新50x初始`presentationEnabled`由profile判断，providers拒绝新账户与旧view混称atomic。

**未接线/必须pending：**普通运行时tick级消费前缀推送/播放尚未接通，正常H1目前一次提交后闭柱更新，forming能力只对真实partial/delta有数据支持。服务host没有main布局作用域，不复用main host：持续图表marker更新先存todo，未来主会话用`kurumi_refresh_presentation(chart_id)`消费；自动main原生聊天PK解说与自动layout刷新尚无实际宿主验收。本次不能说已实现完整沉浸式体验。

## 4. 周报控制

`kurumi_weekly`：status只读概要；enable/disable/drain（非status必需command_id/expected_version）仅主会话、角色暂停/核对完成时允许。enable/drain须authorize_generation=true，固定模型openai/gpt-6.1-sol描述符。创建与重启从不调用该生成路径。本开发任务**从未启用或drain真实模型**。

若未来显式enable，H1冻结后执行独立drainWeeklyQueue(inference)；输入/output/request/报告均按UI模块完整封存；unknown/submitting的失联请求不自动重付费。单个报告输入超1MiB需显式分区，不截断；Agent方式因需公开完整output collector仍pending。详见ROUND2-PRESENTATION.md。

## 5. 新run全窗口FX绑定

旧`kurumi_import_fx_supplement`保持dev.4的绑定与窗口，未修改它或旧pointer。新工具`kurumi_bind_experiment_fx`只在新50x引擎version1/未消费/暂停时调用，manifest schema2须明确**new runId**、相同frozen source摘要与完整CHF章eligible范围（startIndex+1到endIndex小时结束）。不接受旧runId、schema1或旧24H窗口。

`experiment-fx.js`读取原source/raw/zip hash与真实下载receipt，分24H解析全范围，schema2 immutable pointer在新run目录。bounds完整不等于60s全事件覆盖；保留completeForArbitraryExposure=false。后续只按实际原报价优先、补充past-asof<=60000ms；剩余缺口照常missing_data。当前327早期事件仍未解决，不插值、不lookahead、不改变规则。

## 6. 已运行测试（新CORE专用，不重跑dev.4 suite）

`npm run test:round2:core`运行 `tests/experiment*.test.mjs tests/profile*.test.mjs`。27项新测试全部通过（0 skipped）：9生命周期/SQLite fixture、6CORE↔UI hook与工厂fixture、4FX绑定/二进制归档恢复fixture、7真实Python native fixture、1冻结真实USDJPY报价副本native test。

- native合成报价50x margin2000.4JPY，旧500x同case200.04；当前profile的Python equity mark和JSsnapshot相等。
- native50x合成stopout实际报价触发，ratio0.2不变，fixture余额37400JPY；不是历史角色结果。
- 冻结真实USDJPY副本2361条（2014-12-05T19:00~20:00UTC），固定人工test决定：50x保证金242818JPY，与Python mark一致；原输入digest不变。它只是撮合/金额口径验收，不是策略收益或真实宿主验收。
- SQLite为本测试独立node:sqlite适配器：真实文件关闭重开、canonical键顺序；**不是Sesame官方Store回执**。
- 工厂完整main/subagent清单与scope拒绝是fixture；未执行activate/plugin_validate/plugin_test/install/load。

stdout/stderr保留外部private/round2-core-*.log；精确回执在verification/round2-core-*.json。原生每次stdin/stdout/stderr归并保存成独立raw-transcripts.log；原生进程不使用正式缓存/socket/service。

## 7. 主Agent未来验收gate

- 首轮真正terminal、角色封存全量、原始账本/来源对账，显式archive→new；本任务没有控制它。
- 匹配SDK的真实storage/CAS/重开（包括大document/blob预算）、scope factory/activate、官方validate/test及版本digest更新；目前pending，不伪造receipt。
- 新玩家清洁独立状态、无Movie私有路径依赖、macOS arm64/Python3.13固定native环境的公开prepare/install体验（不在本任务执行）。
- 真正runtime50x账户页原生native状态/费用/margin与rawjournal核对；fixture原生通过不替代宿主通过。
- 实际形成柱无未来数据、实时marker/计算指标、锁/删除/换绑定、当前client artifact/instance/generation rendered回执；目前pending。
- 独立真实UTC周报输出、完整保存/原生report UI、未知/重启不重付费；本次只冻fixture输入。
- 正常tick级形成柱播放、自动main原生聊天PK与service→main marker刷新接线（当前仅主会话显式刷新）。
- additional method plugins真实采用证据与一般风险lesson审阅；analysis-plan只是proposed，不是已采用。不得给角色原作未来结局。
- CHFJPY327早期事件仍strict pause；代表性首章可验证体验，不能据此称全章覆盖已解决。

安装/首次第二轮/未来有偿验收仅由主Agent决定。本稿无任何交易/重启授权。


## 0.1.3-dev.2：最新目标覆盖早期全轮说明
采用有界首章原生体验，不消费完整第二轮。新玩家空白私有state可直接创建50x，旧run必须先全量终态seal。默认42个预约角色/168已提交H1、每command1且每4H audience pause；manual pause须显式arm，5000在模型前拒绝。正常forming由实际Nautilus trace采样+原始journal prefix播放，金融不重放。NativeOrderTrace只在新50x真实生产，legacy未知状态不补造。
主Agent解说用公开claim/read当前响应→自己普通native-chat自由正文→ack/read同一真实message，完整正文与固定证据封存；不需要private write或第二旁白模型。先diagnose并在真实SDK核实可见文本形状，不把fixture/public port读回当native UI displayed。方法依赖main-only公开catalog/inspect/显式install流程，无隐藏安装。完整可重放驱动、预算、周界/partial区别和pending见PORTABLE-EXPERIENCE.md。
当前全部正式安装/加载/控制/paid角色及周报/SDK/client验收均未执行；isolated fixture与真实独立Nautilus结果不是正式原生观看通过证明。
