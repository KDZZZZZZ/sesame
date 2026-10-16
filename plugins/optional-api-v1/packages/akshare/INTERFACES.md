# akshare 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## akshare_discover
调用者：agent、host。验证并选择实际可导入固定版本 AKShare 的现有 Python。

输入：{python_path?}；例 {python_path:"C:/known-venv/Scripts/python.exe"} 仅在已有该真实路径时使用；{} 使用保存/私有/宿主/PATH候选。

输出与状态：ready:true 返回 python、akshareVersion:"1.19.1"、pythonInfo、reused:true、mode、provenance；ready:false 返回 required、failures[{python,reason}]。成功会保存私有选择记录，查询可立即使用。

依赖入口：本机64位 Python>=3.11；无需券商账户或API Key。

副作用：process、plugin.state.write

边界与恢复：不下载、不升级现有环境；一个失败候选不代表全机无依赖。有已知其他路径可显式 discover；确需安装用 akshare_prepare。

## akshare_status
调用者：agent、host。核验当前候选 AKShare 环境，返回就绪或具体缺项。

输入：{}；使用已有选择及本机候选。

输出与状态：ready:true 返回 python、akshareVersion:"1.19.1"、pythonInfo、reused:true、mode、provenance；ready:false 返回 required、failures[{python,reason}]。成功会保存私有选择记录，查询可立即使用。

依赖入口：本机64位 Python>=3.11；无需券商账户或API Key。

副作用：process、plugin.state.write

边界与恢复：不下载、不升级现有环境；一个失败候选不代表全机无依赖。有已知其他路径可显式 discover；确需安装用 akshare_prepare。

## akshare_prepare
调用者：agent、host。准备缺失的私有 AKShare 依赖并保留来源收据。

输入：{python_path?}；可指定已存在的本机64位Python>=3.11，例 {python_path:"C:/Python312/python.exe"}。

输出与状态：{ready:true,reused,python,mode?,receipt?}；新安装 receipt 含 index、akshareVersion、Python信息和 packages[{name,version,url,hashes.sha256}]；缺解释器/源失败抛明确错误。

依赖入口：akshare_discover/status 可发现现有环境；prepare 仍会先复用兼容环境。

副作用：process、network、private-filesystem、plugin.state.write

边界与恢复：只在插件私有目录建 venv、下载 AKShare 1.19.1 并 pip check；不下载Python，不升级共享环境。安装成功不证明某上游网络可访问。

## akshare_catalog
调用者：agent、host。列出实际支持的只读 AKShare 接口、参数和数据来源。

输入：{}。

输出与状态：{interfaces:[{name,arguments,source,volumeUnit?}],streaming:false,subscriptions,provider,connections:[{id,revision}],documentation}；接口名/字符串参数可直接用于 akshare_query。

依赖入口：无额外运行前提。

副作用：只读，无外部写入。

边界与恢复：此包不提供账户、下单或实盘成交能力；公开数据可用不代表可交易。 目录是实现白名单，不表示上游可访问；实时图表从 data-access/canvas 公开入口创建。

## akshare_query
调用者：agent、host。执行白名单上游接口，保留实际字段和预览截断信息。

输入：{interface,arguments?,max_rows?}；arguments 的值均为字符串。例 {interface:"stock_zh_a_hist_tx",arguments:{symbol:"sz000001",start_date:"20260101",end_date:"20261015",adjust:""},max_rows:100}。stock_info_a_code_name/stock_zh_a_spot_em/stock_zh_a_spot_tx 无参数；stock_bid_ask_em 用 symbol 六位代码；stock_zh_a_hist 用六位symbol、period:"daily"；stock_zh_a_daily 用 sh/sz 前缀。

输出与状态：{ok,interface,akshareVersion,observedAt,rows,totalRows,truncated}；max_rows默认100、最多1000，只裁剪预览，totalRows 是原生返回行数。

依赖入口：akshare_discover/status 或 prepare 的 ready:true；允许的接口完整列于 akshare_catalog。

副作用：process、network

边界与恢复：这是上游字段结果，不是统一Bar，也不自动发布DataRef。网络/接口错误是失败，不以空数组替代；需要完整统一历史/冻结证据用 market_read。 此包不提供账户、下单或实盘成交能力；公开数据可用不代表可交易。

