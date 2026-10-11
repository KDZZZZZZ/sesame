# 久留美 · 三章连续挑战 (`sesame/kurumi-replay` 0.1.0)

普通、discoverable、Plugin API 1 可选插件；最低 Sesame 0.2.2。**不进入core/default bundle，不接真实券商，不发布或修改安装catalog。** 此包由 Sesame 内部主/子Agent实现，不调用外部Codex。

插件主体是只读 `sesame.market` / `sesame.account` 数据源，以及宿主真实 `agents.submit/inspect/wait/cancel/current` 角色子任务。主Agent管理与解说；Dashboard使用现有行情图/账户/Agent面板，报告使用打包的 MIT Sesame reportKit/CSS，不更改本体前端。

## 连续规则

- 唯一初始资金300000 JPY；三章实际余额连续；不提供充值、改余额、自由前进或重置挑战工具。
- 空仓可结算20000000 JPY为目标，总资产倍数66.6666667，不是“盈利66倍”。原剧情811600、比赛19749835及家庭补款均不注入本挑战。
- AUDJPY（2014年5月中下旬）→ USDJPY（2014年12月5日前后）→ EURCHF（2015年1月15日前后，以同步CHFJPY记账）。区间与预热由data-windows.json固定，来源口径见DATA.md。
- 每章末强制结算空仓；跳过月份无收益；章节边界暂停供主Agent展示下一章；破产立即停止模型请求，保留负余额。
- 开局固定模拟规则：章1杠杆500/强平20%；章2杠杆25/强平50%；章3杠杆25/强平30%。费用和融资是明示挑战假设，不是假称漫画券商历史条款；不能为凑目标事后改变。
- H1仅观看/决策；下一H1真实細粒度数据撮合。正式路径只接成熟引擎，不回退H1极值撮合。库与适配边界见 RULES.md/原生引擎说明。

## 本机操作

在Sesame主聊天加载本插件并说：“准备久留美连续挑战，先只让她决定一根H1，把原剧情对照与她的实际模拟成交分开画出来，告诉我当前资金。”

主Agent：`kurumi_prepare` → `kurumi_start/step`（首次expected_version=0；默认1个角色回合）→ `kurumi_display` → 标准Agent任务观察 → `kurumi_status` → `kurumi_report`。下一次控制使用status控制revision，不用engineVersion混代。用户显式要求多步后可设置max_steps，绝不自动完成数百模型请求。

角色只允许 `kurumi_observe` / `kurumi_decide`；绑定真实宿主任务与随机授权、正确run/step、版本，普通子Agent不能劫持。角色输入没有未来剧情、原作结局、未揭示历史、窗口终点、观众标记或依赖文件路径。预训练模型可能记得历史，实验不声称严格盲测。

重复操作沿用同ID和完全相同内容。重启不自动付费重发。取消仅停止后续，不能撤销已提交的模拟成交。没有决定/缺行情/不同步换汇/指定模型缺失都暂停。cache仅私有storage.directory；无挑战可显式clear；已有挑战不删底层证据。

## 开发测试

```sh
npm test --prefix plugins/optional-api-v1/packages/kurumi-replay
```

纯fixture测试明确不是市场数据或宿主能力证明。宿主使用正式plugin_validate → plugin_test → 按精确digest安装 → plugin_load，再实际准备、读取provider、触发受限角色、Dashboard/报告检查。维护者可另用仓库原有opt-in匹配宿主测试pattern；包代码不导入私有Host类。原生静态test不运行工厂，不把安装成功当成撮合、模型或渲染通过。

## 授权、许可与留存

自有代码MIT，第三方库保留各自许可；引用见PROVENANCE.md。安装依赖与真实行情仅当前机器私有目录，不随包分发，不承诺整批行情转分发许可。本包是非官方二创研究模拟，不包含漫画图片、长对白或原附件全文。报告的桥只有固定数据读取，不能下单。


