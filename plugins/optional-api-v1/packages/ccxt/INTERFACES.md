# ccxt 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## ccxt_environment
调用者：agent、host。核验并选择现有依赖；仅显式 prepare 可能安装私有依赖。

输入：{action:"inspect",python_path?} 检查给定/已选/私有/宿主/PATH Python；{action:"prepare",python_path?} 在无兼容环境时创建私有 venv。最小例 {action:"inspect"}。

输出与状态：ready:true 返回 python、实际 Python/库版本、reused、origin、downloads/audit；inspect 成功会保存私有 selection，随即可用。ready:false 返回 required 和 failures[{python,code}]。

依赖入口：本机64位 Python>=3.11；库固定 ccxt 4.5.85。已有路径可直接传 python_path，不必先扫描磁盘。

副作用：process、plugin.state.write、private-filesystem、network-on-prepare

边界与恢复：inspect 不下载；prepare 从官方 PyPI 安装到插件私有目录，不安装解释器、不改共享环境。失败根据缺失解释器、导入版本或具体网络错误选择现有路径/准备；重复同一失败不产生新证据。

## ccxt_catalog
调用者：agent、host。发现已保存的公开连接身份，并读取支持的交易所、周期和公开数据边界。

输入：{}；不需要 Python 或联网。

输出与状态：{connections:[{exchange,connection:{id,revision}}],exchanges:["kraken","coinbase","okx"],library:"4.5.85",market:"public spot",timeframes,pollIntervalMs:1000,orders:false,apiKeys:false,coverage:"partial/unknown",closed}。connections 只返回保存的公开身份，不返回代理地址或凭据；无存储返回空数组且不创建数据库。

依赖入口：无。沿用已配置交易所时，把匹配的完整 connection 放入当前 data_providers 来源的 source.binding.connection，直接调用 market_instruments 或 market_read。已知有效身份可直接复用，无需重复读目录或扫描历史文件。

副作用：只读，无外部写入。

边界与恢复：此包不提供账户、下单或实盘成交能力；保存的连接和静态目录不证明网络连通。目录不选择默认连接、不创建或修改路由；同一交易所存在多条路由时保留完整 revision，不能默认取第一项或擅自改成直连。

## market_bind
调用者：host。为宿主建立精确行情来源会话；不代表已取得报价。

输入：{binding:{configuration:{exchange:"kraken"}}}；exchange=kraken|coinbase|okx。可加 credential-free HTTP(S) publicProxy；后续可用原样 connection:{id,revision} 恢复已保存路由。

输出与状态：{bindingId,connection:{id:"ccxt:kraken",revision:"4.5.85"},sourceId:"ccxt:kraken:spot",health:"configured",limitations}；代理路由 revision 为其摘要。只保存路由，不验证网络。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/ccxt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 ccxt_environment inspect 返回 ready:true 已保存选择；prepare 仅在依赖缺失时安装私有 CCXT 4.5.85。公开市场不需要 API Key。

副作用：plugin.state.write

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。

## market_unbind
调用者：host。释放宿主创建的行情绑定。

输入：{binding:<bind返回的含bindingId对象>}；例 {binding:{bindingId:"host-owned-id"}}。

输出与状态：{closed:true}；释放该绑定与其分页状态。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/ccxt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 ccxt_environment inspect 返回 ready:true 已保存选择；prepare 仅在依赖缺失时安装私有 CCXT 4.5.85。公开市场不需要 API Key。

副作用：plugin.session.write

边界与恢复：仅释放本次来源会话，不是平仓或停终端。

## market_searchInstruments
调用者：host。检索该明确来源的真实品种；返回 ref 是后续 instrument 的来源。

输入：{binding:<bind结果>,query:{query:"BTC",assetClasses?,venues?},page:{limit:20,cursor?}}；limit≤500，cursor 仅沿用同一来源/过滤条件。

输出与状态：{items:[{ref:{sourceId,instrumentId},symbol,name,assetClass,venue?}],nextCursor?,metadata:{snapshotId?,consistency?,meta,connection?}}；空 items 仅是该次检索无匹配。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/ccxt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 ccxt_environment inspect 返回 ready:true 已保存选择；prepare 仅在依赖缺失时安装私有 CCXT 4.5.85。公开市场不需要 API Key。

副作用：process、network

边界与恢复：connection.id/revision 来自当前绑定或公开查询的 metadata.connection，不等于插件 source.revision。STALE_REVISION/CONNECTION_CHANGED 时重新取得当前身份；不能猜账号、版本或静默切换来源。 仅公开现货。单次原生窗口 Kraken≤500、Coinbase/OKX≤300；扩大范围不能保证补齐历史。浮点转十进制文本不恢复上游精度。