## akshare_quote
调用者：agent、host。读取一个A股公开报价快照。

输入：{symbol:"000001",source:"tencent"}；symbol六位代码，source=eastmoney（默认）|tencent。

输出与状态：{...原生查询回执,rows,source,exchangeTimeAvailable:false}；Tencent 从全市场快照筛选该代码；Eastmoney 返回报价项目行。

依赖入口：已有 ready:true 的 AKShare 环境。

副作用：process、network

边界与恢复：observedAt 是本次HTTP观察时间；不宣称交易所逐笔或freshness live。无匹配行不证明零价格。 此包不提供账户、下单或实盘成交能力；公开数据可用不代表可交易。

## market_bind
调用者：host。为宿主建立精确行情来源会话；不代表已取得报价。

输入：{binding:{configuration:{source:"tencent"}}}；source=eastmoney|sina|tencent，缺省 eastmoney；也可传精确 connection:{id:"akshare:tencent",revision:"1.19.1"}。

输出与状态：{bindingId,connection:{id:"akshare:<source>",revision:"1.19.1"},sourceIds:["akshare:<source>:a-share"],health:"ready",timeBasis}；ready 只描述绑定，尚未验证网络/环境。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/akshare#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 akshare_discover 或 akshare_status 返回 ready:true 后已选定可用 Python；akshare_prepare 可创建私有 AKShare 1.19.1 环境。不需要券商账户/API Key。

副作用：plugin.session.write

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。

## market_unbind
调用者：host。释放宿主创建的行情绑定。

输入：{binding:<bind返回的含bindingId对象>}；例 {binding:{bindingId:"host-owned-id"}}。

输出与状态：{closed:true}；释放该绑定与其分页状态。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/akshare#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 akshare_discover 或 akshare_status 返回 ready:true 后已选定可用 Python；akshare_prepare 可创建私有 AKShare 1.19.1 环境。不需要券商账户/API Key。

副作用：plugin.session.write

边界与恢复：仅释放本次来源会话，不是平仓或停终端。

## market_searchInstruments
调用者：host。检索该明确来源的真实品种；返回 ref 是后续 instrument 的来源。

输入：{binding:<bind结果>,query:{query:"000001",assetClasses?,venues?},page:{limit:20,cursor?}}；limit≤1000，cursor 仅沿用同一来源/过滤条件。

输出与状态：{items:[{ref:{sourceId,instrumentId},symbol,name,assetClass,venue?}],nextCursor?,metadata:{snapshotId?,consistency?,meta,connection?}}；空 items 仅是该次检索无匹配。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/akshare#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 akshare_discover 或 akshare_status 返回 ready:true 后已选定可用 Python；akshare_prepare 可创建私有 AKShare 1.19.1 环境。不需要券商账户/API Key。

副作用：process、network

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。 只支持A股日线；Sina限沪深，报价仅Eastmoney/Tencent。Eastmoney volume 单位 lot（100股），Sina/Tencent 为 share；不得补造分钟柱或未知量。

## market_describeInstrument
调用者：host。读取具体品种的价格/数量单位、时间基准和支持周期。

输入：{binding:<bind结果>,query:{instrument:{sourceId:"akshare:tencent:a-share",instrumentId:"000001"}}}；实际 instrument 用 search 返回 ref。

输出与状态：{items:[{ref,symbol,name,assetClass,price,quantity,volume,timeBasis,calendar,features,native}],metadata:{meta,connection?}}；unknown/unsupported 字段保留，features 决定支持的 spec。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/akshare#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 akshare_discover 或 akshare_status 返回 ready:true 后已选定可用 Python；akshare_prepare 可创建私有 AKShare 1.19.1 环境。不需要券商账户/API Key。

副作用：process、network

边界与恢复：只支持A股日线；Sina限沪深，报价仅Eastmoney/Tencent。Eastmoney volume 单位 lot（100股），Sina/Tencent 为 share；不得补造分钟柱或未知量。

## market_queryBars
调用者：host。读取有界历史柱和真实覆盖证据，供宿主查询/冻结。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,range:{from:<SourceTime>,to:<SourceTime>},includeForming:false,direction:"forward"},page:{limit:100,cursor?}}。仅 timeframe=1d、priceBasis=last、adjustment=none|forward|backward、session=regular|all、calendarRevision:{status:"unknown"}。range 为 UTC 或 Asia/Shanghai wall SourceTime，区间 [from,to)，最多30年。