## 原生引擎接入（NautilusTrader 1.231.0）

正式撮合真实调用 BacktestEngine、QuoteTick、OrderFactory MARKET / STOP_MARKET、BID_ASK trigger、FillModel 与 JPY FeeModel。不是只 import 版本后手写撮合。H1 的 open/high/low/close 不进入正式撮合；当前 profile 仅接受真实 quote ticks。**没有 H1 fallback；M1/缺库/报价不适配则拒绝或暂停，不展开成伪 tick。**

### 生产导出与提交边界

```js
import {createRun, snapshot} from './engine.js';
import {prepareNative, nativeStatus, advanceNative} from './native-engine.js';

// 用户明确准备时：唯一可下载安装依赖的入口。
await prepareNative(storageDirectory, {signal});
// 只读状态/导入/版本校验：不安装、不启动撮合、不推进资金。
const environment = await nativeStatus(storageDirectory);
// service 先 reserve run/version/request，再 await；完成后才原子 CAS。
const candidate = await advanceNative(storageDirectory, state, decision, data, {signal});
// 检查 cancellation、reserved token、expected version；service 自行 CAS candidate。
```

三个 native API 均 async。createRun/snapshot 保留同步 JSON account/state mapper 接口，默认已绑定 native rules；原 H1 参考撮合改为显式 `decideReferenceAndAdvance`，正式 service 不调用它。advanceNative 返回同 shape 的完整 JSON state（含原 ledger/fills/orders/decisions/history/equity、nativeJournal/receipt/lastQuote），不改变输入，不写 run store、不自动调用模型或发券商订单。**完整持久化 nativeJournal 和规则/checkpoint，不能只保存 balance 或 snapshot。**

下一步执行范围固定为 data.frames[state.chapter][state.index+1] 的 UTC H1 区间 `[next.time,next.time+3600000)`；源查询 inclusive 上界为 next.time+3599999。成交开盘用该区间首个实际 quote 的 bid/ask 和真实时间，不用 future high/low。以前已消费 native 决定可由同 hash 数据/顺序冷重放并核对 checkpoint；正常相邻步复用驻留引擎，不每步重放全历史。缺数返回 missing_data 候选，不扣费、不新增 decision、不推进 version；其他拒绝、依赖错误或取消抛错，service 保留旧账本并暂停，不回退参考撮合。

### 与 data.loadExecutionSlice 的字段协定

调用：`loadExecutionSlice(storageDirectory,{chapterId,symbol,from,to,maxRows:500000})`。期待返回：

```js
{
  chapterId, symbol, from, to, // 精确等于请求，UTC 毫秒 inclusive range
  rangeConvention: 'inclusive UTC milliseconds',
  kind: 'ticks',
  rows: [{time: from, bid: '100.001', ask: '100.021', source: '原始来源标识（可选）'}],
  sources: [/* 实际冻结来源/sha256/身份 */],
  historicalGaplessnessCertified: false
}
```

时间允许非递减，同毫秒多行不去重、不重排。Nautilus 内部 ns=`sourceMs*1000000+同毫秒序号`；真实 time 保持源毫秒，nativeEventNs 标 internalOrderingOnly，不能说数据有纳秒精度。正数 decimal strings、非 crossed、真实 instrument tick 倍数；stop 必须精确对齐 tick，拒绝静默舍入。M1 kind（包括 m1_bidask）不受当前 profile 支持；对账/拒绝是明确边界，不存在伪造细粒度执行。

EURCHF 另外请求 CHFJPY 的至多60秒 lookback 至本区间末（不得早于 playFrom）。每个 main event 选择 `fx.time<=event.time` 的最后已知双侧报价；max age 固定60000ms。主/FX 独立流保持其原顺序；同毫秒取该 FX 流最后记录，不虚构独立流的更细物理顺序。没有可用 FX、超龄或数据缺口则整个候选暂停；不取未来 FX，不填固定汇率。conversionTimeMs/age、rate/来源证据进入 closedLots。数据 chapter 需提供精确 `weekendGaps:[{from,to}]`，只接受实际 UTC 周五→周日 H1 整点48..50h；仅 closedHours/allowWeekendGap 不构成豁免。

