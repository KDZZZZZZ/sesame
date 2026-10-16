# qmt 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## qmt_environment
调用者：agent、host。检查已知 QMT 配置，验证或显式准备 SDK 依赖。

输入：{action:"inspect"} 无需SDK；{action:"verify",python_path:<现有绝对exe路径>} 真实导入验证；{action:"prepare",python_path:<现有x64 CPython3.12>,operation_id:<稳定ID>} 复用/私有安装。

输出与状态：inspect:{platform,supported_platform,configuration,python_candidates,suggested_userdata_directory,private_directory,sdk_verified:false,terminal_started:false,missing,next}；verify 返回原生 {ok,result,sample}；prepare 返回 {reused?,python,...SDK安装/核验结果}。

依赖入口：真实账户依赖券商已授权/登录的 MiniQMT；inspect 能在缺SDK时工作。

副作用：process-on-verify-or-prepare、private-filesystem-on-prepare、network-on-prepare

边界与恢复：inspect 只列候选，verify 只证明SDK可导入，均不证明账户可读。prepare不下载MiniQMT、不启动终端、不自动登录；无Windows x64或必要路径时说明缺项。

## qmt_configure
调用者：agent、host。保存明确的本机QMT连接配置。

输入：{operation_id,expected_version,changes}；version来自 qmt_environment.inspect.configuration.version；changes 支持 python_path、userdata_directory、account_id、broker、market_port、sector。例 {operation_id:"configure-qmt-1",expected_version:1,changes:{market_port:58610}}，端口必须为已知真实配置。

输出与状态：保存后的 {id:"local",version,connection_id,python_path,userdata_directory,account_id,broker,market_port,sector}；version递增，同一operation_id与输入不会重复修改。

依赖入口：路径必须已存在；账户/端口来自已有配置或用户提供的券商信息。

副作用：plugin.state.write

边界与恢复：只保存配置，不验证SDK/账户连通；STALE_REVISION时读取现version再决定修改。配置不构成交易授权。

## qmt_read
调用者：agent、host。读取明确连接的原生股票行情和当日账户回报。

输入：{action:"search",query:"000001",page:{limit:20}}；describe/quotes 用 symbols:["000001.SZ"]（1–50）；asset无附加参数；positions/orders/fills 可带 page:{limit:1..200,cursor?}，其他过滤条件保持不变。

输出与状态：search/positions/orders/fills:{items,nextCursor,snapshotId,consistency,meta,coverage,connection,nativeFieldPolicy}；describe/quotes:{items,connection,meta,nativeFieldPolicy}；asset:{asset,connection,meta,nativeFieldPolicy}。

依赖入口：qmt_environment/ qmt_configure 的现有Windows原生环境、实际行情端口；账户类读取额外需要授权STOCK账号和userdata_mini。

副作用：process、network

边界与恢复：orders/fills 仅原生当日回报，时间单位/price_type保留原值；None/SDK错误不等于空账户。冻结快照cursor约60秒有效，过期可重新获取首个快照。

## qmt_download_history
调用者：agent、host。显式下载缺失的本地D1历史。

输入：{symbol:"000001.SZ",start:"20260101",end:"20261015"}；日期为有效有序YYYYMMDD，最长10年。

输出与状态：{ok:true,result:<原生下载回执>,sample:{from,to}}；随后历史读取的实际行与coverage才证明取得了哪些数据。

依赖入口：已配置可读 MiniQMT 行情连接；任务确需补充历史。

副作用：process、network、external-cache.write

边界与恢复：写入MiniQMT本地行情缓存；普通market_read不会自动下载。下载回执不是全区间完整性证明。

## qmt_order
调用者：agent、host。在明确授权账户上提交一次有限价的股票意图。

输入：{operation_id:<稳定1–100字符ID>,user_authorized:true,account_id:<配置实际账号>,connection_revision:<配置version字符串>,symbol:"000001.SZ",side:"buy"|"sell",shares:"100",price:"10.20",execution_guard?}；股份为正整数字符串、price为正限价；guard含 observed_at/expires_at/max_quote_age_ms/max_quote_to_send_ms/price_limit，可附原生 expected_positions。示例数值仅解释形状，实际来自用户意图和真实观察。

输出与状态：{id,action,fingerprint,connection,accountId,remark,status,createdAt,result?,meta?,error?}；status=submitted|cancel_requested 只表示原生受理，rejected证明拒绝，outcome_unknown保留不确定；result.order_id 是后续核对凭据。

