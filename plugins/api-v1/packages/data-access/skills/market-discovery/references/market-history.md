# 行情历史与图表显示

## 品种与口径

market_instruments({action:"search",source,query,...}) 返回 `{items,nextCursor?,metadata?}`，每项 ref 是精确 InstrumentRef。可选 assetClasses、venues、limit（1–200，默认 20）与 cursor；续页保持同一查询和 limit。

action:"describe" 接收该 instrument，返回 `{source,instrument,metadata}`。instrument 含 ref、symbol、timeBasis、calendar、features；周期取 features.timeframes，例如 15m 而非平台私有 M15。metadata.connection 的 `{id,revision}` 可供 canvas_binding 固定到 source.binding.connection。来源修订、连接修订、来源时钟和单位各有独立含义，不以展示标签替代身份。

## 历史快照

market_read 必需 operation_id、title、source、instrument、spec、range、include_forming、volume_kind。不要与通用 data_snapshot 的 operationId、maxRows 混用；此处可选预算字段为 max_rows，默认 10000、上限 100000，另有 200 页和 16 MiB 限制。

- spec 包含 timeframe、priceBasis、adjustment、session、calendarRevision，取来源真实声明值；唯一选项可由 canvas_binding 选择，未知日历修订保留明确状态。
- range 为含头不含尾区间。UTC 用 `{basis:"utc",unixMs}`；wall 用 `{basis:"wall",authority,value}`，value 不带虚构 Z 或偏移。显式 DST fold 当前不支持，使用来源真正支持的 UTC 或无歧义区间，不通过删除 fold 掩盖歧义。
- include_forming 明确是否包含形成中 K 线；volume_kind 为 real、tick 或 none。real 有实际单位，tick 为计数，不暗中换算。

### 读取历史：market_read

下例只展示输入形状。替换来源和品种占位值，并依据实际 describe 结果选择 spec、时间口径和研究范围；不能把示例中的 last、regular 或 UTC 当成所有来源的默认值。

```json
{
  "operation_id": "history-snapshot-001",
  "title": "研究历史输入",
  "source": {"providerId": "<来源目录返回的providerId>", "revision": "<精确来源修订>"},
  "instrument": {"sourceId": "<搜索返回的sourceId>", "instrumentId": "<搜索返回的instrumentId>"},
  "spec": {
    "timeframe": "1h",
    "priceBasis": "last",
    "adjustment": "none",
    "session": "regular",
    "calendarRevision": {"status": "unknown", "reason": "来源未提供固定日历修订"}
  },
  "range": {
    "from": {"basis": "utc", "unixMs": 1767225600000},
    "to": {"basis": "utc", "unixMs": 1767312000000}
  },
  "include_forming": false,
  "volume_kind": "none",
  "max_rows": 10000
}
```

返回 `{ref,evidence,rowCount,columns,sample,provenance,receipt,coverage,volume,status}`。ref 是固定行 DataRef，evidence 保留原始 Bar 页与覆盖证据；无 dataset_id/raw 兼容字段或短期 query_id。需要计算时 data_read({ref}) 落盘，完整引用不能只保留 id。

Decimal 字符串和 SourceTime 原样保留；unknown 或 none 的 volume 为 null。配置、凭据和临时宿主页游标不作为行情快照证据。demo 输入保留 demo。coverage.complete:false 或 status:partial 描述来源未确认完整覆盖，不表示返回行无效；核对实际区间，只在影响结论时讲明具体缺口。

同一 operation_id 重试复用固定结果，新观察用新 ID。完整读取后发布失败复用冻结字节；网络中断、快照漂移、行数/页数/字节预算超限不发布截断结果。

## 显示与订阅

显示走 canvas_binding 与 canvas_apply，实时订阅由宿主管理；显示任务不要求另取历史快照或生成报告。已有匹配绑定直接复用。

用 canvas_inspect 当前修订的 `rendering[].charts[]` 核对目标 id、status、error、bar_count、feed_status。rendered 与实际行数证明本次显示，feed_status 独立描述实时流。queryBars 或 market_read 成功只证明历史读取，不证明浏览器显示或实时订阅；没有渲染回执时尚不能确认显示。warning 属于非阻断信息，不等于 error；订阅失败以底层来源错误为准，不把指标没有输入另当成来源故障。
