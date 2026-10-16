AKShare是A股公开研究数据适配。akshare_discover({python_path?})/akshare_status({})核验本机64位Python>=3.11和AKShare1.19.1；ready:true会保存选择。akshare_prepare可复用已有环境或安装私有依赖。无需券商登录/API Key；环境检查未覆盖的已知Python可显式传入，不把扫描目录设为前置仪式。

akshare_catalog列出全部白名单：stock_info_a_code_name、stock_zh_a_spot_em、stock_zh_a_hist、stock_zh_a_daily、stock_bid_ask_em、stock_zh_a_spot_tx、stock_zh_a_hist_tx。akshare_query使用原生字符串参数并返回rows/totalRows/truncated；quote为单品种快照。目录可读不代表上游可达，截断预览不冒充全量。

来源 sesame/akshare#market 用 binding:{configuration:{source:"eastmoney"|"sina"|"tencent"}}；保留实际 connection.id/revision，不混用来源。默认Eastmoney不是自动故障转移。

行情与画布的公开入口是 data_providers({contract:"sesame.market/1"})、market_instruments、market_read、canvas_binding/canvas_apply。来源采用发现返回的完整 {providerId,revision}，可按 configSchema 附 binding；品种采用搜索结果 ref，连接身份来自 metadata.connection。source.revision 是插件声明摘要，connection.revision 是来源配置身份，两者不可互换。host 专用 bind/query/subscribe 的完整形状在本包 INTERFACES.md，Agent 无需持有 bindingId。

market_read 返回固定数据、rowCount 和覆盖证据。coverage.complete:false 保留已取得的真实行，同时说明范围尚未获完整证明；不能改写为true。历史成功不证明实时订阅成功；canvas_apply 保存配置不证明用户已看到图。canvas_inspect 的当前版本 rendering[].charts[] 提供 status/error/bar_count/feed_status；无当前回执只表示未确认。明确源协议错误（如首帧position缺失）不能通过重复绑定/新建探针图修复；连接或声明版本已变才有刷新身份的依据。宿主管理持续订阅，退出Agent调用不应把已配置图表断开。

统一接口只有1d日线，last、none/forward/backward、regular/all、未知calendarRevision。Asia/Shanghai wall时间或明确UTC范围均可；报价仅Eastmoney/Tencent，60秒轮询且时间为HTTP观察时间、新鲜度未知。Eastmoney volume单位lot（100股），Sina/Tencent为share；不补造分钟柱/逐笔/未知成交量。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/akshare",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
