# 数据、提供方、成果、运行记录与 SVL：接口形状和宿主处理

以 `E:/brief2great/sesame/mt5agent` 当前源码为准。`?` 表示可选；`Promise<T>` 表示异步结果；同一行中的 `A / B` 为多个独立方法。类型名是为说明而收敛的别名，不声称宿主导出了同名 TypeScript 类型。

## 1. 共用引用与数据形状

```ts
type ProviderRef = { pluginId: string; providerId: string };
type PluginRef = { id: string; version: string; digest: string };
type ConnectionRef = { id: string; revision: string };
type InstrumentRef = { sourceId: string; instrumentId: string };
type AccountRef = { connectionId: string; accountId: string };
type ArtifactRef = {
  id: string; revision: string; digest: `sha256:${string}`;
  kind: string; schemaVersion: "1.0.0";
};
type BlobRef = { digest: `sha256:${string}`; size: number };
type RecordRef = { id: string; kind: "strategy.run"; version: number };
type Decimal = string; // 非指数十进制字符串
type SourceTime = { basis: "utc"; unixMs: number; raw?: string }
  | { basis: "wall"; value: string; authority: string; zone?: string; fold?: 0 | 1 };
type TimeRange = { from: SourceTime; to: SourceTime }; // [from, to)
type PageRequest = { limit: number; cursor?: string };
type Page<T> = { items: T[]; nextCursor: string | null; snapshotId: string;
  consistency: "snapshot" | "best_effort" };
type Value<T> = { status: "value"; value: T }
  | { status: "unknown" | "unsupported" | "not_applicable"; reason?: string };
type ReadResult<T> = { data: T; meta: {
  observedAt: number; freshness: "live" | "delayed" | "stale" | "unknown";
  origin: "observed" | "user_input" | "derived" | "demo";
  consistency: "atomic" | "bounded" | "best_effort";
  samplingWindow?: { from: number; to: number }; // bounded 时必填
  sourceTime?: SourceTime; warnings: object[];
  provider: ProviderRef; instanceId: string; connection?: ConnectionRef;
  receivedAt: number; // 此行和上一行由宿主补写
} };
```

源码：[引用、时间、ReadResult 校验](E:/brief2great/sesame/mt5agent/modules/plugins/protocol.js:36)；契约类型：[宿主协议](E:/brief2great/sesame/mt5agent/docs/plugin-api-v1/host.md:149)。

## 2. host.providers：注册、绑定、调用和订阅

| 接口形状 | 返回 | 宿主处理逻辑 |
| --- | --- | --- |
| `register(descriptor, implementation)` | 异步 `dispose()` 函数 | 仅 service 激活时；检查插件清单已声明对应 `provides`，契约为 market/account、版本含 `1.0.0`、能力唯一且必需能力完整；每个声明能力必须有实现方法。分配 provider 实例 ID，登记内存表，广播变化；注销时先撤销入口，再关闭绑定/订阅、调用实现的 dispose。 |
| `list(contract?)` | `Array<descriptor & {plugin:PluginRef, pluginId, instanceId, version:"1.0.0"}>` | 返回当前活跃 provider 的描述快照；可按契约过滤。 |
| `bind(ref:ProviderRef, input={connection?:ConnectionRef, configuration?:object, ...}, signal?)` | `Promise<{...实现返回, bindingId, provider:ProviderRef, instanceId, version, connection?}>` | 验证 provider 活跃、输入预算；声明连接必需时校验精确 ID/修订；调用 `implementation.bind(input,{bindingId,signal})`，缺省实现返回 `{health:"ready"}`；核对实际连接没有漂移，登记 binding。子 Agent 资源挂到当前 Run。 |
| `call(bindingId, method, input:object, options?:{signal?,timeoutMs?})` | `Promise<ReadResult<T>>` | 拒绝 `subscribe*`；核对绑定、契约方法及能力；同一 binding+method+规范化 input 的在途请求合并，完成结果不长期缓存；调用实现 `(input,context)`；检验响应预算、金融数值、ReadMeta、连接未变，复制后返回。 |
| `subscribe(bindingId, method, input, options?:{signal?,timeoutMs?})` | `Promise<{subscriptionId,snapshot,ready(emit),close():Promise<void>}>` | 只接受 `subscribe*`；建立原生订阅并检验初始快照和水位；调用 `ready` 后开始投递；每条事件校验身份、连续序号、同 ID 内容一致及预算；缺口/冲突产生 `stream.gap` 并关闭。 |
| `unbind(bindingId)` | `Promise<void>` | 已不存在则返回；先删除绑定并取消生命期，再关闭相关订阅、调用实现 `unbind({bindingId})`。 |

