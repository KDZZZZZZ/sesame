# 数据、时间与来源边界

这是非官方二创模拟挑战，不连接券商，不含行情附件、拟合价格或原作资金。原作对照仅在独立观众模块中；不得向角色整体传递 `loadData()` 返回值、此文件或观众资料。

## 固定真实来源

提供方 Dukascopy；本任务显式选用公开行情入口 `http://datafeed.dukascopy.com/datafeed`；HTTPS canonical 入口仍为 `https://datafeed.dukascopy.com/datafeed`。HTTP 行情正文未经 TLS 认证，SHA256 只绑定实际保留的字节，不能证明原点身份。只有服务器明确 301/302/307/308 要求同域、同路径 HTTPS 时才跟随一次，并保存两段 URL 和实际协议；HTTPS 跟随失败后不继续重试。依赖 tarball 始终使用固定 HTTPS。固定解码器 `dukascopy-node 1.46.4`（版本、公开提交、依赖 tarball 完整性、许可与各品种窗口见 `data-windows.json`）。UTC；原始请求 URL、HTTP 状态、获取时刻、原始 BI5 字节 hash 与解析块 hash 保留在私有快照与导出来源中。`preparedAt` 是获取时间，不是市场时间。不同品种或 bid/ask 来源不会自动合并身份。

- 三章的范围在配置文件明确固定；H1 预热来自真实月度双侧报价。
- 玩法区间使用逐小时原生双侧 quote tick。H1 是由这些真实报价聚合出的观看数据，**不是撮合 tick**。
- **正式路径只接受 `quote_ticks`**。固定 NautilusTrader `1.231.0` 不接受 M1；超过明确 1024 MiB 保留预算或 32 MiB 投影安全预留时暂停为 `QUOTE_TICK_BUDGET`，保留已验证断点，**不下载 M1、不返回可玩 ready**。H1/M1 都不能展开成伪 tick。
- 行情时间是 UTC 毫秒；同一毫秒可有多条真实报价，保留原始来源顺序。成熟引擎内部稳定排序的纳秒只是内部序号，不冒充来源纳秒精度。
- EURCHF 与 CHFJPY 保留独立真实来源。逐笔估值只取本时钟之前最后已见 CHFJPY，固定最大 age 60000ms；原始 FX 时间与 age 保留。没有已知、未过期换汇报价即暂停；不选未来报价、不插值、不伪称每笔有恰好同毫秒的原始 FX tick。这个同步规则是明确的模拟适配假设。

## 不泄漏未来

初始 Dashboard 可以显示真实 `playFrom` 之前的已闭合 H1 预热。品种目录、分页、订阅和范围读取均不得读取当前已揭示 index 之后的价格。角色只收有界已闭合 H1、当前模拟账户和已发生摘要；每根价格字段白名单投影，不带源文件路径、原剧情、细报价数组或未来章节。

缓存中允许为主控制器准备完整未来真实历史；准备缓存不等于揭示或成交。章节间跳过的月份既不收益也不补款。章末真实强制平仓后再开始下一章，破产保留负余额并停止付费角色推进。

## 完整性与暂停

配置声明了准确的 UTC 窗口与外汇周末 convention；这不是经过认证的券商交易日历。必须保留 bid/ask 与所需 FX，两侧或换汇缺小时、hash 改变、块缺失、未解释的缺口都暂停，不补值。`completeAgainstDeclaredCalendar` 和细切片完整意味着已完整读取已验证本地返回文件，**不能证明原提供方历史逐笔无缺口或真实可成交容量**。

财务量为 Decimal 字符串；未知成交量为 none/null，不补 0，也不将报价 volume 冒称真实成交量。真实 bid/ask 点差在成交中体现，不重复扣除点差。成熟引擎的 L1 无限可得量是明确挑战假设，不声称 Dukascopy 历史盘口容量。

## 本机环境与导出

仅显式 `kurumi_prepare` 下载、安装。加载、查看状态、创建页面不安装依赖。私有市场缓存最多 1024 MiB；固定成熟引擎 wheels、venv 与原生已消费报价检查点目录最多 1536 MiB，总保留上限 2560 MiB。已知固定 Mac arm64 / Python 3.13 wheels 在 `native-dependencies.json`，逐文件核验 SHA256。不 clone 引擎源码、不使用系统 pip、不更换正式 App 模型。

