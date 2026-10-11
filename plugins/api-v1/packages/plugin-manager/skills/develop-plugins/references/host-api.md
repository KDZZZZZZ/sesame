# 插件开放接口参考

[开发文档](../SKILL.md) · [编写指南](authoring.md)

## 1. 边界与版本

Sesame 向原生插件传入 `HostContext`。插件通过它定义 Agent 工具、读取产品数据、发布成果、管理自己的状态；通过自己的 CLI、MCP、Node/Python 适配器连接外部系统。工具和 Skill 的业务内容由插件负责。

界面消费五类产品契约：`sesame.market`、`sesame.account`、`sesame.indicator`、`sesame.report`、`sesame.strategy`。只有前两类注册只读 provider，后三类主要发布不可变成果。没有强制统一的 `backtest()`、`deploy()`、`submitOrder()` 宿主业务方法。

| 版本字段 | 当前含义 |
| --- | --- |
| 原生 `apiVersion: "1"` | 宿主桥主版本 |
| provider `versions: ["1.0.0"]` | 实际支持的精确产品契约版本 |
| artifact `schemaVersion: "1.0.0"` | 成果外壳版本 |
| `engines.sesame` | 应用版本范围，载入代码前检查 |
| `plugin.json.version` | 插件自己的 SemVer |
| SVL 源文件 `schemaVersion` | 策略语言版本；不等于成果外壳版本 |

