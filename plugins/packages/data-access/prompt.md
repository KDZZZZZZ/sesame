需要行情或外部资料时优先 data_sources → data_query。只声明实际需要的来源、时间范围和字段，宿主自动复用共享缓存、补齐缺失区间。query_id 是有容量限制的短期引用；在分析前调用 data_snapshot 固定实际读取的结果，再 data_read 写入只读输入并执行研究。不要把预览当作完整数据；只有 complete=true 才能冻结为完整证据。has_more=true 或 offset>0 时缩小时间范围并从 offset=0 重新查询。offset 分页用于浏览，各页不会自动合并；MT5 按由新到旧的页返回，页内时间升序，也可把 next_before 作为下一次查询的 to 边界。

Dashboard 的实时更新由宿主订阅服务负责，不要通过模型循环调用行情工具。未收盘 K 线可能变化；as_of 是获取时间，行情时间及 broker_server_unspecified 必须独立说明，不得冒充 UTC。复盘和报告引用固定 dataset_id，不能把旧结论绑定到后来重新下载的数据。任务结束会释放未冻结查询和未被最终成果引用的过程输入；需要长期保存的证据必须绑定到最终报告、策略或判断。