`kurumi_export` 冻结已揭示行情、账本、角色证据与原生检查点，返回完整 data/resource 引用；主 Agent 可直接绑定现有 reports 插件解说。对账必须从 300000 JPY 加实际实现盈亏扣实际手续费和融资复算；原作数字不得进入账户。合成 fixture、原生库实测、真实行情、真实模型和 Dashboard/报告渲染验收分层记录，不能互相替代。


## data 模块交接（控制器/engine 使用，不是角色输入）

公开 ESM 模块为同包 `data.js`，只用 Node 标准 API，不 import 宿主私有模块：

- `prepareData(storageDirectory, {signal})`：仅在明确允许安装与取行情的工具调用中运行。必须覆盖配置中所有三章、四条品种流；全量源文件、逐小时覆盖、SHA256、Decimal、固定 UTC join 与清单全部检查后才以 atomic rename 发布 `state.json`。失败会抛带 `paused:true` 的 `DataPausedError`，不能用缓存数量推断可玩。
- `loadData(storageDirectory)`：纯本地，不安装、不联网。返回 `storageRoot/storageNamespace/chapters/frames/execution/digests/provenance`，`chapters`数组及每章对象不可写；leverage/stopout为冻结Decimal字符串，整体仅可交控制器。
- `viewingFramesAt(data,{chapterId,asOf,maxFrames=168})`：仅返回 `frame.time+3600000<=asOf` 的已完成小时，剥离未来帧、逐笔、来源路径、观众锚点。每个 EURCHF H1 `fx.time===frame.time`，三位 CHFJPY Decimal 与五位 EURCHF Decimal 保持各自精度。
- `loadExecutionSlice(storageDirectory,{chapterId,symbol,from,to,maxRows})`：UTC 毫秒**闭区间**，默认最多100000行，硬上限500000；范围过大要求缩小，不 silently drop。返回原始同毫秒稳定顺序及真实文件/块 hash，无报价 `NO_QUOTES`。`symbol` 缺省取本章主品种，CHFJPY 是独立流。
- `loadNativeStep(storageDirectory,{chapterId,from,to,maxRows=500000})`：正式 engine **半开整小时** `[from,to)`，要求 `from%3600000===0`、`to===from+3600000`。返回 `{quoteTicks,coverage}`，直接适配 native-engine.js 的 `options.quoteTicks/options.coverage`。不调用 native 引擎、不发订单、不收费。控制器须在调用付费角色/模型前核验所需切片，失败就暂停；逐笔及未来切片仍不得传给角色。
- `clearData(storageDirectory)`：显式清理，仅删 `kurumi-data-v1` 自有内容，保留调用者同级文件；加载缺文件时不自动下载或 clear。

数字 `chapterId` 为1/2/3；不要误用 native state 的0基 `chapter`。正式调用示意：

```js
import { loadData, loadNativeStep, loadExecutionSlice, viewingFramesAt } from './data.js';
import { advanceNative } from './native-engine.js';
const data = await loadData(storageDirectory); // 必须已有完整 ready
const frames = data.frames[state.chapter];
const next = frames[state.index + 1];
const step = await loadNativeStep(storageDirectory, {
  chapterId: data.chapters[state.chapter].id,
  from: next.time, to: next.time + 3600000,
});
// step 保留在控制器；绝不能传给付费角色。
// 现行service正式走async advanceNative，默认动态读取data.js loader。
// 上述step可在付费模型调用前用于预检；逐笔始终留在控制器。
const advanced = await advanceNative(storageDirectory, state, decision, data, { signal, loadExecutionSlice });
// CAS/账户/engine checkpoint 由 service/engine 负责。
```

`quoteTicks` 的元素为 `{time:UTCms,bid:Decimal,ask:Decimal,source}`；第三章另有 `fx:{time,bid,ask,source}`。FX 是 `time<=main.time` 的最后真实 CHFJPY，同毫秒取该 FX 流原顺序最后一笔；age固定<=60000ms。缺失或 stale 抛 `FX_STALE`，不使用未来 FX、不补值、不插值。**H1 的 fx.time 必须精确等于 H1 time；逐笔的 FX time 不假装同步，应保留原始 as-of 时间。**

