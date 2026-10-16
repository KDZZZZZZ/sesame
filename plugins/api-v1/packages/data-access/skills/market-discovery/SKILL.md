---
name: market-discovery
description: Discover declared market sources and exact instruments, then freeze actual paged history or bind a chart.
---

已知有效的 SourceRef 和 InstrumentRef 可直接复用，无需重复发现。缺少来源时 data_providers({contract:"sesame.market/1"}) 返回 ref={providerId,revision}；available=false 表示所属插件需加载。binding 的可用字段来自 configSchema。

缺少精确品种身份时 market_instruments({action:"search",source,query}) 返回真实分页与 InstrumentRef；需要周期、价格、复权、时段或时间口径时 describe 提供相应声明。metadata.connection 的实际 {id,revision} 可固定到 source.binding.connection。游标续页保持同一查询与 limit。

显示任务可用 canvas_binding 生成 chart，再让 canvas_apply 接受它；已有匹配绑定不必重建。成功证据来自 canvas_inspect 当前版本的目标图表 rendered 与实际 bar_count，feed_status 独立反映实时流。warning 是历史覆盖等非阻断限制，不等于 error；无回执只能说明尚无显示证据。明确协议错误应保留来源和操作信息，重复重绑相同身份不能修复协议。

历史数据调用 market_read：
- operation_id、title 是此次精确快照的稳定身份。
- source 为固定 SourceRef；instrument 为发现得到的精确标识。
- spec={timeframe,priceBasis,adjustment,session,calendarRevision}，只选真实声明值；唯一选项可由 canvas_binding 选择。
- range={from:SourceTime,to:SourceTime} 是含头不含尾范围；UTC 使用 {basis:"utc",unixMs}，wall 使用 {basis:"wall",authority,value}，不向未知时区添加 Z。
- include_forming 明确是否包含形成中 K 线，volume_kind 必须为 real、tick 或 none；max_rows 默认 10000，上限 100000。

返回 ref 是固定行 DataRef，evidence 是公开原始 Bar 页、来源元数据和覆盖证据；rowCount、columns、sample 是实际投影摘要。data_read({ref}) 可将这些行写入执行目录。没有短期 query_id 或新注册 dataset_id。配置和凭据不会写入市场快照；临时 host cursor 也不作为证据。

Decimal 和 SourceTime 原样保留。unknown 或 none 的 volume 为 null，real 的单位和 tick 计数不同。status:partial 或 coverage.complete:false 不证明完整市场历史，即使分页已结束。demo 输入始终保留 demo。DST fold 无内置解歧义能力，遇到显式 fold 报错，不能移除字段强行通过。

同一 operation_id 重试读取已冻结结果；新观察使用新 ID。失败发生在完整读取之后时复用保存的字节。中途网络错误、快照漂移、max_rows/200 页/16 MiB 超限都不发布截断结果。数据源自己的缺口声明与宿主分页完成是两个独立事实。