`descriptor` 的宿主识别字段与实现回调如下；其他元数据会随描述返回，不等于都经过完整 Schema 验证：

```ts
descriptor = {
  id: string,
  contract: "sesame.market" | "sesame.account",
  versions: ["1.0.0", ...], capabilities: string[],
  connection?: { required: boolean },
  extensions?: [{ id, label, scope:"instrument"|"account"|"position",
    type:"decimal"|"text"|"boolean"|"timestamp",
    unit?:string, precision?:number,
    capabilities:Array<"read"|"history"|"subscribe"> }]
};
implementation = {
  bind?: (input, {bindingId,signal}) => object | Promise<object>,
  unbind?: ({bindingId}) => void | Promise<void>,
  dispose?: ({reason:"deactivated"}) => void | Promise<void>,
  [declaredReadMethod]: (input, context) => ReadResult<T> | Promise<ReadResult<T>>,
  [declaredSubscribeMethod]: (input, context) => NativeStream | Promise<NativeStream>
};
context = {bindingId,requestId,deadlineAt,signal,connection?};
NativeStream = {
  position?:{streamId,epoch,seq}, at?:{streamId,epoch,seq}, // 至少一种
  snapshot:T, consistency:"atomic"|"bounded"|"best_effort",
  resumeToken?:string, recovery?:"replay"|"snapshot", meta?:object,
  ready(emit), close()
};
// 消费侧 stream.snapshot 的实际形状（比 NativeStream.snapshot 多一层）：
{subscriptionId,at:{streamId,epoch,seq},snapshot:T,meta?,resumeToken:null|string,
 recovery:"snapshot"|"replay",consistency}
// ready 收到的正常事件：
{streamId,epoch,seq,eventId,type,schemaVersion:"1.0.0",observedAt,
 sourceTime?,payload,meta?,receivedAt,subscriptionId}
```

默认单消息 1 MiB、调用/建流超时 30 秒；调用者可缩短超时。订阅建立后的生命期不受建流超时支配。标准读取统一校验封装与金融值，**不是每个标准 payload 都有完整逐字段 Schema 校验**；扩展数据 payload 另有严格校验。`stream` 当前实际对象还暴露内部 `entry/bindingId`，规范不宜将 `entry` 作为插件公共依赖。

源码：[HostContext 门面](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:190)、[注册/绑定](E:/brief2great/sesame/mt5agent/modules/plugins/providers.js:49)、[读取](E:/brief2great/sesame/mt5agent/modules/plugins/providers.js:159)、[订阅](E:/brief2great/sesame/mt5agent/modules/plugins/providers.js:220)。

### 2.1 market/account 的固定方法

下表输入是上面 `call/subscribe` 的 `input`；读取结果均包在 `ReadResult.data`，订阅结果均包在 `stream.snapshot.snapshot`。业务数据外形按仓库现行契约列出，宿主处理统一走上述路由。