`coverage` 另保存冻结 `snapshotDigest/configDigest`，主品种和FX必须相同版本；切片末尾重查state防止混入新快照。`coverage` 为 `{from,to,complete:true,dataKind:'quote_ticks',liquidityAssumption:'unbounded_top_of_book',fxMaxAgeMs:60000,sourceFiles,...}`。complete 只证明本地所需文件与选择的记录已验证，不认证提供方 tick 无历史缺口；报价量不代表成交容量。`sourceFiles` 的 `url/transportScheme/tlsAuthenticated` 指向实际成功 GET，HTTP 来源始终 `tlsAuthenticated:false`，不可称为“HTTPS 已验证”。

**bootstrap 请 engine 同事确认：** H1 time 是开盘标签，OHLC 只能在该小时结束后给角色。`startIndex` 标记 playFrom 的第一根玩法 H1；若决策时钟从 playFrom 开始，角色只能看其前一根预热小时，第一段撮合应从 playFrom 开始。不能在 playFrom 直接揭示这一小时的收盘；当前 next-frame adapter 的初始 index/决策时钟对齐仍由 engine/service 验证。

### 周末精确缺口是冻结清单的一部分

`loadData().chapters[i].weekendGaps` 为 `[{from:上一根实际bar.time,to:下一根实际bar.time}]`。只允许已观察到周五->周日、48..50小时，且所有中间缺小时均符合配置的固定 UTC FX convention。夏季 Fri20->Sun21、冬季 Fri21->Sun22 可为49小时。工作日缺小时绝不生成休市 gap。EURCHF/CHFJPY 必须同 UTC H1 严格 join；任一侧缺该小时即暂停。

同样记录固定在 `download.json.chapterCoverage`、发布 `state.json.chapterCoverage` 与 `provenance.coverage.chapters`，重新读取时从 hash-bound 实际 H1 再计算并逐项比较。没有完整 state 时不会为了展示一小段而发布预览 ready。

## 私有目录、代理与有限恢复

- 原生文件粒度为月度双侧H1、小时双侧tick。原始月文件可包含请求窗口之外的数据，仍逐字节保留；投影与角色切片严格按UTC窗口裁剪，不让原文件覆盖范围冒充可揭示范围。
- 全部数据与固定25包依赖都在调用者 `storageDirectory/kurumi-data-v1/`，包括 `deps/`、`dependency-cache/`、`http-cache/`、`snapshot-UUID/`、`state.json`；包内无 node_modules 或行情。
- 1 GiB 核算所有 retained regular-file 字节，含依赖、原文件缓存、stage 复制、gzip 投影、收据和清单；非文件系统 block quota，也不能抵御外部并发写入。成功 ready 原文件和 HTTP 缓存可能各占一份，均计入预算。
- 单网络逻辑对象至少间隔250ms；已验证缓存复用不需要网络限流等待。每次GET最多30秒，通常最多4次，退避1/2/4秒；Retry-After是下限，允许等待至120秒，超过即写 cooldown 暂停而非提前重试。HTTP server-required HTTPS 跟随最多一次，跟随失败立即暂停，无重复 HTTPS GET。
- 工作者继承原有 HTTP_PROXY/HTTPS_PROXY/NO_PROXY（及小写形式），用原生 `--use-env-proxy` + 子进程 `NODE_USE_ENV_PROXY=1`。仅在子进程移除会遮蔽有效大写配置的空小写变量；不修改父环境、Clash、OS代理或 TLS 设置。有代理而 Node 不支持原生环境代理时 `PROXY_UNSUPPORTED`；`NODE_TLS_REJECT_UNAUTHORIZED=0` 被拒绝。
- 缓存是 whole-object，不复用截断body。收据验证请求/实际 URL、200状态、正大小、获取UTC时刻、SHA256、BI5/LZMA解压预算。成功对象跨失败/取消保留，stage投影可重建。损坏/错配收据暂停；无收据 body 或未完成 tmp 不是市场证据。取消覆盖依赖和行情 worker，不启动角色。
- 固定 `dukascopy-node@1.46.4` 为 MIT、源提交 `4bb92bcbcd2edf7c7d75783173f1dae40bee7ef4`；其余24包各自版本、tarball URL、SHA512、许可均在配置。不运行可变 npm/npx、不运行安装生命周期脚本、不 clone 源码，不降低 TLS 验证。

## 本轮真实验收：仍未完整 ready

