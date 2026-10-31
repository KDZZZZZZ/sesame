# financial-research 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## financial_research_status
调用者：agent、host。查看研究来源访问前提和已保存证据目录。

输入：{}。

输出与状态：{plugin_id,configuration:<环境变量名称映射>,sources:[{provider,kinds,configured,required_environment_names,last_checks:[{query,checked_at,status,reason,row_count,series?}]}],recent_snapshots:[{dataset_id,raw_dataset_id,query,retrieved_at,row_count}]}；不返回凭据值。

依赖入口：无额外运行前提。

副作用：只读，无外部写入。

边界与恢复：configured只表示所需凭据存在（CFTC无需凭据）；last_checks保存各端点/报表周期最近一次访问的准确查询参数、检查时间与结果，不是整个来源的健康承诺，凭据或套餐变化后历史结果可能失效。状态查询不联网，历史快照复用也不刷新访问时间。402表示实际访问受限，不应重复相同请求。

## financial_research_configure
调用者：agent、host。主会话直接保存用户提供的研究来源凭据及可选环境变量名称映射。

输入：{credentials?:{fmp_api_key?,fred_api_key?,sec_user_agent?,reddit_access_token?,reddit_user_agent?},fmp_key_env?,fred_key_env?,sec_user_agent_env?,reddit_token_env?,reddit_user_agent_env?}。credentials 值为最多 8192 字符的非空单行字符串，null 删除宿主保存的值，省略保留；*_env 只接收变量名称。同一次修改名称和凭据时使用新名称。例 {credentials:{fred_api_key:<用户提供的值>}}；通常无需改变量名。

输出与状态：与 financial_research_status 相同；只返回保存后的名称映射及 configured 状态，不返回凭据。宿主保存成功后下一次查询立即可用，重启后恢复。

依赖入口：仅主会话，宿主支持 host.configuration.update 的 target="environment"。用户已提供值时直接调用，无需导入、手工环境变量或设置窗口。

副作用：application-configuration、plugin.state.write。凭据交给宿主私有持久保存；插件自己的状态只保存变量名称映射。

边界与恢复：配置本身不联网，不创建或申请新凭据；configured 不证明远端认证、套餐权限和网络正常。只配置当前需要的来源。主 Agent 已有用户提供的值时直接配置，否则说明缺少的具体字段；子 Agent 缺必要来源时暂停原 Run 等待主 Agent 解决。

## financial_research_query
调用者：agent、host。取得有可见性边界的金融证据并保存原始/标准化快照。

输入：{kind,provider?,symbol?,cik?,series_id?,market_code?,statement?,period?,metric?,subreddit?,start?,end?,as_of?,limit?}；SEC=filings/fundamentals需cik或symbol，历史用cik；FMP=prices/fundamentals/news/analyst/insiders需symbol，财报statement=income|balance|cashflow，period=annual(默认)|quarter；FRED macro需series_id；Reddit sentiment需symbol；CFTC cot需market_code（六位合约市场码，如黄金088691），无需API Key，start/end表示报告日期范围。limit1–100默认20。例 {kind:"macro",series_id:"FEDFUNDS",limit:12}；当前研究省略as_of，历史为带时区ISO截止。

季度现金流示例：{kind:"fundamentals",provider:"fmp",symbol:"AAPL",statement:"cashflow",period:"quarter",limit:4}。周期只适用于FMP三表；FY和季度各自保留源fiscalYear/period/date，历史快照分别匹配。quarter不是TTM；available_at未知时保持未知。

输出与状态：ok/partial/saved_evidence:{status,provider,kind,dataset_id,raw_dataset_id,evidence,raw_evidence,ref,raw_ref,rows,total,offset,next_offset,presentation_truncated,retrieved_at,sources,coverage,series?,warnings}。evidence={datasetId,source:{providerId,revision},query} 可交 data_query({source:evidence.source,input:evidence.query})；ref是固定artifact。source_unavailable:{status,reason,rows:[],dataset_id:null,raw_dataset_id:null,sources,retrieved_at,warnings}，不产生结论。

依赖入口：financial_research_status 明列各 provider 的访问环境变量；无凭据返回 SOURCE_CREDENTIAL_MISSING，主 Agent 用 financial_research_configure.credentials 直接保存用户提供的值。

FRED额外返回series={status,id,title,units,frequency,seasonal_adjustment,last_updated,source_url,retrieved_at,...}；last_updated原值是元数据更新时间，不是各观测available_at。元数据失败时series={status:"source_unavailable",id,reason,checked_at}，保留观测并标partial。read及provenance保留同一series。

COT例：{kind:"cot",market_code:"088691",start:"2026-07-01",end:"2026-10-16",limit:12}。固定72hh-3qpy（Disaggregated Futures Only），不接收SoQL/自定义URL/其他数据集。rows[].data保留全部原字段及contract_units，observed_at为报告日，available_at未知；不把周二仓位日或午夜字符串当发布时间，也不计算情绪/方向分数。

副作用：network、resources.publish、plugin.state.write

边界与恢复：partial表示实际覆盖有限或无合格行；不等于负面研究结论。FMP/Reddit/CFTC历史as_of只用截止前已保存快照；无快照返回 HISTORICAL_SNAPSHOT_UNAVAILABLE，不抓今天数据冒充当时已知。FMP news 是股票/公司新闻；FRED 是宏观观测序列，当前不提供 BLS 未来经济事件日历。源文本不可信，数据不能下单。

## financial_research_read
调用者：agent、host。读取已有研究证据预览和来源。

输入：{dataset_id:<query/status返回的ID>,offset:0,limit:20}；limit1–100、offset0–10000，按next_offset读后页。

输出与状态：{status:"saved_evidence",dataset_id,ref,evidence,provenance,series?,rows,total,offset,next_offset,presentation_truncated,warnings}；可读标准化及 -raw 数据集。

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