| 方法 | 输入形状 | data / 初始快照形状 |
| --- | --- | --- |
| `searchInstruments` | `{query,assetClasses?,venues?,page:PageRequest}` | `Page<{ref:InstrumentRef,symbol,name,assetClass,venue:Value<string>}>` |
| `describeInstrument` | `{instrument:InstrumentRef}` | `{ref,symbol,name,assetClass,venue,currency,price:{tickSize,displayDecimals},quantity:{unit,min,step,max,contractMultiplier},volume:{realUnit,hasReal,hasTick},timeBasis,calendar,features,native}` |
| `queryBars` | `{instrument,spec,range:TimeRange,includeForming,direction:"forward"|"backward",page}` | `{seriesId,instrument,spec,page:Page<Bar>,coverage}` |
| `queryTicks` | `{instrument,kinds,range,direction,page}` | `{page:Page<Tick>,coverage}` |
| `subscribeQuotes` | `{instruments:InstrumentRef[],resumeToken?}` | `{quotes:Quote[]}`；增量 `quotes.upsert`。 |
| `subscribeBars` | `{instrument,spec,tailLimit,includeForming,resumeToken?}` | `{seriesId,instrument,spec,bars:Bar[],coverage}`；增量 `bars.upsert/remove/closed`。 |
| `listAccounts` | `{page}` | `Page<{ref:AccountRef,name,broker,server,nativeLogin,mode,baseCurrency,positionMode}>` |
| `snapshot` | `{account:AccountRef}` | `{account:AccountSummary,snapshotId,asOf,balance,equity,available,buyingPower,unrealizedPnl,realizedPnl,margin:{used,free,levelRatio,maintenance},restrictions:[]}`；资金字段用带币种的 `Value<Money>`。 |
| `queryPositions` | `{account,instruments?,page}` | `Page<Position>` |
| `queryOrders` | `{account,scope:"working"|"history"|"all",range?,instruments?,page}` | `{page:Page<Order>,coverage?}` |
| `queryFills` | `{account,range,instruments?,orderIds?,page}` | `{page:Page<Fill>,coverage}` |
| `queryHistory` | `{account,range,kinds?,page}` | `{page:Page<LedgerEntry>,coverage}` |
| `subscribeAccount` | `{account,topics:Array<"snapshot"|"positions"|"orders"|"fills"|"history">,resumeToken?}` | `AccountState`：账户资金与所订阅的持仓/订单/成交/流水状态快照，后续按相应实体事件更新。 |
| `readExtension`，两契约共用 | `{extensionId,subject}` | `{extensionId,subject,points:[{id,revision,time,value:Value<T>}],coverage:{complete,reason?},snapshotId?,nextCursor?}`；最多 1 点。 |
| `queryExtension`，两契约共用 | `{extensionId,subject,range,page:{limit,cursor?}}` | 同上；最多 `page.limit` 点；有连续分页时必须固定 `snapshotId`。 |
| `subscribeExtension`，两契约共用 | `{extensionId,subject}` | 同上；初始最多 10000 点；随后 `extension.upsert/remove`，此方法当前不接受 `resumeToken`。 |

`spec={timeframe,priceBasis:"bid"|"ask"|"mid"|"last",adjustment:"none"|"forward"|"backward",session,calendarRevision:Value<ArtifactRef>}`。`coverage={requested:TimeRange,observedRange:TimeRange|null,complete,gaps:[{range,reason}],retentionStart?}`。扩展 `subject` 为 `{instrument}`、`{account}` 或 `{account,positionId}`，必须符合声明的 scope；账户必须匹配绑定连接。

主要实体的共同身份是 `{id,revision,account?,instrument?,...}`，不会用显示名称替代引用。Bar 包含 `openTime/endTime/OHLC/volume/turnover/isClosed/closure`；Quote 包含 `time/bid/ask/last/bidSize/askSize/nativeId`；Position 包含 `side/quantity/availableQuantity/averagePrice/markPrice/PnL`；Order 包含 `side/orderType/quantity/filledQuantity/limitPrice/stopPrice/status/createdAt/updatedAt/correlation`；Fill 包含 `time/side/quantity/price/fees/realizedPnl/correlation`。

源码能力路由：[protocol.js](E:/brief2great/sesame/mt5agent/modules/plugins/protocol.js:4)；完整业务字段契约：[market-account.md](E:/brief2great/sesame/mt5agent/docs/plugin-api-v1/market-account.md:27)；扩展严格校验：[extensions.js](E:/brief2great/sesame/mt5agent/modules/plugins/extensions.js:86)。

## 3. host.datasets：查询、暂存与冻结数据