以下是 data 助手本轮实际执行，不替代 engine、宿主安装、模型或渲染验收。

真实存储：`/tmp/kurumi-data-http-prepare-gV1Cze`。第一轮使用 OS临时目录，后移至此路径，保留原文件字节与收据。固定依赖从此前真实核验的离线缓存复制并逐文件复验；不是本轮25次 HTTPS 下载成功。

| 实际 prepare 调用 | 耗时 | 本轮 GET attempts | 本轮读到正文 bytes | 复用对象 | 累计有效文件 | 结果 |
|---|---:|---:|---:|---:|---:|---|
| `verification-http-1.json` |354696ms|308|4375350|0|300|AUDJPY May30 04h 网络失败4次，暂停|
| `verification-http-2.json` |213793ms|208|2404351|300|503|EURCHF Jan16 20h 暂停|
| `verification-http-3.json` |17862ms|4|0|503|503|同一 HTTP 重定向尚被旧error模式误分类；没有ready|
| `verification-http-4.json` |11942ms|2|0|503|503|修正后HTTP 301 + 单次同域 HTTPS 429，停止而非重复TLS尝试|

计划完整负载为8个原生H1文件+615个tick小时文件=623个，正式政策 M1请求数为0。**实际有效503个，原文件正文累计6779701 bytes**：AUDJPY311（2 H1+309 tick）、USDJPY72（2+70）、EURCHF118（2+116）、CHFJPY2（仅预热H1）。每轮失败均 `statePublished:false`、stage已移除；尚缺 EURCHF最后2个tick文件与CHFJPY118个tick小时。不得让控制器/角色把这些部分缓存当完整三章。

具体阻塞 `http://datafeed.dukascopy.com/datafeed/EURCHF/2015/00/16/20h_ticks.bi5`；实际HTTP301指向同路径HTTPS，唯一跟随GET返回429。网络权限不是问题；此处需要真实来源访问恢复。没有自动换提供商、M1、伪报价、全局代理修改或TLS放宽。

助手独立成功GET的SNB文件 `http://datafeed.dukascopy.com/datafeed/EURCHF/2015/00/15/09h_ticks.bi5`，observedAt `2026-10-11T07:22:28.118Z`，6162字节，SHA256 `3c8a29abfba0ffff4d7d40f70d9968fb6514136419dc0c6949ed638cad82a148`，与协调者之前实取body一致。固定公开解码器确实解出973笔，首UTC09:00:06.042 bid1.20094/ask1.20102，末09:59:11.782 bid1.02542/ask1.02857。这证明一个具体HTTP文件可用，**不证明整个窗口、TLS认证或正式引擎完成**。

最终完整测试为52项、51通过、0失败、1跳过（完整 prepared-source opt-in 因未ready跳过），含真实固定依赖树、固定公开解码器与上述真实BI5；其他手写报价/HTTP fixture 均明确为合成单元输入。最终语法检查与完整测试均已退出0；duration_ms=1293.157542，完整输出在 `final-tests.log`。真实BI5 opt-in 使用本助手成功GET的私有缓存 body（非合成输入）；完整prepared-source仍因未ready跳过。没有提交或发布。


### 追加 HTTPS/环境代理复核（协调者 HEAD200 后）

没有改变 Clash、节点、系统代理、父进程环境或市场TLS设置，没有安装额外代理库。

- 同 prepare 子进程环境：Node25.2.1，`--use-env-proxy`、子进程 `NODE_USE_ENV_PROXY=1`，使用原有非空 http_proxy/https_proxy，保留原 NO_PROXY 规则。初次实际HTTPS GET最多2次：第一次 `UND_ERR_CONNECT_TIMEOUT`，第二次HTTP429，12811ms，无成功body；`verification-https-probe.json`。
- 同环境 curl 的实际GET返回HTTP/2 429，113字节JSON，耗时1.325573秒。内容为 `Too Many Requests`，并指向提供方 data-export 文档，不是6162字节的BI5。没有把这113字节登记成行情；`verification-curl-https-get.json`、`curl-https-get.headers/body`。
- Node HEAD本次也是429，4378ms；这与协调者之前HEAD200是不同请求时刻，均不证明GET成功；`verification-node-https-head.json`。
- 新增可复用只读诊断worker `scripts/check-market-transport.mjs`，固定唯一公开SNB文件，只复用已验证依赖，不安装。实际等候60000ms后单次GET仍连接超时，合计70992ms；被动 Node diagnostics_channel 确实观察配置代理端点连接和代理端口socket，不输出代理地址/认证值。证据 `verification-transport-worker.json` 中 `configuredProxyConnectSeen:true,connectedProxyPortSeen:true`；这是实际沿用代理的观察，不是仅根据环境变量猜测。
- 新增本地HTTPS CONNECT regression：仅对合成local fixture的第一个子进程信任临时测试CA，第二个不信任CA的子进程确实拒绝证书；两次均实际经过本地CONNECT代理。未关闭 `rejectUnauthorized`、未设 `NODE_TLS_REJECT_UNAUTHORIZED=0`，市场worker从不接收测试CA。