### Fee / conversion / margin 的实际适配边界

- Native：QuoteTick 撮合与 STOP_MARKET trigger；买 ask／卖 bid、无额外 tick 滑点；真实 native OrderFilled IDs/价格。每侧 `3 JPY/1000 基础单位` 通过 JPY FeeModel产生并进入适配账本，不再额外扣一次点差。
- Adapter：Decimal/FIFO 精确 JPY 账本；CHF 盈利用最新已知 CHFJPY bid、亏损用 ask，margin 用 ask；每章500/0.2、25/0.5、25/0.3的准入/stopout；模拟每跨 UTC 日 `10 JPY/1000`，只在实际已消费 quote 时间之间收费，不推进到虚构 H1 end，不是历史 broker swap。
- Native account 为 frozen JPY/MARGIN/NETTING，native risk bypass。**挑战账本是权威，原生账户总额不是挑战余额**；receipt 查询 nativeFrozenBalanceJpy。已实测原生cash保持300000而挑战cash294000、margin800080仍可按挑战equity获准原生成交。不能混称“原生券商保证金验证”。
- 历史 quote 深度未知：明确 `unbounded_top_of_book` 的 L1 模拟假设，Native quote size为人工足量；不声称历史大仓位可成交。complete只指verified本地slice的实际全部返回行，保持 historicalGaplessnessCertified=false，不证明历史逐笔无缺口。
- 旧 stop/风险先于目标变更；破产保留负余额并立即截断未消费 quotes 和未来费用；三章真实quote强制flat继承资金，最终第三章flat才判胜。Controller snapshot不含未来quotes/nativeJournal；service终止DTO也必须截在真实终止time，不传未完成H1全根OHLC。

### 私有环境、恢复与验证

已确认 macOS arm64 + Homebrew Python3.13.12 有兼容 wheel。系统3.9.6不适用且未修改；不要求必须3.12。prepareNative创建 `<storageDirectory>/kurumi-native/venv`、固定官方wheel版本/sha256，只在该venv用 isolated/no-index/no-deps 安装确切已校验wheel；安装前检查 private prefix，拒绝venv目录symlink，禁止system pip。Import/nativeStatus/advanceNative均不下载安装。

Quote files为私有 immutable hash refs，正常journal不重复携带全部历史ticks。取消杀本模块注册worker，不提交候选；恢复由明确新请求从已消费journal重建，不自动付费重发。当前模块另提供disposeNative供主侧生命周期清理。详细输入约束、预算、规则、验证与性能见 RULES.md。

当前原生+参考测试完整 **54/54通过、exit0**；包括同毫秒、FX as-of、三章、止损跳空、缺数、取消、CAS拒绝后冷重建、FIFO、native frozen账户边界及owned worker生命周期清理。均为明确合成fixtures的真实Nautilus执行，不是历史数据验收。实际3000quotes/H1连续3步的journal为997/1993/2989B，报价文件累计214891/429782/644673B；后两步无历史重放，避免全历史ticks平方复制。真实历史与宿主安装/CAS/角色/报告验收仍由主Agent完成。

观察时钟：若原生引擎在H1中途破产，公开时钟截断在最后消费的真实报价；该H1完整OHLC不再公开，报告/指标不泄漏剩余小时，精确成交仍在模拟账户账本，未闭合H1上的图形标记可能不显示。

## 开发期恢复与界面实例边界