依赖入口：主会话须有对应用户明确交易指令。委派执行仅允许 portfolio/workflow 已冻结且由宿主证明的实时调用链；普通Agent不构造authorization签名。

副作用：external-trading、plugin.state.write

边界与恢复：会提交真实限价单/撤单。T+1、可卖股数、价格/数量规则由券商决定；受理不是成交/撤成。未知或超时用原operation_id读 qmt_command/qmt_trading_command 和当日orders/fills，不换ID重报。

## qmt_cancel
调用者：agent、host。针对原始下单意图提交撤单请求。

输入：{operation_id:<本次撤单稳定ID>,user_authorized:true,account_id,connection_revision,original_operation_id:<原order键>,order_id:<原生正整数文本>}；只引用本连接原请求及唯一匹配订单。

输出与状态：{id,action,fingerprint,connection,accountId,remark,status,createdAt,result?,meta?,error?}；status=submitted|cancel_requested 只表示原生受理，rejected证明拒绝，outcome_unknown保留不确定；result.order_id 是后续核对凭据。

依赖入口：主会话须有对应用户明确交易指令。委派执行仅允许 portfolio/workflow 已冻结且由宿主证明的实时调用链；普通Agent不构造authorization签名。

副作用：external-trading、plugin.state.write

边界与恢复：会提交真实限价单/撤单。T+1、可卖股数、价格/数量规则由券商决定；受理不是成交/撤成。未知或超时用原operation_id读 qmt_command/qmt_trading_command 和当日orders/fills，不换ID重报。

## qmt_command
调用者：agent、host。读取已保留的QMT命令回执，不重新提交。

输入：{operation_id:<已有下单/撤单键>}；例 {operation_id:"user-intent-1"}。

输出与状态：{id,action,fingerprint,connection,accountId,remark,status,createdAt,result?,meta?,error?}；status=submitted|cancel_requested 只表示原生受理，rejected证明拒绝，outcome_unknown保留不确定；result.order_id 是后续核对凭据。

依赖入口：已存在同账户命令；trading版本在委派任务中核对宿主执行上下文。

副作用：只读，无外部写入。

边界与恢复：只读保留回执，不自动刷新或重发原单。未知状态可用当前原生orders/fills核对；不能凭持仓变动臆测该订单成交。

## qmt_trading_context
调用者：agent、host。为公开portfolio执行组合提供精确账户身份与当前原生快照。

输入：{action:"identity"} 或 {action:"snapshot",history_days:7}。

输出与状态：identity:{account:{accountId,connectionId,revision}}；snapshot:{account,summary,positions,orders,fills,deployments:[],capturedAt,historyCoverage:{scope:"current_native_trading_day",complete:false,requestedDays,limitations}}。

依赖入口：配置已授权STOCK账户；委派任务需宿主绑定的同账户执行上下文。

副作用：process、network

边界与恢复：history_days记录请求意图，不扩展SDK当日历史；不得说读到了7天完整成交。

## qmt_trading_order
调用者：agent、host。在明确授权账户上提交一次有限价的股票意图。

输入：{operation_id:<稳定1–100字符ID>,user_authorized:true,account_id:<配置实际账号>,connection_revision:<配置version字符串>,symbol:"000001.SZ",side:"buy"|"sell",shares:"100",price:"10.20",execution_guard?}；股份为正整数字符串、price为正限价；guard含 observed_at/expires_at/max_quote_age_ms/max_quote_to_send_ms/price_limit，可附原生 expected_positions。示例数值仅解释形状，实际来自用户意图和真实观察。

输出与状态：{id,action,fingerprint,connection,accountId,remark,status,createdAt,result?,meta?,error?}；status=submitted|cancel_requested 只表示原生受理，rejected证明拒绝，outcome_unknown保留不确定；result.order_id 是后续核对凭据。

依赖入口：主会话须有对应用户明确交易指令。委派执行仅允许 portfolio/workflow 已冻结且由宿主证明的实时调用链；普通Agent不构造authorization签名。

副作用：external-trading、plugin.state.write

边界与恢复：会提交真实限价单/撤单。T+1、可卖股数、价格/数量规则由券商决定；受理不是成交/撤成。未知或超时用原operation_id读 qmt_command/qmt_trading_command 和当日orders/fills，不换ID重报。