结论：不能将当前GET失败简单归为“Node没用代理”；curl GET也限流，源访问暂态/服务端限制仍存在，但没有证明是永久阻断或权限不足。新证据并未新增成功HTTPS行情。此前503个HTTP原文件/摘要继续保留，完整state仍未发布。HEAD200不会替代GET/摘要/解码，诊断单文件success也不等于三章ready。

诊断调用应由主控制器spawn子进程（与prepare一致的env标准代理归一化），参数为：`node --use-env-proxy scripts/check-market-transport.mjs <existing-storageDirectory> [waitMs<=120000]`，同时仅子进程 `NODE_USE_ENV_PROXY=1`。最多一次网络GET且遵守缓存cooldown；成功才记录实际HTTPS URL、SHA、973条、首末UTC与Decoder。失败会保存精确错误，永不伪造body、不启动角色。


## 最新 async native-service 交接：规则、wire shape、根目录、prepare期限

### 三章冻结规则（不是当前券商账户设置）

| chapterId | symbol | leverage | stopout（equity/used margin比例） |
|---:|---|---|---|
|1|AUDJPY|`"500"`|`"0.2"` = 20%|
|2|USDJPY|`"25"`|`"0.5"` = 50%|
|3|EURCHF|`"25"`|`"0.3"` = 30%|

规则写入 `data-windows.json`，经 configDigest、download.chapterCoverage、state.chapterCoverage、loadData.provenance.coverage 固定。`loadData().chapters`及每个章对象 `Object.freeze`，角色安全H1 view也带**本章** leverage/stopout；model observe应读 `state.chapters[state.chapter]`，不能全程硬编码25倍/50%。比例是Decimal字符串，**不能把0.2解释成0.2%**。这不是实盘账户授权或broker杠杆证据。

### `loadExecutionSlice` 正式协议

- 输入 `from/to`为UTC毫秒**inclusive**，筛选 `from<=row.time<=to`。整小时应传 `to=from+3600000-1`；不传exclusive上界来读下一小时第一笔。同毫秒多tick保留真实原顺序，无报价暂停。
- 为直接兼容现行 `advanceNative`，正式wire返回 **`kind:"ticks",dataKind:"quote_ticks"`**；存储清单 `execution.summary.kind`及每个chunk.kind仍是 `quote_ticks`，native coverage.dataKind仍是quote_ticks，不能把仅名称alias当分辨率变化。
- Tick row是 `{time:UTCms,bid:固定精度Decimal字符串,ask:固定精度Decimal字符串,source:原文件相对路径}`。JPY三位、EURCHF五位。`rows/sources/snapshot/snapshotDigest/configDigest/chunkDigests/storageRoot/storageNamespace`随切片返回。sources有实际URL、SHA256、字节数、observedAt、协议/TLS标签。
- **非正式旧M1 schema**：`{time:UTC整分钟,bid:{open,high,low,close},ask:{open,high,low,close},source:[bid原文件相对路径,ask原文件相对路径]}`，OHLC仍为固定精度Decimal。旧内部名m1_bidask，**本版prepare/load不会返回它作为ready**；Nautilus1.231.0拒绝M1，不可展开伪tick。网络/超时不降M1；预算也仅暂停QUOTE_TICK_BUDGET，保留断点，不伪报native可玩。
- CHFJPY仍是独立真实流，正式native从 `max(playFrom,from-60000)` 开始读，做as-of而非未来同步。H1则严格同小时join并保留fx.time===frame.time。