main_tool_names声明十一个主控工具；主/子作用域工厂始终返回清单完整十三项，角色请求allowlist仍只有observe/decide，主控处理器再次拒绝非主作用域。
所有异步layout调用均await。首次指标挂载不指定实例ID，读取宿主返回的当前图表script_ids，再inspect核对；后续只替换该图表仍存在的已登记实例，删除图表后不沿用旧实例。显示失败返回错误，不宣称已绑定；不安装进程级unhandledRejection handler。重入合并同一次显示，UI记录与挑战账本分离，不使资金或推进CAS失效。
源码单测与已安装真实角色/客户端回执分层验收。宿主的启动预检、异常隔离和坏包恢复由宿主提供，本包不能替代；旧宿主边界须另行核验。
网络诊断可显式启动node --use-env-proxy scripts/verify-network.mjs <已有插件storage> <诊断输出目录>，只在该进程复用环境代理，保留TLS校验。只GET指定6162字节公开样本并核摘要/973 ticks，不修改原挑战HTTP来源摘要、ready标记、资金或现有数据。429有界暂停，不改系统代理或降级数据。

### 0.1.1-dev.2：环境复用与保存决定恢复

正式环境以固定 `receipt.json` 与真实隔离 Python probe 为事实：私有 prefix、Nautilus BacktestEngine 导入及全部十五项准确版本同时通过。runtime-adapter 与 native-engine 使用同一验证函数；不因仅有回执就宣称 ready，也不为旧 receipt 捏造 environment.json。environment.json 仅保留对早期独立 native-engine 测试准备的读取兼容，正式 adapter 仍要求固定配置摘要。已有 receipt probe 失败时不自动重装/下载。

每次付费 `agents.submit` 前必须先 probe 后端；失败暂停，由主 Agent 显式 `kurumi_prepare`。已有挑战 prepare 只复用环境和 loadData，核对原来源，不重新采集行情。

`kurumi_recover {command_id, expected_version, decision_id}` 是 main-only 恢复接口，仅允许当前 run/step/version 的 failed_not_committed 原决定。核对原真实宿主 task/request 身份、终态与 failed decide 工具证据，确认引擎该步没有提交，持久预约后调用真实 adapter，CAS 提交一个 H1。原失败 evidence/error 和 task 证据保留，另记恢复记录；不创建新模型任务或伪造角色授权。暂停、关闭或版本变化阻止提交；中断预约需显式 reconcile。稳定 command 幂等，不自动重试。

### 0.1.1-dev.3：中断恢复显式核对与短状态 DTO

恢复预约持久化原引擎版本、原决定ID、Run/step、原决定/成交数量、余额和固定来源。应用/插件重启只标 `recovery_requires_reconcile`、保存中断证据，不执行撮合、不启动角色。
`kurumi_reconcile` 以持久挑战账本（而非 native 候选缓存）为准，并进行精确金额对账：
- **未提交**：原版本/游标及账本数量/余额不变，该步无提交；保留原决定、原错误与中断记录，解除占位。要执行原决定须用新 `command_id`、最新 revision 显式 `kurumi_recover`；旧操作ID不自动重试。
- **已提交**：找到完全相同的原决定及有效提交版本；返回 committed 事实，解除旧占位，但不改变引擎、成交或资金。
- **不确定**：身份/版本/来源/财务账本冲突，保留占位，返回 unknown 和导出/核对诊断，start/recover/prepare 仍拒绝。运行中的恢复不能 reconcile。
关闭后的旧异步回调不访问已关闭 Store，不删除重启预约、不覆盖后来核对的证据。prepare 也拒绝活跃及待核对 recovery。
status/recover/prepare 的 nativeEnvironment 只返回 ready、引擎/版本、固定配置摘要和必要私有路径/诊断；完整依赖、wheel 许可证仍在私有 receipt 和固定导出 artifact，不删证据。
测试：`tests/recovery-store-host.test.mjs` 使用真实 Store 关闭/重开与隔离 DEMO 财务引擎验证中断、已提交、unknown 及重复 reconcile/recover，零网络/零角色调用；它不是历史原生撮合验收。真实 receipt-only 环境与实际 adapter quote 撮合另由 `tests/runtime-adapter-host.test.mjs` 验证。
