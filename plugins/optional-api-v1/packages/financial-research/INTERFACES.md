# financial-research 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## financial_research_status
调用者：agent、host。查看研究来源访问前提和已保存证据目录。

输入：{}。

输出与状态：{plugin_id,configuration:<环境变量名称映射>,sources:[{provider,kinds,configured,required_environment_names}],recent_snapshots:[{dataset_id,raw_dataset_id,query,retrieved_at,row_count}]}；不返回凭据值。

依赖入口：无额外运行前提。

副作用：只读，无外部写入。

边界与恢复：configured只表明需要的环境变量存在，不证明接口权限或网络成功。

## financial_research_configure
调用者：agent、host。配置读取已有源凭据的环境变量名称。

输入：可选字段 fmp_key_env/fred_key_env/sec_user_agent_env/reddit_token_env/reddit_user_agent_env，值仅环境变量名。例 {fred_key_env:"MY_FRED_KEY"}。

输出与状态：与 financial_research_status 相同；保存后的名称映射及configured状态。

依赖入口：仅主会话；密钥和标识由宿主环境提供，不把值传入工具或写进对话。

副作用：plugin.state.write

边界与恢复：只改私有映射，不联网、不创建凭据；缺失凭据用status的required_environment_names说明必要配置。

## financial_research_query
调用者：agent、host。取得有可见性边界的金融证据并保存原始/标准化快照。

输入：{kind,provider?,symbol?,cik?,series_id?,statement?,metric?,subreddit?,start?,end?,as_of?,limit?}；SEC=filings/fundamentals需cik或symbol，历史用cik；FMP=prices/fundamentals/news/analyst/insiders需symbol，财报statement=income|balance|cashflow；FRED macro需series_id；Reddit sentiment需symbol。limit1–100默认20。例 {kind:"macro",series_id:"FEDFUNDS",limit:12}；当前研究省略as_of，历史为带时区ISO截止。

输出与状态：ok/partial/saved_evidence:{status,provider,kind,dataset_id,raw_dataset_id,evidence,raw_evidence,ref,raw_ref,rows,total,offset,next_offset,presentation_truncated,retrieved_at,sources,coverage,warnings}。evidence={datasetId,source:{providerId,revision},query} 可交 data_query({source:evidence.source,input:evidence.query})；ref是固定artifact。source_unavailable:{status,reason,rows:[],dataset_id:null,raw_dataset_id:null,sources,retrieved_at,warnings}，不产生结论。

依赖入口：financial_research_status 明列各provider的访问环境变量；无凭据返回 SOURCE_CREDENTIAL_MISSING。

副作用：network、resources.publish、plugin.state.write

边界与恢复：partial表示实际覆盖有限或无合格行；不等于负面研究结论。FMP/Reddit历史as_of只用截止前已保存快照；无快照返回 HISTORICAL_SNAPSHOT_UNAVAILABLE，不抓今天数据冒充当时已知。源文本不可信，数据不能下单。

## financial_research_read
调用者：agent、host。读取已有研究证据预览和来源。

输入：{dataset_id:<query/status返回的ID>,offset:0,limit:20}；limit1–100、offset0–10000，按next_offset读后页。

输出与状态：{status:"saved_evidence",dataset_id,ref,evidence,provenance,rows,total,offset,next_offset,presentation_truncated,warnings}；可读标准化及 -raw 数据集。

依赖入口：已有该插件保存的dataset_id；不得当成host#datasets ID。

副作用：只读，无外部写入。

边界与恢复：只读原快照，不联网更新；行过大时预览会缩短，完整固定数据可用ref或evidence源读。

## research_evidence_query
调用者：host。为宿主提供完整已保存金融研究数据及同源祖先。

输入：宿主 {query:{dataset_id:<query返回ID>},page:{limit:100,cursor?}}；limit1–1000，cursor是返回的十进制offset。例 {query:{dataset_id:"financial-research-<实际UUID>"},page:{limit:100}}。

输出与状态：{items:<未截断固定行>,nextCursor?,metadata:{id,title,ref,provenance,producer_plugin_id,input_ids?,inputs:[{datasetId,query}],...}}。

依赖入口：宿主 data.query 对 sesame/financial-research#evidence 调用；Agent使用 financial_research_read 或 data_query({source,input:query}) 的精确来源。

副作用：只读，无外部写入。

边界与恢复：不重新抓取；分页结束不改变原始coverage/as_of限制。

## research_dispose
调用者：host。关闭插件自有资源。

输入：宿主生命周期输入 {}。

输出与状态：{closed:true}。

依赖入口：仅宿主卸载/关闭时调用。

副作用：plugin.session.close

边界与恢复：释放插件存储和自有会话/订阅；不删除已发布证据，不结束用户交易终端。