**路径**：所有API的 `storageDirectory`传**调用者plugin-private base绝对路径**，不是包目录，也不是已经追加 `kurumi-data-v1` 的子目录。数据实际根 = `storageDirectory/kurumi-data-v1`，返回 `storageRoot`为OS规范化路径（macOS /tmp可能显示/private/tmp）。sources.path相对这个数据根，不是native根。Native自己的 `storageDirectory/kurumi-native` 为同级兄弟；所有API使用同一个base，不要把native根交data loader。

当前验证base `/tmp/kurumi-data-http-prepare-gV1Cze`，实际data根 `/private/tmp/kurumi-data-http-prepare-gV1Cze/kurumi-data-v1`。不要把这台机器路径硬编码进宿主；生产用host提供的storageDirectory。

### 25分钟显式prepare预算（不增加并发）

统一常量 `PREPARE_TIMEOUT_MS=1500000`（25分钟），配置 `preparation.timeoutMs`相同。依赖与行情worker都使用**从prepare开始计时的剩余预算**，不会每个阶段重新给25分钟；发布前再检查期限/取消。耗尽SIGKILL子进程、清失败stage、留已验证HTTP断点，暂停且不换源/补价/M1。现行实现此前实际是60分钟guard，现已收紧为<=25分钟；父会看到的旧300000ms不能用于正式全窗。

依据是本模块实际首批300个对象已354696ms，第二轮203个新增213793ms；累计503个成功文件，两轮568489ms。按此次完整固定计划623个唯一文件（8原生H1+615 tick，重试可增加attempts）说明5分钟不足，但这**不是保证剩余来源恢复后25分钟一定完成**。当前429不增加并发，维持串行及非cacheGET最小250ms间隔；依赖仅显式prepare时下载。

父会负责最终宿主prepare全窗口。调用宿主显式prepare需>=25分钟工具预算或受管理异步任务；不要使用最多600秒的shell调用后就声称整窗成功。本模块不修改宿主工具超时设置。

### 已运行真实小窗口local-load验收（不发布预览ready）

新增**显式** `loadExecutionSlice(...,{diagnosticOnly:true})`，仅从此前真实GET且URL/HTTP200/摘要匹配的本地完整小时原文件读取，依赖必须已安装且树hash已核验；没有state时不联网/不安装/不写快照。只允许同一小时范围，返回 `kind:"inspection_ticks",dataKind:"quote_ticks",formalReady:false,complete:false`，故现行native要求 `kind:"ticks"` 会拒绝它。默认没有这个flag时，仍必须已有完整三章state。

实测 EURCHF 2015-01-15 09h小时闭区间：[1421312400000,1421315999999]，973笔，6162原文件字节，SHA256 `3c8a29abfba0ffff4d7d40f70d9968fb6514136419dc0c6949ed638cad82a148`。首09:00:06.042 bid1.20094/ask1.20102，末09:59:11.782 bid1.02542/ask1.02857；`from===to===首真实tick UTCms`确实只返回该毫秒1笔。超972行预算抛SLICE_LIMIT；首tick之前范围抛NO_QUOTES；回归测试封禁fetch且统计网络调用0，无安装/新state。独立两次实际load约345ms，receipt `verification-small-window.json`。

该成功只证明**真实cache->public pinned decode->bounded inclusive local slice**，不是新HTTPS GET成功、完整loadData成功或原生成交成功；default loadData仍NOT_PREPARED。父会完成全窗后可设 `KURUMI_REAL_STORAGE` 跑正式opt-in测试，核验三章frozen规则、实际source hash、每帧H1/FX time及formal ticks wire shape。`KURUMI_REAL_CACHE_STORAGE`仅打开这个明确partial/non-ready诊断测试，不替代上述完整验收。


真实换汇缺口：仅主 Agent 在缺数暂停且无活跃角色时，可用 kurumi_import_fx_supplement 显式导入已核验的 HistData CHFJPY Generic ASCII tick 补充包。包须绑定当前 runId、原 snapshot/config 摘要与未提交时段；原 ZIP、CSV、投影和清单双副本留档。原直接报价在60秒内始终优先，只在缺失或过期时选择补充源的过去真实报价；60秒上限不变，不插值、不更改已提交小时。导入不推进账户，之后使用最新revision、唯一command_id显式continue恢复原continuation。该补充来源必须在最终报告中披露，不得称为原 Dukascopy 原始行情。