## qmt_trading_cancel
调用者：agent、host。针对原始下单意图提交撤单请求。

输入：{operation_id:<本次撤单稳定ID>,user_authorized:true,account_id,connection_revision,original_operation_id:<原order键>,order_id:<原生正整数文本>}；只引用本连接原请求及唯一匹配订单。

输出与状态：{id,action,fingerprint,connection,accountId,remark,status,createdAt,result?,meta?,error?}；status=submitted|cancel_requested 只表示原生受理，rejected证明拒绝，outcome_unknown保留不确定；result.order_id 是后续核对凭据。

依赖入口：主会话须有对应用户明确交易指令。委派执行仅允许 portfolio/workflow 已冻结且由宿主证明的实时调用链；普通Agent不构造authorization签名。

副作用：external-trading、plugin.state.write

边界与恢复：会提交真实限价单/撤单。T+1、可卖股数、价格/数量规则由券商决定；受理不是成交/撤成。未知或超时用原operation_id读 qmt_command/qmt_trading_command 和当日orders/fills，不换ID重报。

## qmt_trading_command
调用者：agent、host。读取已保留的QMT命令回执，不重新提交。

输入：{operation_id:<已有下单/撤单键>}；例 {operation_id:"user-intent-1"}。

输出与状态：{id,action,fingerprint,connection,accountId,remark,status,createdAt,result?,meta?,error?}；status=submitted|cancel_requested 只表示原生受理，rejected证明拒绝，outcome_unknown保留不确定；result.order_id 是后续核对凭据。

依赖入口：已存在同账户命令；trading版本在委派任务中核对宿主执行上下文。

副作用：只读，无外部写入。

边界与恢复：只读保留回执，不自动刷新或重发原单。未知状态可用当前原生orders/fills核对；不能凭持仓变动臆测该订单成交。

## market_bind
调用者：host。为宿主建立精确行情来源会话；不代表已取得报价。

输入：{binding:{}} 使用已保存 QMT 配置；也可带 inspect/公开查询返回的精确 connection:{id,revision}，不会枚举或切换另一账户。

输出与状态：{bindingId,connection:{id,revision},sourceId,health:"configured",limitations}；实际数据可用性以原生读取为准，不启动终端。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/qmt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：plugin.session.write

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。

## market_unbind
调用者：host。释放宿主创建的行情绑定。

输入：{binding:<bind返回的含bindingId对象>}；例 {binding:{bindingId:"host-owned-id"}}。

输出与状态：{closed:true}；释放该绑定与其分页状态。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/qmt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：plugin.session.write

边界与恢复：仅释放本次来源会话，不是平仓或停终端。

## market_searchInstruments
调用者：host。检索该明确来源的真实品种；返回 ref 是后续 instrument 的来源。

输入：{binding:<bind结果>,query:{query:"000001",assetClasses?,venues?},page:{limit:20,cursor?}}；limit≤200，cursor 仅沿用同一来源/过滤条件。

输出与状态：{items:[{ref:{sourceId,instrumentId},symbol,name,assetClass,venue?}],nextCursor?,metadata:{snapshotId?,consistency?,meta,connection?}}；空 items 仅是该次检索无匹配。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/qmt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。 本地未复权D1历史；历史缺口可通过明确 qmt_download_history 补充。原生成交量单位不猜测；没有账户订阅/标准委托成交历史能力。

## market_describeInstrument
调用者：host。读取具体品种的价格/数量单位、时间基准和支持周期。

输入：{binding:<bind结果>,query:{instrument:{sourceId:"qmt:<configured connection_id>",instrumentId:"000001.SZ"}}}；实际 instrument 用 search 返回 ref。

输出与状态：{items:[{ref,symbol,name,assetClass,price,quantity,volume,timeBasis,calendar,features,native}],metadata:{meta,connection?}}；unknown/unsupported 字段保留，features 决定支持的 spec。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/qmt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network

边界与恢复：本地未复权D1历史；历史缺口可通过明确 qmt_download_history 补充。原生成交量单位不猜测；没有账户订阅/标准委托成交历史能力。

## market_queryBars
调用者：host。读取有界历史柱和真实覆盖证据，供宿主查询/冻结。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,range:{from:<SourceTime>,to:<SourceTime>},includeForming:false,direction:"forward"},page:{limit:100,cursor?}}。仅 timeframe=1d、priceBasis=last、adjustment=none、session=regular|default、calendarRevision:{status:"unknown"}。range 为 UTC 或 Asia/Shanghai wall SourceTime，最多10年；只读本地历史。