## market_describeInstrument
调用者：host。读取具体品种的价格/数量单位、时间基准和支持周期。

输入：{binding:<bind结果>,query:{instrument:{sourceId:"ccxt:kraken:spot",instrumentId:"BTC/USD"}}}；实际 instrument 用 search 返回 ref。

输出与状态：{items:[{ref,symbol,name,assetClass,price,quantity,volume,timeBasis,calendar,features,native}],metadata:{meta,connection?}}；unknown/unsupported 字段保留，features 决定支持的 spec。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/ccxt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 ccxt_environment inspect 返回 ready:true 已保存选择；prepare 仅在依赖缺失时安装私有 CCXT 4.5.85。公开市场不需要 API Key。

副作用：process、network

边界与恢复：仅公开现货。单次原生窗口 Kraken≤500、Coinbase/OKX≤300；扩大范围不能保证补齐历史。浮点转十进制文本不恢复上游精度。

## market_queryBars
调用者：host。读取有界历史柱和真实覆盖证据，供宿主查询/冻结。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,range:{from:<SourceTime>,to:<SourceTime>},includeForming:false,direction:"forward"},page:{limit:100,cursor?}}。timeframe=1m|5m|15m|1h|1d，priceBasis=last，adjustment=none，session=all|default，calendarRevision:{status:"unknown"}。range 用 UTC {basis:"utc",unixMs}；区间 [from,to)。

输出与状态：{items:[{id,revision,openTime,endTime,open,high,low,close,volume,isClosed,closure}],nextCursor?,metadata:{seriesId,instrument,spec,coverage,snapshotId,consistency,meta,connection?}}；OHLC 是十进制字符串，volume 自带单位/未知状态；无 nextCursor 只说明本次快照分页结束。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/ccxt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 ccxt_environment inspect 返回 ready:true 已保存选择；prepare 仅在依赖缺失时安装私有 CCXT 4.5.85。公开市场不需要 API Key。

副作用：process、network

边界与恢复：coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。 仅公开现货。单次原生窗口 Kraken≤500、Coinbase/OKX≤300；扩大范围不能保证补齐历史。浮点转十进制文本不恢复上游精度。

## market_subscribeBars
调用者：host。为宿主持续提供初始行情快照及增量。

输入：{binding:<bind结果>,query:{instrument:<search.ref>,spec:<describe支持的spec>,tailLimit:100,includeForming:true}}；不传历史range或复用分页cursor，tailLimit正整数≤500；恢复使用新快照。timeframe=1m|5m|15m|1h|1d，priceBasis=last，adjustment=none，session=all|default，calendarRevision:{status:"unknown"}。

输出与状态：{id,events:AsyncIterable,close}；首帧 {type:"snapshot",snapshot:{seriesId,instrument,spec,bars,coverage,meta?},position:{streamId,epoch,seq},consistency,recovery:"snapshot"}；后续 {streamId,epoch,seq,eventId,schemaVersion,observedAt,type,payload}，type 为 bars.upsert/bars.closed（按源能力）或 stream.gap。position/consistency/recovery 平铺在首帧，不嵌入 metadata。

依赖入口：Agent 使用 data_providers({contract:"sesame.market/1"}) 返回的 sesame/ccxt#market 精确 ref，经 market_instruments 搜索/描述，再按任务使用 market_read 或 canvas_binding/canvas_apply；本 capability 仅供宿主数据适配层调用。 ccxt_environment inspect 返回 ready:true 已保存选择；prepare 仅在依赖缺失时安装私有 CCXT 4.5.85。公开市场不需要 API Key。

副作用：process、network、plugin.session.write

边界与恢复：每次请求结束后至少1秒的公开轮询；不是交易所逐笔推送。 订阅由宿主绑定、取消和释放，Agent 不持有 bindingId。stream.gap/RESYNC_REQUIRED 可按同一来源重新取得快照；具体 SCHEMA_MISMATCH 或首帧 position 缺失是协议问题，反复重绑、新建图或启用无关服务不能修复。 coverage.complete:false 表示覆盖未获证明，可使用已返回的真实行并保留限制，不能改成 true 或当作空数据/请求失败。历史查询成功不证明实时订阅或图表渲染成功。

## ccxt_dispose
调用者：host。关闭插件自有资源。

输入：宿主生命周期输入 {}。

输出与状态：{closed:true}。

依赖入口：仅宿主卸载/关闭时调用。

副作用：plugin.session.close

边界与恢复：释放插件存储和自有会话/订阅；不删除已发布证据，不结束用户交易终端。