输出与状态：{items:[{id,revision,openTime,endTime,open,high,low,close,volume,isClosed,closure}],nextCursor?,metadata:{seriesId,instrument,spec,coverage,snapshotId,consistency,meta,connection?}}；OHLC 是十进制字符串，volume 自带单位/未知状态；无 nextCursor 只说明本次快照分页结束。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/akshare#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 akshare_discover 或 akshare_status 返回 ready:true 后已选定可用 Python；akshare_prepare 可创建私有 AKShare 1.19.1 环境。不需要券商账户/API Key。

副作用：process、network

边界与恢复：coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。 只支持A股日线；Sina限沪深，报价仅Eastmoney/Tencent。Eastmoney volume 单位 lot（100股），Sina/Tencent 为 share；不得补造分钟柱或未知量。

## market_subscribeBars
调用者：host。为宿主持续提供初始行情快照及增量。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,tailLimit:100,includeForming:true}}；不传历史range或复用分页cursor，tailLimit正整数≤2000；恢复使用新快照。仅 timeframe=1d、priceBasis=last、adjustment=none|forward|backward、session=regular|all、calendarRevision:{status:"unknown"}。

输出与状态：{id,events:AsyncIterable,close}；首帧 {type:"snapshot",snapshot:{seriesId,instrument,spec,bars,coverage,meta?},position:{streamId,epoch,seq},consistency,recovery:"snapshot"}；后续 {streamId,epoch,seq,eventId,schemaVersion,observedAt,type,payload}，type 为 bars.upsert/bars.closed（按源能力）或 stream.gap。position/consistency/recovery 平铺在首帧，不嵌入 metadata。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/akshare#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 akshare_discover 或 akshare_status 返回 ready:true 后已选定可用 Python；akshare_prepare 可创建私有 AKShare 1.19.1 环境。不需要券商账户/API Key。

副作用：process、network、plugin.session.write

边界与恢复：60秒真实日线/报价快照轮询；报价 time 是 HTTP 观察时间且 freshness=unknown，不是交易所 tick 时间。 订阅由宿主绑定、取消和释放，Agent 不持有 bindingId。stream.gap/RESYNC_REQUIRED 可按同一来源重新取得快照；具体 SCHEMA_MISMATCH 或首帧 position 缺失是协议问题，反复重绑、新建图或启用无关服务不能修复。 coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。

## market_subscribeQuotes
调用者：host。给宿主提供有来源时间和新鲜度边界的报价快照轮询。

输入：{binding:<bind结果>,query:{instruments:[{sourceId:"akshare:tencent:a-share",instrumentId:"000001"}]}}；数量限制 1–5，不支持 resumeToken；实际引用来自 search。

输出与状态：{id,events:AsyncIterable,close}；首帧 {type:"snapshot",snapshot:{quotes,meta},position:{streamId,epoch,seq},consistency,recovery:"snapshot"}，随后 quotes.upsert 或 stream.gap；报价字段用 value/unknown 状态表达。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/akshare#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 akshare_discover 或 akshare_status 返回 ready:true 后已选定可用 Python；akshare_prepare 可创建私有 AKShare 1.19.1 环境。不需要券商账户/API Key。

副作用：process、network、plugin.session.write

边界与恢复：60秒真实日线/报价快照轮询；报价 time 是 HTTP 观察时间且 freshness=unknown，不是交易所 tick 时间。 订阅由宿主绑定、取消和释放，Agent 不持有 bindingId。stream.gap/RESYNC_REQUIRED 可按同一来源重新取得快照；具体 SCHEMA_MISMATCH 或首帧 position 缺失是协议问题，反复重绑、新建图或启用无关服务不能修复。 只支持A股日线；Sina限沪深，报价仅Eastmoney/Tencent。Eastmoney volume 单位 lot（100股），Sina/Tencent 为 share；不得补造分钟柱或未知量。

## akshare_dispose
调用者：host。关闭插件自有资源。

输入：宿主生命周期输入 {}。

输出与状态：{closed:true}。

依赖入口：仅宿主卸载/关闭时调用。

副作用：plugin.session.close

边界与恢复：释放插件存储和自有会话/订阅；不删除已发布证据，不结束用户交易终端。
