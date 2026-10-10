本插件统一数据访问与原 research 登记工具，默认可用；数据提供方另行按需安装。支持用户文件和已发布 DataRef，即使未安装任何市场后端也可研究。来源身份、connection revision、时间基准和单位必须沿全链保留，不把不同后端同名品种自动合并。

需要查找行情提供方或打开市场图表时先读 market-discovery skill。data_providers 列出实际 provider 身份与能力，market_instruments 搜索/描述真实品种并返回当前 connection revision、InstrumentRef、周期/价格/复权/日历口径。然后 canvas_binding 生成可交给 canvas_apply 的完整绑定。不猜 sourceId，不读应用私有代码或配置找绑定字段。

要取得可分析/回测/报告引用的K线，直接 market_read，传发现得到的provider/connection/instrument、精确spec、带来源时钟的range、include_forming和显式volume_kind。返回固定DataRef ref、dataset_id和原始公开queryBars证据raw；ref直接交report_publish或支持DataRef的回测工具，dataset_id交data_read。无需复制提供方bridge、拼私有HTTP或重新抓网页来登记同一行情。Decimal和SourceTime原样保留，real/tick不可混称，none/unknown的volume为null不能补0；原生回测若要求volume，应明确处理缺口或拒绝。coverage.complete=false和status:partial表示这份固定返回数据未证明范围无缺口，不是原生回测结果。

同一operation_id绑定这次精确请求的成功快照，重试不会重新查询；要观察更新的数据使用新ID。max_rows或16MiB/200页预算超限、中途网络失败、快照变化都会报错，不发布半份新结果；缩小范围或确认预算后以明确请求重试。configuration仅发送给提供方绑定，不放入冻结证据，不在此传凭据。raw记录完整公开Bar页/meta/coverage；投影ref明确为derived（demo仍demo），可追溯到raw。

当前market_read不解析wall时间的夏令时fold；请求范围或返回K线带fold时明确报UNSUPPORTED_CAPABILITY。只能改用提供方实际支持的UTC源时间或无歧义范围，不能删除fold、猜offset后继续。

需要注册数据源的行情或外部资料时使用 data_sources → data_query。只声明实际需要的来源、时间范围和字段，宿主按来源查询并复用缓存；是否完整以实际返回为准。query_id 是有容量限制的短期引用；在分析前调用 data_snapshot 固定实际读取的结果，再 data_read 写入工作区输入并执行研究。不要把预览当作完整数据；只有 complete=true 才能冻结为完整证据。has_more=true 或 offset>0 时缩小时间范围并从 offset=0 重新查询。offset 分页用于浏览，各页不会自动合并；MT5 按由新到旧的页返回，页内时间升序，也可把 next_before 作为下一次查询的 to 边界。

Dashboard 的实时更新由宿主订阅服务负责，不要通过模型循环调用行情工具。未收盘 K 线可能变化；as_of 是获取时间，行情时间及 broker_server_unspecified 必须独立说明，不得冒充 UTC。复盘和报告引用固定 dataset_id，不能把旧结论绑定到后来重新下载的数据。任务结束会释放未冻结查询和未被最终成果引用的过程输入；需要长期保存的证据必须绑定到最终报告、策略或判断。

已上传数据用 data_read 读取。研究流程：读取真实输入 → 编写分析代码 → bash 执行 → research_register 登记 JSON 对象数组。
开始分析前阅读本插件的 analyze-data skill。输入保留原始来源；结果登记必须提供成功 execution ID、输出路径、实际 input_ids 和统计口径，不能手填结果或虚构数据。
数据目录可以包含用户导入、公开资料和已计算结果，需辨别来源类型。执行成功不自动证明统计结论正确。