| 接口形状 | 返回 | 宿主处理逻辑 |
| --- | --- | --- |
| `list(options?:{hydrate?:boolean})` | `Dataset[]` | 列举 Store 当前可见数据集；默认读回 rows，`hydrate:false` 只返回元数据和存储引用。 |
| `read(id)` | `Dataset` | 按 ID 读取并补回 rows；不存在抛错。底层仍执行 Run 私有过程数据过滤。 |
| `register(data:{id,rows:unknown[],title?,description?,input_ids?,provenance?,...})` | 保存后的 data，附 `producer_plugin_id`，可能附 Run 归属 | 校验 id/rows，强制记录生产插件；行数据按内容摘要外存、SQLite 存元数据。既有同 ID 数据不能更改行内容。 |
| `sources()` | `[{name,description}]` | 返回当前已登记数据源；内置源为 `dataset`。 |
| `query(input:{source,limit?,offset?,freshness_ms?,fields?:string[],time_field?,from?,to?,...数据源参数},signal?)` | `Promise<{query_id,row_count,rows,has_more,complete,next_before,expires_at,provenance}>` | 检查分页/新鲜度；按会话+源 identity+输入隔离缓存、合并在途查询；调用 source 回调，再做时间过滤、分页、选列、摘要；缓存完整本次结果，返回前 10 行预览。 |
| `snapshot(queryId,title?)` | `{dataset_id,row_count,provenance}` | 必须是当前会话未过期、`offset=0` 且无后续页的完整查询；将实际缓存 rows 冻结为数据集；同查询重复 snapshot 返回已登记 ID。 |
| `registerSource(name,description,query,options?:{identity?:()=>unknown,freshnessMs?:number})` | `dispose():void` | 仅 service；将源名改成 `插件ID/name` 后登记；拒绝同名；注销时清理对应查询缓存。回调 `query(input,signal)` 返回 `{rows,provenance?,input_ids?,has_more?,offset_applied?,next_before?,...}`。 |

查询缺省 `limit=5000/offset=0/freshness=源配置或2000ms`；limit 上限 100000，查询结果默认 5 分钟过期，缓存 128 MiB / 128 个结果。`from/to` 对 `time_field` 以数值秒过滤，字符串时间必须带明确时区。`Dataset` 至少有 `id`；读取时通常含 `rows,row_count,storage,provenance` 等元数据。`register` 并未强制 provenance 的完整业务结构。

**权限更正：** HostContext 本层没有额外 conversation 过滤，但 `Store.visible` 对 dataset 的 `owner_run_id` 生效：共享/已保留数据可见，当前 owner 上下文不能直接读取其他 Run 私有过程数据。不能把它描述为“所有数据集全局任意可读”。

源码：[HostContext](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:117)、[查询/冻结](E:/brief2great/sesame/mt5agent/modules/agent/data-service.js:25)、[Store 可见性](E:/brief2great/sesame/mt5agent/modules/agent/store.js:104)、[数据不可变内容](E:/brief2great/sesame/mt5agent/modules/agent/store.js:161)。

## 4. host.artifacts：固定版本成果

| 接口形状 | 返回 | 宿主处理逻辑 |
| --- | --- | --- |
| `blob(bytes:Buffer|string)` | `BlobRef` | 转字节，限 32 MiB，按 SHA-256 内容寻址写文件；已存在复用，重新核对完整性。 |
| `readBlob(ref:BlobRef)` | `Buffer` | 按摘要定位字节并复核摘要和大小。 |
| `publish({operationId,manifest,artifactId?,expectedRevision?})` | `ArtifactRef` | 校验清单、真实 blob、固定依赖与特定内容 Schema；按插件+operationId 幂等；首次旧修订应为 null，更新需精确旧 revision 且只能原发布插件；写不可变 revision 和 head，发送发布事件。 |
| `read(ref:ArtifactRef)` | `{id,ref,producer:PluginRef,manifest,createdAt,context:{conversationId?,runId?}}` | 精确匹配 id/revision/digest/kind/schemaVersion，缺少或不一致返回 NOT_FOUND；不支持 latest。 |
| `list(input?:{kind?,limit?:number,offset?:number})` | `{items:[{ref,producer,createdAt}],hasMore}` | 按 kind 过滤后分页；默认 100，上限 2000。 |
| `inspect(ref,signal?)` | `Promise<{id,artifact,viewInstanceId,status:"rendered"|"failed",renderer,observedAt,checks,diagnostics}>` | 仅 report；读取实际 HTML，调用浏览器检查器；预览请求限定到该报告绑定的数据/依赖/运行版本；持久化宿主检查回执。 |
| `receipts(ref)` | 上述回执/浏览器渲染回执数组 | 先验证精确成果引用存在，再返回该引用已有的回执；本次不会重新渲染。 |