输出与状态：{items:[{id,revision,openTime,endTime,open,high,low,close,volume,isClosed,closure}],nextCursor?,metadata:{seriesId,instrument,spec,coverage,snapshotId,consistency,meta,connection?}}；OHLC 是十进制字符串，volume 自带单位/未知状态；无 nextCursor 只说明本次快照分页结束。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/qmt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network

边界与恢复：coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。 本地未复权D1历史；历史缺口可通过明确 qmt_download_history 补充。原生成交量单位不猜测；没有账户订阅/标准委托成交历史能力。

## market_subscribeBars
调用者：host。为宿主持续提供初始行情快照及增量。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,tailLimit:100,includeForming:true}}；不传历史range或复用分页cursor，tailLimit正整数≤2000；恢复使用新快照。仅 timeframe=1d、priceBasis=last、adjustment=none、session=regular|default、calendarRevision:{status:"unknown"}。

输出与状态：{id,events:AsyncIterable,close}；首帧 {type:"snapshot",snapshot:{seriesId,instrument,spec,bars,coverage,meta?},position:{streamId,epoch,seq},consistency,recovery:"snapshot"}；后续 {streamId,epoch,seq,eventId,schemaVersion,observedAt,type,payload}，type 为 bars.upsert/bars.closed（按源能力）或 stream.gap。position/consistency/recovery 平铺在首帧，不嵌入 metadata。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/qmt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network、plugin.session.write

边界与恢复：1秒目标轮询，受原生请求耗时影响；日柱不是分钟柱，报价保留原生时间。 订阅由宿主绑定、取消和释放，Agent 不持有 bindingId。stream.gap/RESYNC_REQUIRED 可按同一来源重新取得快照；具体 SCHEMA_MISMATCH 或首帧 position 缺失是协议问题，反复重绑、新建图或启用无关服务不能修复。 coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。

## market_subscribeQuotes
调用者：host。给宿主提供有来源时间和新鲜度边界的报价快照轮询。

输入：{binding:<bind结果>,query:{instruments:[{sourceId:"qmt:<configured connection_id>",instrumentId:"000001.SZ"}]}}；数量限制 1–50，不支持 resumeToken；实际引用来自 search。

输出与状态：{id,events:AsyncIterable,close}；首帧 {type:"snapshot",snapshot:{quotes,meta},position:{streamId,epoch,seq},consistency,recovery:"snapshot"}，随后 quotes.upsert 或 stream.gap；报价字段用 value/unknown 状态表达。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/qmt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network、plugin.session.write

边界与恢复：1秒目标轮询，受原生请求耗时影响；日柱不是分钟柱，报价保留原生时间。 订阅由宿主绑定、取消和释放，Agent 不持有 bindingId。stream.gap/RESYNC_REQUIRED 可按同一来源重新取得快照；具体 SCHEMA_MISMATCH 或首帧 position 缺失是协议问题，反复重绑、新建图或启用无关服务不能修复。 本地未复权D1历史；历史缺口可通过明确 qmt_download_history 补充。原生成交量单位不猜测；没有账户订阅/标准委托成交历史能力。

## account_bind
调用者：host。为宿主建立精确账户数据绑定。

输入：{binding:{}} 使用已保存 QMT 配置；也可带 inspect/公开查询返回的精确 connection:{id,revision}，不会枚举或切换另一账户。

输出与状态：{bindingId,connection:{id,revision},sourceId,health:"configured",limitations}；实际数据可用性以原生读取为准，不启动终端。

依赖入口：宿主 sesame/qmt#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 qmt_trading_context，原生查询使用该包公开工具。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：plugin.session.write

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。

## account_unbind
调用者：host。释放账户查询/订阅绑定。

输入：{binding:<bind返回的含bindingId对象>}。

输出与状态：{closed:true}。

依赖入口：宿主 sesame/qmt#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 qmt_trading_context，原生查询使用该包公开工具。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：plugin.session.write

边界与恢复：不撤单、不平仓、不停止交易终端。

## account_listAccounts
调用者：host。读取绑定范围内的账户身份。

输入：{binding:<bind结果>,query:{},page:{limit:20,cursor?}}。

