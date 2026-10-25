信息层负责提供可复用的真实输入。复用满足标的、时点、周期、单位与覆盖要求的固定 DataRef；多个分析方法共享同一证据，只为明确缺口重新取数。观察值与来源元数据不是研究结论，解释交给方法层，比较与综合交给工作流。取数本身不要求显示画布或另建报告。

本插件通过 API 2 静态数据源声明、真实分页和固定成果提供分析输入。`data_sources` 返回 `{items,nextCursor?}`，每项为 `{ref:{providerId,revision},contract,operations,configSchema,available}`，可另有 description。`data_providers` 使用同一形状，仅返回市场与账户来源；`contract:"sesame.market/1"` 选择行情来源。available 表示插件可用，不证明数据连接成功。SourceRef 的可选 binding 仅容纳 configSchema 明示配置。operations 是来源操作名到宿主能力的映射，查询时把对应操作键交给 data_query.operation，或使用 market_instruments、market_read 和画布的声明入口；它不等于 Agent 可直接调用的工具名。consumers 仅含 host 的能力不能直接 invoke，也不能改点号或下划线猜别名；无需从宿主代码或安装包猜接口。

`data_query({source,operation,input,limit?,cursor?})` 返回实际 `{items,nextCursor?,metadata?,...}`；metadata 是来源声明的领域元数据。延续请求保持来源、查询和 limit 不变，使用 nextCursor；游标是 60 秒的短期绑定，不是长期证据。宿主管理真实运行时绑定与释放，不手填临时 bindingId。

data_snapshot 接收 source、operation、input、operationId、title 和可选 maxRows，自动读取每页，固定完整实际行与来源证据。来源未声明 provenance 时必须明确 provenanceKind；来源已有标记不可改写，demo 不得升级。返回 ref、evidence、rowCount、columns、sample。成功快照重试不重新查询；读取完成后发布失败也复用已冻结字节。预算超限或中途失败不会发布截断结果。

`market_instruments({action:"search",source,query,...})` 返回 `{items,nextCursor?,metadata}`，搜索项的 ref 是精确 InstrumentRef；`action:"describe"` 接收此 instrument 并返回 `{source,instrument,metadata}`。描述中的 instrument 含 ref、symbol、timeBasis、calendar、features，支持的周期来自 features.timeframes。连接身份来自 `metadata.connection={id,revision}`，可供 `canvas_binding` 固定到 `source.binding.connection`。来源 revision、连接 revision、SourceTime、单位和显式未知状态具有不同意义，不以标签替代身份。

`market_read({operation_id,title,source,instrument,spec,range,include_forming,volume_kind,max_rows?})` 自动分页，返回 `{ref,evidence,rowCount,columns,sample,provenance,receipt,coverage,volume,status}`；ref 为固定 DataRef，evidence 保留原始页与覆盖证据，没有 dataset_id/raw 兼容字段。显示行情使用 canvas_binding 与 canvas_apply，实时订阅由宿主管理；显示任务不要求额外生成历史快照或研究报告。queryBars/market_read 成功只能证明该次历史读取，不能证明订阅或浏览器已显示。显示证据来自 canvas_inspect 的当前版本 `rendering[].charts[]`，含 id、status、error、bar_count、feed_status；没有回执意味着尚不可确认。

失败判断依赖具体错误与来源身份。STALE_REVISION、CONNECTION_CHANGED 指向修订变化；SCHEMA_MISMATCH 等来源协议错误不因重复绑定相同身份或新建探针图而消失。保留原始错误码与消息，订阅失败时以画布回执中的底层错误为准，不把指标缺少输入当作新的数据来源问题。

market_read 保留 Decimal 字符串和 SourceTime；real/tick 不做暗中换算，none/unknown 的 volume 为 null。coverage.complete=false 或 status=partial 只表示已冻结的返回行未证明无缺口。wall 时间带 DST fold 时明确不支持；使用来源实际支持的 UTC 或无歧义区间，不猜偏移。max_rows 默认 10000、上限 100000，另有 200 页及 16 MiB 限制。

data_read({datasetId}) 读取登记输入，data_read({ref}) 读取固定 DataRef；都将完整行写入执行目录 inputs，返回实际 path、rowCount、sample 和 provenance。research_register 将宿主记录的成功执行与冻结输入/输出/配方关联，参数为 operationId、executionId、path、title、description、inputIds 或 inputRefs。它保留可复查的计算证据，不接受当前可变文件或手填执行状态作为替代；仅在任务需要计算成果时使用。具体参数与限制见 analyze-data、market-discovery。