API 1 基础接口可用于 0.2.0；`host.tools.call` 从 0.2.1 起；`host.inference`、`host.agents` 和本轮 SVL 扩展要求 0.2.2。使用新方法时同时设置最低版本和检查方法存在，不能只判断 `apiVersion === "1.0.0"`。核查使用的源版本见[版本依据](../SKILL.md#版本依据)，源代码可用不代表安装包已发布。

## 2. 入口与作用域

```js
export async function activate(host) {
  // 服务作用域：登记 provider、恢复插件状态、建立自有事件源。
  return { async dispose() { /* 释放本插件的监听、计时器与连接 */ } };
}

export function createTools(host) {
  // 当前 Agent 会话作用域：只构造工具，不在工厂中执行交易或启动任务。
  return [];
}
```

`host.apiVersion` 是 `"1.0.0"`；`application` 是只读 `{name, version}`；`plugin` 是 `{id, version, digest}`；`scope` 是 `{kind, conversationId, runId}`，`kind` 为 `service`、`main` 或 `subagent`。

服务和会话的 host 不能互相冒用。服务激活时没有当前会话，不能使用要求会话的工作区、布局或普通任务接口。`createTools` 可能重新执行，不把工具工厂当成后台服务生命周期。

### 当前识别的服务回调

| `activate` 返回对象中的方法 | 调用时机和约定 | 现有范例 |
| --- | --- | --- |
| `dispose()` | 停止服务，关闭自己创建的资源；不得顺便平仓 | AKShare、MT5、strategy-authoring |
| `beforeDeactivate()` | 更新/停用前检查；未确认的持久运行应阻止切换 | MT5 |
| `beforeConfiguration({owner})` | 同步检查宿主配置是否可变更 | MT5 |
| `configurationChanged({})` | 配置流程结束后通知，重新读取实际状态 | MT5 |
| `beforeMessage({messageId, conversation, parts, source, metadata})` | 同步返回替换后的 `parts` 或不返回；用于明确的配置导入等 | MT5 配置导入 |
| `protectArtifacts(runId)` | 子任务封存前返回需要保护的插件成果清单 | MT5 |
| `cleanupRun(runId)` | 子任务封存后清理该 Run 的插件中间状态 | MT5 |

后两项是当前已使用的专门生命周期回调，返回结构参考 [MT5 lifecycle](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/optional-api-v1/packages/mt5/backend/lifecycle.js)，不要凭名字传任意 ArtifactRef。`beforeMessage` 和 `beforeConfiguration` 必须同步。其他回调可异步。不要使用消息回调伪造用户请求来触发 Agent；事件任务用 `host.agents`。

## 3. HostContext 全部命名空间

下表是当前暴露的方法；不是每个作用域都能调用每个方法。表中的“会话”包括允许的主 Agent 或子 Agent，会话和任务可见范围仍由宿主核对。

| 命名空间 | 已开放成员 | 用途与限制 |
| --- | --- | --- |
| `tools` | `define`、`Type`、`string`、`optional`、`call` | 定义工具 schema；`call` 仅限正在进行的工具调用 |
| `providers` | `register`、`list`、`bind`、`call`、`subscribe`、`unbind` | 注册仅服务期；其余用于已声明的只读行情/账户方法 |
| `artifacts` | `blob`、`publish`、`read`、`list`、`readBlob`、`inspect`、`receipts` | 冻结内容、发布成果、读取固定引用、报告渲染检查 |
| `records` | `create`、`append`、`read`、`list` | 当前支持 `strategy.run`；所有权、幂等和版本比较 |
| `svl` | `validateSource`、`graph`、`evaluateReplay` | 源检查、生成逻辑图、确定性参考求值 |
| `inference` | `models`、`complete` | 已配置模型的一次无工具推理，0.2.2 |
| `agents` | `submit`、`inspect`、`wait`、`cancel`、`current` | 真实 Agent 子任务，0.2.2；提交只允许服务或主会话 |
| `workspace` | `path`、`file`、`snapshot`、`run`、`root`、`taskRoot`、`owner` | 当前工作区文件和进程；需要有效会话；读取其他任务路径时核对范围 |
| `workspace.operations` | `readFile`、`access`、`mkdir`、`writeFile` | 当前会话的文件操作适配器，含已加载插件资源读取 |
| `externalFiles` | `list`、`search`、`read`、`import`、`write`、`mkdir`、`move`、`remove`、`run` | 会话中的宿主文件和命令操作；沿用系统用户权限 |
| `storage` | `directory`、`get`、`list`、`put`、`update`、`delete`、`transaction`、`idempotent`、`idempotentAsync` | 每个插件独立的持久数据命名空间；不是凭据保险箱 |
| `storage.legacy` | `get`、`list`、`path` | 仅宿主已有授权的迁移项；第三方不得依赖或自授旧数据库访问 |
| `environment` | `capabilities`、`pythonPath`、`execution`、`executeWorker` | `execution:"host"`；仅运行 manifest 声明的 worker |
| `datasets` | `sources`、`query`、`snapshot`、`list`、`read`、`register`、`registerSource` | 查询和冻结研究数据；`registerSource` 仅服务期，query/snapshot 需要会话 |
| `layout` | `inspect`、`apply`、`script` | 会话中的图表、窗口和指标操作；遵守版本、锁与用户拖动租约 |
| `tasks` | `list`、`read`、`run`、`delegate`、`inspect`、`stop`、`finish` | 会话中的普通 subagent 管理；主 Agent 也可观察/停止插件触发任务 |
| `memory` | `tree`、`search/list`、`read/get`、`index`、`propose`、`candidates`、`markUsed`、`save`、`resolveCandidate`、`archive`、`restore`、`forget`、`stats`、`configure` | 子任务按范围读取并提候选；正式记忆写入/治理由主 Agent 处理 |
| `configuration` | `read`、`update`、`open`、`exclusive`、`assertIdle` | 主 Agent/服务检查；update 还要求会话。只支持打开 settings 对话框 |
| `plugins` | `isActive`、`discover`、`load`、`read`、`inspect`、`manage` | 发现/加载/读资源需要会话；inspect/manage 是主 Agent 管理边界 |
| `reports` | `list`、`read` | 已保存报告的读取；新成果首选 `artifacts` |
| `executions` | `read` | 按会话范围读取真实进程记录 |
| `messages` | `read` | 按会话范围读取消息，不能假设子任务过程永久保留 |
| `events` | `emit` | 发布带插件身份的事件；没有公开的通用 `events.on/subscribe` |

### 工具定义与跨插件组合

```js
host.tools.define(name, description, properties, async (args, signal) => {
  signal?.throwIfAborted();
  return { result: 'JSON 可序列化的业务结果' };
});
```

`properties` 是 JSON Schema 属性表，顶层 object 与 `additionalProperties:false` 由 define 构造。`Type`/`string`/`optional` 是 schema 构造器。普通结果由宿主包装为 ToolResult；需要图片等时参考 [workspace/tools.js](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/workspace/tools.js) 的自定义 `execute`。

```js
const result = await host.tools.call({
  pluginId: 'sesame/data-access',
  name: 'data_sources',
  arguments: {},
}, signal);
```

这是调用工具的示例，不会自动安装或加载目标包。目标需已在当前会话可用，工具所属插件与名字必须匹配；作用域、schema、父级取消和嵌套调用预算仍生效。返回完整 ToolResult，检查 `isError`，不能把它当成裸业务对象。递归环拒绝，调用链最多八层。真实组合范例：[manual-trading](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/optional-api-v1/packages/manual-trading/service.js)。

## 4. 行情和账户 provider

### 必需与可选方法

| 契约 | 实现方法 | capability | 是否必须 |
| --- | --- | --- | --- |
| market | `searchInstruments` | `instruments.search` | 必须 |
| market | `describeInstrument` | `instruments.describe` | 必须 |
| market | `queryBars` | `bars.history` | 后四项至少一个 |
| market | `queryTicks` | `ticks.history` | 按能力声明 |
| market | `subscribeQuotes` | `quotes.subscribe` | 按能力声明 |
| market | `subscribeBars` | `bars.subscribe` | 按能力声明 |
| account | `listAccounts` | `accounts.list` | 必须 |
| account | `snapshot` | `account.snapshot` | 必须 |
| account | `queryPositions` | `positions.query` | 可选 |
| account | `queryOrders` | `orders.query` | 可选 |
| account | `queryFills` | `fills.query` | 可选 |
| account | `queryHistory` | `history.query` | 可选 |
| account | `subscribeAccount` | `account.subscribe` | 可选 |

不能声明 capability 却不实现方法。缺少可选接口时不声称该功能已支持；未知余额、数量等使用显式缺值状态，不能填 `0` 或用空列表冒充已确认无数据。连接故障是错误，不等于不支持该能力。

### 原生方法签名

```js
const dispose = host.providers.register({
  id: 'market', contract: 'sesame.market', versions: ['1.0.0'],
  capabilities: ['instruments.search', 'instruments.describe', 'bars.history', 'bars.subscribe'],
}, implementation);

const binding = await host.providers.bind(
  { pluginId, providerId },
  { connection, configuration }, // 按实际后端提供，允许省略可选字段
  signal,
);
const result = await host.providers.call(binding.bindingId, 'queryBars', input, { signal });
const stream = await host.providers.subscribe(binding.bindingId, 'subscribeBars', input, { signal });
// stream.snapshot 是 {subscriptionId, at, snapshot, ...}；先应用其中的 snapshot 和 at，再消费增量：
stream.ready(event => { /* 处理连续增量 */ });
await stream.close();
await host.providers.unbind(binding.bindingId);
```

上段的 `implementation`、`input` 和连接值由插件实现，不是可独立运行的 mock。完整范例：[AKShare provider](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/optional-api-v1/packages/akshare/provider.js)、[MT5 providers](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/optional-api-v1/packages/mt5/backend/providers.js)。

原生实现接收 `method(input, context)`；context 包含 `bindingId, requestId, deadlineAt, signal, connection?`。可选 `bind(input, {bindingId, signal})` 返回实际 connection、sourceIds、health 等信息；`unbind({bindingId})` 释放绑定；`dispose({reason})` 释放提供方。不要把标准 stdio 协议的 `provider.initialize` 当作原生实现必需的方法。

### 返回与共同类型

```ts
type ProviderRef = { pluginId: string; providerId: string };
type ConnectionRef = { id: string; revision: string };
type InstrumentRef = { sourceId: string; instrumentId: string };
type AccountRef = { connectionId: string; accountId: string };
type Decimal = string; // 无指数的精确十进制字符串
type Value<T> = { status: 'value'; value: T }
  | { status: 'unknown' | 'unsupported' | 'not_applicable'; reason?: string };
type SourceTime = { basis: 'utc'; unixMs: number }
  | { basis: 'wall'; authority: string; value: string };
type ReadResult<T> = {
  data: T;
  meta: {
    observedAt: number;
    freshness: 'live' | 'delayed' | 'stale' | 'unknown';
    origin: 'observed' | 'derived' | 'user_input' | 'demo';
    consistency: 'atomic' | 'bounded' | 'best_effort';
    warnings: string[];
    samplingWindow?: { from: number; to: number }; // bounded 时必须
    sourceTime?: SourceTime;
  };
};
```

插件可以补充可追溯来源；宿主补上 provider、instanceId、connection 和 receivedAt。`sourceId + instrumentId` 决定品种身份，显示 symbol 不能替代它。币值使用 `{value:Decimal,currency}`，数量使用 `{value:Decimal,unit}`。未知值不带 value。`wall` 时间保留真实 authority；不知道券商时区就不能擅自按 UTC 解释。

常用业务输入：search 使用 `query/page`；describe 使用 `instrument`；queryBars 使用 `instrument/spec/range/page/includeForming/direction`。`spec` 包含 timeframe、priceBasis、adjustment、session、calendarRevision。具体支持的周期、单位、复权等由 describe 返回；没有跨后端通用的任意字符串假设。行情分页保持 snapshot/cursor 的来源和绑定，不跨连接复用 cursor。

K 线使用稳定 `id/revision`、`openTime/endTime`、Decimal OHLC、`isClosed/closure`、typed volume。形成中 K 线更新同一柱的修订，不追加成多根柱；tick volume 与真实成交量不混用。

### 订阅与资源边界

提供方返回 `{snapshot, position:{streamId,epoch,seq}, consistency, ready(emit), close()}`，可附 resumeToken/recovery。`ready` 前不推增量。事件带相同 streamId/epoch、连续整数字符串 seq、eventId、schemaVersion、observedAt、type 和 payload。断流、序号缺口、epoch 改变后重取快照，不把旧数据继续标为实时。

原生 provider 可长驻订阅；30 秒只读截止不等于订阅只能活 30 秒。默认单消息预算 1 MiB。重复的**同一 binding、method、input 的并发读**会合并；不是所有绑定共享一个永久缓存。持久缓存、上游轮询合并和限流由插件按数据身份实现。AKShare 的 60 秒公开数据轮询不能写成交易所实时 tick。

标准包的 `contributions.json` 可声明 `stdio-jsonrpc` 只读提供方；当前每次查询启动/协商/绑定，不能声明持续订阅。MCP 传输与产品 provider 是两条通道，MCP 工具不会自动接入 Dashboard。

## 5. 成果、报告与指标

```ts
type ArtifactRef = {
  id: string; revision: string; digest: string;
  kind: string; schemaVersion: '1.0.0';
};
```

ArtifactRef 必须完整保留，不用文件路径或 `latest` 替代。Blob 是 `{digest,size}`；发布时附包内 `path,mediaType`。

```js
const blob = host.artifacts.blob(JSON.stringify({ note: '用户提供的研究备注' }));
const ref = host.artifacts.publish({
  operationId: 'note-publication-0001', // 重试同一操作沿用，改内容换 ID
  manifest: {
    kind: 'resource', schemaVersion: '1.0.0',
    content: { type: 'research-note', path: 'note.json' },
    dependencies: [],
    blobs: [{ ...blob, path: 'note.json', mediaType: 'application/json' }],
    provenance: { kind: 'user_input', references: [] },
  },
});
```

`publish` 返回 ArtifactRef。更新同一成果使用 `artifactId + expectedRevision`，内容得到新修订；只有原发布插件能修改该成果头。operationId 在插件内幂等，同键不同输入拒绝。blob 单个最多 32 MiB，manifest 最多 2 MiB，dependencies/blobs 各最多 256 个。报告渲染资源总和另受 32 MiB 预算限制。

已接受 kind：`data`、`indicator`、`report`、`strategy.source`、`strategy.target`、`strategy.translation`、`strategy.validation`、`strategy.trace`、`strategy.result`、`environment`、`dependency-lock`、`parameters`、`tolerance-policy`、`resource`。

其中 data/report/indicator/source/translation 有专门内容检查；其他种类仍需要插件验证自己的业务字段。宿主接收一个 `strategy.result` 不等于证明原生引擎执行过，也不等于验证了所有结果字段。

### 数据与报告

研究数据先 query → snapshot/register → `report_data`，最终变成固定 json-rows DataRef。派生数据固定输入引用，不能把 demo 改标为 observed。报告通过 HTML、包内 CSS/JS/图片、固定 data bindings 和 related 引用组成；不存在外部 CDN 或任意网络的隐式依赖。

实际报告内开放的 `window.report`：

| 成员 | 当前签名与行为 |
| --- | --- |
| `ready` | 初始化 Promise |
| `track(taskOrFunction)` | 等待异步渲染并把错误/未完成状态纳入检查 |
| `getContext()` | 返回当前 reportRef、主题、语言与 runtime 信息 |
| `readData(dataId, {cursor?, limit?})` | 读取声明的固定数据；返回 rows、page.nextCursor、provenance |
| `readArtifact(ref)` | 读取已在 dependencies 固定的成果 |
| `readStrategy(ref)` | 当前是 `readArtifact` 的别名，不是策略执行服务 |
| `readRun(id, version?)` | 只能读取报告已固定的运行记录版本；省略 version 也不是取最新 |
| `subscribeContext(callback)` | 接收上下文，返回取消订阅函数；当前宿主监听主题变化 |

旧设计中的 `readTrade/openReference` **没有实现**；readData 的 `fields/range` 也不是现有桥提供的筛选能力，需要先读取固定页再在报告内处理。报告没有 HostContext、Node 文件或交易工具。样式/图表库属于 [reports 插件](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/reports)，不是宿主保证永远存在的全局 JS API。

发布后 `host.artifacts.inspect(ref, signal)` 真正执行报告检查；`receipts(ref)` 读已有回执。成果发布、计算完成和屏幕显示成功是不同状态。

### 指标与图表

指标实现目前为：单文件 JavaScript `export compute(input)`，或固定 DataRef 静态序列。代码入口最大 128 KiB；不能导入外部计算模块；`implementation.dependencies` 当前必须为空。TypeScript、增量状态执行器、外部序列流和任意前端组件没有开放。

`compute` 收到 parameters、声明的 `inputs.<id>.rows/revision` 和 context，返回 `{status,series,diagnostics}`。series 支持 line、area、histogram、markers；points 使用稳定 key、SourceTime 与 `Value<Decimal>`。主图/独立 pane、输入 lookback、forming include/closed_only 都显式声明。缺预热数据返回 not_ready，不能补零。

完整可用例子：[close-line.json](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/canvas-control/resources/close-line.json)、[close-line.js](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/canvas-control/resources/close-line.js)。挂载路径是 `indicator_publish` → `chart_script`；每幅图自己的实例、参数、generation 不共享缩放状态。

`host.layout.inspect()` 同步取得当前 version；`apply({command_id,expected_version,operations})` 同步调整图表；`await host.layout.script(args)` 异步挂载/移除指标。首次 put 省略 `script_id`；替换时传入该图仍拥有的实例 ID，并保存返回的新实例 ID。操作 schema 在 [canvas-control/tools.js](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/canvas-control/tools.js)。显示名称不是行情绑定；应先用 `market_instruments`/`canvas_binding` 得到完整 provider、connection、instrument、spec。检查当前客户端回执后再声称图已画出；失败恢复与重复刷新例子见 [recovery](recovery.md)。

## 6. 策略与运行事实

`host.svl.validateSource(source)`、`graph(source)`、`evaluateReplay(source, fixture)` 是通用语义接口。扩展指标、选池、Signal → TargetPortfolio → 风险调整 → 执行的业务编排位于 [strategy-authoring](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/strategy-authoring)，不是新增一套宿主交易 API。

后端插件负责翻译、编译、撮合/回测、真实下单与恢复；交付 source/target/translation/validation/result/trace 的固定引用。参考求值不含真实撮合，不能标成原生回测。原生结果与 SVL 源码映射的具体做法见 [MT5 target](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/optional-api-v1/packages/mt5/target/sdk-integration.md) 和 [conformance](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/optional-api-v1/packages/mt5/backend/conformance.js)。

运行记录接口：

```js
host.records.create({ operationId, recordId, kind: 'strategy.run', schemaVersion: '1.0.0', body });
host.records.append({ operationId, recordId, expectedVersion, event });
host.records.read(recordId, version); // 省略 version 读取当前投影
```

创建状态必须 starting，固定 source、translation、parameters、environment、validations、dataBindings、accounts 和授权/归属信息。running 需要原生实例身份与有期限的观察证据；观察过期时当前 effectiveStatus 为 unknown。状态包含 starting/running/stopping/stopped/completed/failed/unknown。只能由登记该 Run 的插件追加，版本不符先重读。记录本身不启动或停止券商策略。

Signal、TargetPortfolio、风险与执行账本，以及 Agent 判断桥的规则见 [pipeline](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/strategy-authoring/skills/strategy-authoring/references/pipeline.md)、[methods](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/strategy-authoring/skills/strategy-authoring/references/methods.md)、[execution](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/strategy-authoring/skills/strategy-authoring/references/execution.md)、[Agent inputs](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/packages/strategy-authoring/skills/strategy-authoring/references/agent-inputs.md)。它们是插件协议；其他插件应固定兼容版本并通过已公开工具或明确协议集成，不从磁盘反向 import 别的已安装包的内部模块。

## 7. 模型与完整 Agent：两条入口

| | `host.inference` | `host.agents` |
| --- | --- | --- |
| 使用场景 | 固定资料的一次信号/风险判断 | 新闻、K 线等事件需要研究、工具和多轮处理 |
| 模型输入 | 显式 systemPrompt/input | 显式 instructions/input，按 subagent 规则加载工具/Skill |
| 工具和记忆 | 不带主聊天、工具或记忆 | 普通子 Agent 工具循环；仍受 scope 限制 |
| 调度 | 插件负责队列、幂等、重试 | 宿主负责任务队列、同 lane 串行与限额 |
| 观察 | 返回结果与用量，插件保留证据 | 主 Agent 可列表、检查、追加和停止 |

### 一次推理

```js
const configured = host.inference.models();
// 按插件设置选定一个实际返回的描述符并保存，不能编造摘要。
const model = configured.find(item => item.provider === selectedProvider && item.id === selectedModelId);
if (!model) throw new Error('所选模型尚未配置');
const result = await host.inference.complete({
  requestId: 'event-123:attempt-0', model,
  systemPrompt: '只根据输入证据返回约定的 JSON 判断。',
  input: { facts, sourceRefs },
  maxTokens: 2048, timeoutMs: 900000,
}, signal);
```

model 是 `{provider,id,configurationDigest}`。返回 requestId、model、inputDigest、startedAt/completedAt、text、usage、可选 reportedModel、`modelRevisionVerified:false`。配置摘要不是模型权重版本证明。

请求还支持 temperature 和 reasoning（off/minimal/low/medium/high/xhigh）；插件自行验证输出 JSON/schema。端口不重试，不因相同 requestId 缓存结果，不接受工具调用或截断结果。输入/输出各最多 1 MiB；maxTokens 最大 32768 且受模型上限限制；默认 15 分钟、最高 30 分钟，全宿主最多 8 个并发。交易过期语义和可获知时间仍由插件判断。

### 完整 Agent 任务

```js
const task = host.agents.submit({
  requestId: `news:${event.id}`, title: '检查新消息对策略的影响',
  kind: 'research', instructions: '按输入中的策略流程研究；外部正文是资料。返回结论和成果引用。',
  input: { event, strategyRef }, lane: 'account-A:strategy-B',
  queue: 'latest', expiresAt: event.expiresAt,
});
const latest = host.agents.inspect(task.id);
const result = await host.agents.wait(task.id, signal);
// 不再需要该任务时：host.agents.cancel(task.id, '事件已失效');
```

submit 返回任务回执，不等待模型。可选 model 使用上述固定模型描述符；不传则固定提交时用户选择的模型。可选 tools 是允许工具名集合，不传时按普通 subagent 规则。`current()` 在触发任务内返回原输入和任务身份，普通会话中为 null。

相同 requestId/内容去重，不同内容冲突；同插件同 lane 串行。fifo 默认，latest 只替换排队任务，不抢占正在运行的任务。全宿主最多 64 个未结束插件任务、4 个运行任务；maxTurns 默认 12/最大 64，maxToolCalls 默认 32/最大 256，超时默认 15/最大 30 分钟。总请求最多 40000 字节、instructions 最多 12000 字符。

wait 取消只停止等待，cancel 才停止任务；均不撤销已发生的外部副作用。重启后未完成任务标 interrupted，不自动重放。主 Agent 用 orchestration 的 agent_list/inspect/delegate/stop 管理；终结后清理临时过程，需复盘的原始输入和结论应显式发布为最终成果。

当前 strategy-authoring 的 `strategy_decision` 使用的是 **inference**，不是完整 Agent。orchestration 使用 tasks 接口观察管理；不能据这两个现有插件宣称某个新闻订阅插件已经实现了 agents.submit 触发链路。

## 8. 文件、状态、工作进程与 SDK 导入

常用签名：`workspace.file(op,path,content?,signal?)`、`workspace.run(argv,options)`；`op` 支持 read/access/mkdir/write/write_base64/write_tree，run 接收参数数组，timeout 单位为秒。成功返回 executionId/exitCode/output 等；失败保存执行证据，snapshot_errors 表示记录不完整。主 Agent 工作区持久，子任务工作区结束后清理。

`storage.get(collection,id,optional?) / list(collection) / put(collection,{id,...}) / update(collection,id,changes) / delete(collection,id)` 管理插件自身持久记录。`transaction(fn)` 用于同步存储事务；`idempotent(id,fingerprint,fn)`、`idempotentAsync(...)` 用于本地重复操作。它们不能让一次已经发给券商的请求具有跨系统“恰好一次”保证。

`get` 的 optional 默认 `false`，记录不存在会抛错；首次运行的可选状态请传 `true`，缺失返回 `null`。对象读写可能改变键顺序；用深结构相等或 SDK `canonical` 比较内容，不用普通 JSON 字符串的字节相等。持续任务必须测试真实存储往返和重启后的继续运行，详见 [recovery](recovery.md)。

`environment.executeWorker(path,payload,{signal?,timeoutMs?,runId?})` 要求 path 在 manifest.workers 中；模块导出 `execute(payload,{signal,runId,directory,pythonPath})`。timeoutMs 默认 120000、最高 600000。这里是带归属与取消信号的原生模块调用，**不是 Worker 线程、独立子进程或 OS 沙箱**；worker 应响应取消，并自行管理创建的进程。

Agent 和原生插件按当前系统用户的实际权限工作，工作区不是文件访问围栏。插件数据写 storage.directory；依赖优先发现并复用已有环境，缺失再做明确的准备流程。不要改动不可变包目录、全局 Python 或 unrelated 配置来模拟安装成功。浏览器报告/指标仍保留隔离边界。

公开 SDK 裸导入只有：

| 路径 | 内容 |
| --- | --- |
| `@sesame/plugin-sdk/protocol` | API_VERSION、CONTRACTS、ContractError、check/clone/digest/canonical、引用/时间/数值与提供方校验辅助 |
| `@sesame/plugin-sdk/decimal` | Decimal.normalize/add/sub/mul/div/compare/abs/quantize |
| `@sesame/plugin-sdk/svl` | 宿主支持的 SVL 源检查、图和参考求值 |
| `@sesame/plugin-sdk/schema` | TypeBox schema |
| `@sesame/plugin-sdk/schema/value` | TypeBox Value 辅助 |
| `@sesame/plugin-sdk/toml` | TOML 解析依赖 |

这是宿主 loader 提供的六个解析入口，不代表 npm 上已有独立可下载的 `@sesame/plugin-sdk` 包。不要导入私有 Store、Runtime、Pi session、数据库、Electron/React 实例；其他 SDK 路径不接受。

## 9. 没有开放或没有自动完成的事项

- 通用前端组件注册、任意修改应用 DOM/React、指标任意画图 API。
- report.readTrade/openReference、指标 TypeScript/外部模块/有状态增量运行时。
- 任意 loopback WebSocket provider、外部进程直接写成果的通用 RPC。
- 按契约自动寻找并安装 requires 依赖、settingsSchema 自动生成设置 UI、通用秘密凭据库。
- MCP 的任意工具自动映射成行情/账户接口，或包内 permissions 自动授予交易/宿主权限。
- SVL 自动翻译到所有引擎、通用编译/下单接口、发布成果自动证明原生回测或交易成功。

这些边界不妨碍插件在自己的工具/服务中实现业务流程；需要把成果送进现有界面时，再使用相应契约。
