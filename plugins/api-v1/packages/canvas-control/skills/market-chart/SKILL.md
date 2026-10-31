---
name: market-chart
description: Bind charts from fixed SourceRefs, publish typed indicators and inspect actual rendering.
---

公开能力覆盖来源、绑定、显示与诊断，不需要反向工程宿主或安装包。按任务所需选用能力，已有的精确身份与成果可以直接复用。

`resources/indicator-publish.json` 是完整的 `indicator_publish` 调用示例：`files` 与 `definition` 并列，不放进 `implementation`。integer 参数的 default/min/max 是 JSON 安全整数，decimal 参数用精确十进制字符串，boolean/string/enum 保留各自类型；enum 声明 choices。发布结果为 `{ref,receipt}`，挂载时把其中完整 `ref` 传入 chart_script.artifact。

同一轮布局变更可合并到一个 operations。重试同一请求保留 command_id 和参数；版本冲突后读取 canvas_inspect，核对最新布局并使用新 command_id 与当前 expected_version 提交剩余变更，不能并行复用旧版本覆盖用户操作。

| 能力 | 输入与实际结果 | 能证明什么 |
| --- | --- | --- |
| `canvas_inspect` | `{}` → `{version,charts,layout,workspace,scripts,market_sources,render_status,rendering,...}`。charts 含 id、binding、locked、script_ids；market_sources 项含 ref、contract、operations、configSchema、available。 | 当前画布与公开来源声明；available 不证明连接或行情成功。 |
| `data_providers` | `{contract:"sesame.market/1"}` → `{items,nextCursor?}`；items 与 market_sources 使用同一来源声明形状。 | 可选 SourceRef 与明确支持的操作。 |
| `market_instruments` | `{action:"search",source,query,...}` → `{items,nextCursor?,metadata}`；`{action:"describe",source,instrument}` → `{source,instrument,metadata}`。品种身份是搜索项的 ref；描述含 timeBasis、calendar、features。 | 精确品种与支持的周期/价格/时段；metadata.connection 是来源返回的连接身份。 |
| `canvas_binding` | `{source,instrument,timeframe,price_basis?,adjustment?,session?}` → `{binding,chart,instrument,metadata,validation,operations}`。chart 为 `{symbol,binding,volume:true}`。 | 仅完成来源描述，validation 固定为 `{scope:"source_description",marketDataRead:false,rendered:false}`。 |
| `canvas_apply` | `{command_id,expected_version,operations}` → 更新后的画布、scripts、render_status、rendering；重放另含 replayed 与 command_version，不含 market_sources。add/update 接收 canvas_binding 返回的 chart。 | 布局已保存；调用不等待行情订阅或前端绘制。 |

SourceRef 为 `{providerId,revision,binding?}`，binding 只使用来源 configSchema 明示字段。`canvas_binding` 将实际 `{id,revision}` 固定到 `binding.source.binding.connection`，并仅自动选择唯一声明的价格/复权/时段；未知日历保持未知。`chart.binding={source,instrument,spec}`，symbol 仅是标签，没有 period 字段。宿主管理运行时 bindingId、订阅和释放，Agent 不手填临时绑定身份。画布变更使用实际 version 和稳定 command_id；冲突、用户锁和拖动租约说明保存条件改变，应保留用户操作。

显示证据位于 `rendering[].charts[]`，通过 id 对应目标图表，并要求外层回执 version 等于当前画布 version。回执 at 是宿主接收时间（毫秒）；超过 30 秒的回执不再返回。`render_status:"reported"` 只证明有当前版本回执，不能代替逐图状态；rendering 为空或只有旧版本意味着尚不可确认。

每图回执为 `{id,status,error?,warning?,bar_count?,feed_status?}`。status 为 rendered/loading/offline/error/hidden；bar_count 是该图当前可绘制 K 线数量，feed_status 是数据通道状态，error 保留失败文本并优先展示底层数据订阅错误，warning 说明非阻断的数据限制。当前版本中 `status:"rendered"` 且 `bar_count>0` 是行情已显示的证据；hidden 表示不可见，相关数量和通道状态可省略。`feed_status:"live"` 说明订阅收到有效数据，不证明市场持续成交；行情时间与时效仍以实际来源为准。

历史 queryBars/market_read、来源描述、画布保存和实时订阅各有独立结果。明确的 `SCHEMA_MISMATCH` 等协议错误应沿原 error、SourceRef 和 chart ID 定位；重复绑定同一身份、新建探针图或启用无关数据服务不会改变协议形状。`STALE_REVISION` 与 `CONNECTION_CHANGED` 才指向身份修订变化；缺配置、权限拒绝、没有客户端回执也有各自原因。指标“输入不足”是下游现象，有行情错误时应以行情错误为主要诊断。

价格口径、时段、复权、周期、源修订不同即不同序列；描述成功不证明行情新鲜度。独立图表默认独立时间轴，sync_group 是显式时间范围联动设置。

indicator_publish({operation_id,definition,files}) 发布固定指标成果，chart_script({action:"put",artifact,...CAS}) 将完整 ArtifactRef 挂载到图表。定义声明 parameters、inputs、panes、series、implementation。代码仅支持 sesame-indicator/1 JavaScript compute(input)，包内入口必须存在，无法联网或读文件。例子为 resources/close-line.json 和 close-line.js。

固定研究序列使用 implementation.kind=series、updateMode=static、initial=DataRef。发布冻结实际代码/定义字节，挂载与渲染另行检查。静态指标不会自动更新。布局操作、指标发布和挂载不执行交易。

`rendering[].charts[].warning` 是不阻止渲染的数据限制。来源 `coverage.complete:false` 也可能表示未证明区间完整；有效行仍可绘制，指标按实际收到的闭柱/总行数检查输入。保留这项限制，不将它推断为断线，也不把完整性改写为 true 来消除提示。
