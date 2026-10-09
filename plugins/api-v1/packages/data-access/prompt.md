需要查找行情提供方或打开市场图表时先读 market-discovery skill。data_providers 列出实际 provider 身份与能力，market_instruments 搜索/描述真实品种并返回当前 connection revision、InstrumentRef、周期/价格/复权/日历口径。然后 canvas_binding 生成可交给 canvas_apply 的完整绑定。不猜 sourceId，不读应用私有代码或配置找绑定字段。

需要注册数据源的行情或外部资料时使用 data_sources → data_query。只声明实际需要的来源、时间范围和字段，宿主按来源查询并复用缓存；是否完整以实际返回为准。query_id 是有容量限制的短期引用；在分析前调用 data_snapshot 固定实际读取的结果，再 data_read 写入工作区输入并执行研究。不要把预览当作完整数据；只有 complete=true 才能冻结为完整证据。has_more=true 或 offset>0 时缩小时间范围并从 offset=0 重新查询。offset 分页用于浏览，各页不会自动合并；MT5 按由新到旧的页返回，页内时间升序，也可把 next_before 作为下一次查询的 to 边界。

Dashboard 的实时更新由宿主订阅服务负责，不要通过模型循环调用行情工具。未收盘 K 线可能变化；as_of 是获取时间，行情时间及 broker_server_unspecified 必须独立说明，不得冒充 UTC。复盘和报告引用固定 dataset_id，不能把旧结论绑定到后来重新下载的数据。任务结束会释放未冻结查询和未被最终成果引用的过程输入；需要长期保存的证据必须绑定到最终报告、策略或判断。