输出与状态：{items:[{ref:{connectionId,accountId},label?,currency,...}],nextCursor?,metadata:{snapshotId,consistency,meta,connection?}}；仅当前配置账户，不代表全机登录账户。

依赖入口：宿主 sesame/qmt#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 qmt_trading_context，原生查询使用该包公开工具。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network

边界与恢复：无账户或读取失败不等于空账户；实际账号身份沿用返回ref。

## account_snapshot
调用者：host。读取一个明确账户的资产快照。

输入：{binding:<bind结果>,query:{account:<listAccounts返回ref>}}。

输出与状态：{items:[<账户资产快照>],metadata:{meta,connection?,...}}；快照包含精确account、asOf/观察时间与各资产字段的value/unknown状态，不能把未知资金当0。

依赖入口：宿主 sesame/qmt#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 qmt_trading_context，原生查询使用该包公开工具。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network

边界与恢复：只证明当前快照；不是全部历史账本，也不改变交易权限。

## account_queryPositions
调用者：host。读取当前真实持仓的统一字段。

输入：{binding:<bind结果>,query:{account:<listAccounts.ref>,instruments?:[<search.ref>]},page:{limit:200,cursor?}}。

输出与状态：{items:[{id,revision,account,instrument,side,quantity,...}],nextCursor?,metadata:{snapshotId,consistency,meta,connection?}}；quantity保留单位，未知数量不归零。

依赖入口：宿主 sesame/qmt#account 数据源专用；普通Agent读取账户使用已声明 portfolio_execution_context 或 qmt_trading_context，原生查询使用该包公开工具。 qmt_environment inspect/verify 与 qmt_configure 提供现有 Windows x64 MiniQMT、Python、实际 market_port；股票账户读取还需已授权 account_id/userdata_mini。

副作用：process、network

边界与恢复：只支持大陆STOCK账户股票持仓；可卖量与总量不同，T+1/原生单位不推测。

## qmt_dispose
调用者：host。关闭插件自有资源。

输入：宿主生命周期输入 {}。

输出与状态：{closed:true}。

依赖入口：仅宿主卸载/关闭时调用。

副作用：plugin.session.close

边界与恢复：释放插件存储和自有会话/订阅；不删除已发布证据，不结束用户交易终端。

## positions_close
调用者：host。执行账户页确认的手动平仓。

输入：{binding:{connection:{id,revision},account:{connectionId,accountId}},positionId,operationId,expected:{revision,instrument:{sourceId,instrumentId},side,quantity:{value,unit}},quantity?}；expected来自用户确认的账户页持仓，quantity省略表示确认数量。

输出与状态：{operationId,positionId,status,requestedQuantity,observedAt,filledQuantity?,remainingPositionQuantity?,orderIds?,dealIds?,error?}；status=closed|filled|partially_filled|submitted|rejected|outcome_unknown；closed确认持仓已全平，filled仅确认本次数量已完成。

依赖入口：仅宿主已确认的主会话账户UI可调用；普通Agent使用公开portfolio能力，不能自行伪造UI provenance。

副作用：external-trading、plugin.state.write

边界与恢复：提交真实减仓意图；同ID同输入仅取原回执，账户/数量变化会拒绝。 submitted/unknown不表示平仓完成；有未确认操作时先核对原回执，不能换ID重复。 只卖可卖股票，受T+1及新鲜bid限制；没有原生order_id不按持仓变化猜成交。

## positions_read_receipt
调用者：host。核对账户页平仓的已保留回执。

输入：{binding:{connection:{id,revision},account:{connectionId,accountId}},operationId:<已有平仓键>}。

输出与状态：{operationId,positionId,status,requestedQuantity,observedAt,filledQuantity?,remainingPositionQuantity?,orderIds?,dealIds?,error?}；status=closed|filled|partially_filled|submitted|rejected|outcome_unknown；closed确认持仓已全平，filled仅确认本次数量已完成。

依赖入口：仅宿主已确认的主会话账户UI可调用；普通Agent使用公开portfolio能力，不能自行伪造UI provenance。

副作用：network、plugin.state.write

边界与恢复：读取可刷新原生证据，不发补单。 submitted/unknown不表示平仓完成；有未确认操作时先核对原回执，不能换ID重复。 只卖可卖股票，受T+1及新鲜bid限制；没有原生order_id不按持仓变化猜成交。