```ts
manifest = {
  kind: "data" | "indicator" | "report" | "strategy.source" | "strategy.target"
    | "strategy.translation" | "strategy.validation" | "strategy.trace"
    | "strategy.result" | "environment" | "dependency-lock" | "parameters"
    | "tolerance-policy" | "resource",
  schemaVersion: "1.0.0",
  dependencies: ArtifactRef[],
  blobs: Array<BlobRef & {path:string;mediaType:string}>,
  content: object
};
```

内容的主要形状与检查（**所有 kind 并非具有同样完整的宿主内容校验**）：

| kind | `content` 主要形状 | 宿主重点检查 |
| --- | --- | --- |
| data | `{format:"json-rows",path,rowCount,columns:[],provenance:{kind,...}}` | 真正解析 blob，须数组，真实行数等于 rowCount；derived 须有固定依赖。 |
| report | `{schemaVersion:"1.0.0",runtime:"sesame-report/1",runtimeRevision:"1.0.0",title,summary,locale,entry,data:[{id,ref,usage}],related:[{role,artifact?或record?}],features:[],provenance:{kind,references:[]}}` | HTML 入口存在；数据引用必须 data 且列入 dependencies；关联 record 必须固定 version；demo 输入不能伪装 observed。 |
| indicator | `{schemaVersion,title,parameters:[{id,title,type,required,default?,min?,max?,choices?}],inputs:[],panes:[],series:[],implementation}` | 输入、pane、series 身份与预算；实现为 `{kind:"code",runtime:"sesame-indicator/1",language:"javascript",entry,dependencies:[]}` 或 `{kind:"series",updateMode:"static",initial:DataRef}`；代码当前不允许外部模块依赖。 |
| strategy.source | `{schemaVersion:"1.0.0",language:"svl/1",languageVersion,sourcePath,sourceDigest,parent?}` | 读取实际 SVL 字节，校验并重算语义摘要；parent 如有必须固定 source 引用。 |
| strategy.translation | `{source:ArtifactRef,target:ArtifactRef,sourceDigest,entryPath,environment?,...}` | 固定 source/target/environment；源摘要匹配真实 source；入口 blob 存在。 |
| strategy.validation | `{issuer?:"plugin",...}` | 插件不能签名为宿主；强制 issuer=plugin。 |
| 其余已接受 kind | `object`，按该成果约定提供内容 | 当前 `validateArtifact` 未做对应完整专用内容校验，仍检查外层、blob、固定依赖、摘要、版本和所有权。 |

源码：[artifacts.js](E:/brief2great/sesame/mt5agent/modules/plugins/artifacts.js:17)、[artifact-schema.js](E:/brief2great/sesame/mt5agent/modules/plugins/artifact-schema.js:35)、[报告检查](E:/brief2great/sesame/mt5agent/modules/agent/report-validator.js:21)。

## 5. host.records：策略运行的事件记录

| 接口形状 | 返回 | 宿主处理逻辑 |
| --- | --- | --- |
| `create({operationId,recordId,kind:"strategy.run",schemaVersion:"1.0.0",body})` | `RecordRef`，初始 version=1 | 检查 starting 状态、固定依赖、运行模式、账户/连接、源与翻译一致、观察者就是当前插件；插件内操作幂等；新建记录及版本快照，发 strategy.run 事件。 |
| `append({operationId,recordId,expectedVersion,event})` | 新 `RecordRef` | 原发布插件才能更新，CAS 检查 version，检查状态迁移及证据；新增独立事件、版本快照与当前投影；内嵌 events 保留最近 32 条。 |
| `read(id,version?)` | `{id,kind,version,schemaVersion,producer,body,events,createdAt,updatedAt?,effectiveStatus?}` | 指定 version 读固定快照；不指定读当前记录，若 running 观测已过期，则 effectiveStatus=unknown，原 body.status 保留。 |
| `list()` | 上述当前记录数组 | 逐项读取最新投影并计算 effectiveStatus。 |

```ts
// create.body：下面无 ? 的字段为当前宿主校验所需
{
  runId: string, schemaVersion:"1.0.0", status:"starting",
  mode:"backtest"|"simulation"|"live", operationId:string, authorizationRef:string,
  owner:{kind:"task"|"persistent",id:string},
  dependencies:ArtifactRef[],
  source:ArtifactRef, translation:ArtifactRef, parameters:ArtifactRef, environment:ArtifactRef,
  validations:ArtifactRef[], dataBindings:ArtifactRef[],
  accounts:[{binding:string,account:AccountRef,connection:ConnectionRef,provider?:ProviderRef}],
  plugin:PluginRef,
  observer:{plugin:PluginRef,publisherId:string,sessionId:string},
  nativeInstance:{status:"unknown"}, observation:null,
  ... // 宿主未排除额外业务元数据
}
// append.event：条件性必填见后文
{
  status?:"starting"|"running"|"stopping"|"stopped"|"completed"|"failed"|"unknown",
  evidence?:ArtifactRef[],
  nativeInstance?:{status:"unknown"}
    | {status:"value",value:{id:string,startedAt:number,evidence:ArtifactRef[],...}},
  nativeInstanceId?:string,
  observation?:{observedAt:number,validUntil:number,evidence:ArtifactRef[],...},
  observedAt?:number, validUntil?:number, ...
}
```

`runId` 必须等于 recordId。simulation/live 必须有明确账户；source/translation/parameters/environment/validations/dataBindings 都必须被 dependencies 固定。写 `running` 时，该次事件必须给出 `nativeInstance.status=value`、observation 和非空 evidence；仅说“running”不能通过。create 不会启动任何策略进程，append 不会发交易指令。记录体默认限 128 KiB，单事件 64 KiB。

源码：[创建](E:/brief2great/sesame/mt5agent/modules/plugins/artifacts.js:107)、[追加和读取](E:/brief2great/sesame/mt5agent/modules/plugins/artifacts.js:142)。

## 6. host.svl：源校验、图与确定性参考回放

| 接口形状 | 返回 | 宿主处理逻辑 |
| --- | --- | --- |
| `validateSource(input:string或SVL对象)` | `{source:规范化对象,sourceDigest,operators:string[],diagnostics:[]}` | 安全解析 JSON，拒绝重复键、循环/共享引用和超预算；校验语言版本、固定语义、参数/输入/状态/节点/handler、类型、依赖环和操作符；返回语义摘要，失败抛错。 |
| `graph(input)` | `{sourceDigest,nodes:[{id,operator,effect,functionId?}],edges:[{from,to,kind:"data"}],handlers,functions?,calls?,modules?}` | 先完整 validateSource，再按节点引用构图；1.1 起包含函数调用信息，1.2 包含声明模块。 |
| `evaluateReplay(input,fixture?)` | `{sourceDigest,state,events:[{eventId,status:"committed"|"paused",state,intents,trace,error?}],status:"completed"|"paused"}` | 先校验源，补参数/初态；按输入序列处理事件、去重、计算节点；每事件成功才提交状态及意图，失败保留旧状态、清空本事件意图并暂停；不连接券商、不撮合、不读写文件或网络。 |

```ts
// SVL input 的顶层外形（对象或同样内容的 JSON 文本）
{language:"svl/1",schemaVersion:"1.0.0"|"1.1.0"|"1.2.0",strategyId,
 semantics:{numeric:{precision:34,rounding:"half_even"},missing:"not_ready",onError:"pause",
   eventOrdering:"input_sequence",duplicateEvent:"ignore",stateCommit:"per_event"},
 parameters:{[id]:{type?,shape?,default?,min?,max?,unit?,currency?,choices?}},
 inputs:{[id]:{kind:"bars"|"quotes"|"accountSnapshot"|"orderEvents"|"timer"|"external",...}},
 state:{[id]:{type:TypeSpec,initial}},
 nodes:[{id,op,inputs:object}],
 handlers:[{id,event:{type,input},steps:[]}],functions?:[],extensions?:[]}
fixture = {runId?:string,parameters?:object,initialState?:object,
 events?:[{eventId,sequence,type,input,inputs?:object,availableAt?:SourceTime,...}]};
```

回放最多 10000 事件，每事件有计算预算；`order.submit/cancel` 在这里产生可追踪的 intent，不能解释成实际订单成交。`evaluateReplay` 的 fixture 参数可能为空，但源声明的无默认参数仍必须提供。

源码：[validateSource](E:/brief2great/sesame/mt5agent/modules/plugins/svl.js:240)、[graph](E:/brief2great/sesame/mt5agent/modules/plugins/svl.js:360)、[evaluateReplay](E:/brief2great/sesame/mt5agent/modules/plugins/svl.js:395)。
