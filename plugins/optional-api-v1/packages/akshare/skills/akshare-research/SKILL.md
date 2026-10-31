---
name: akshare-research
description: Query declared A-share public research interfaces and daily market sources, preserving source, volume units, coverage and observation-only quotes.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/akshare",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

AKShare属于信息获取层，为方法与工作流提供A股公开行情证据。复用已满足品种、周期、来源和观察时点的固定数据，只补明确缺口；技术解释和综合判断交给对应方法与工作流，不因读取行情另开报告。akshare_discover({python_path?})/akshare_status({})核验本机64位Python>=3.11和AKShare1.19.1；ready:true会保存选择。akshare_prepare可复用已有环境或安装私有依赖。无需券商登录/API Key；环境检查未覆盖的已知Python可显式传入。

akshare_catalog列出全部白名单：stock_info_a_code_name、stock_zh_a_spot_em、stock_zh_a_hist、stock_zh_a_daily、stock_bid_ask_em、stock_zh_a_spot_tx、stock_zh_a_hist_tx。akshare_query使用原生字符串参数并返回rows/totalRows/truncated；quote为单品种快照。目录可读不代表上游可达，截断预览不冒充全量。

来源 sesame/akshare#market 用 binding:{configuration:{source:"eastmoney"|"sina"|"tencent"}}；保留实际 connection.id/revision，不混用来源。默认Eastmoney不是自动故障转移。

取证使用 data_providers({contract:"sesame.market/1"})、market_instruments、market_read；已知有效来源/品种身份可直接复用。SourceRef={providerId,revision,binding?}，binding按configSchema填写，品种用搜索返回的ref，metadata.connection给出连接身份。source.revision与connection.revision含义不同。market_read的固定ref、实际范围、单位、时间口径和coverage一起交给方法层；coverage.complete:false保留真实行及缺口，不当成零行情。host专用bind/query/subscribe形状在INTERFACES.md，无需手填bindingId。

只有显示任务才使用canvas_binding/canvas_apply，显示结果以canvas_inspect当前图表的status/error/bar_count/feed_status为证据。历史读取、保存图表配置和实时显示分别核验；来源协议错误按具体原因处理，重复绑定同一身份无助修复。持续订阅由宿主管理。

统一接口只有1d日线，last、none/forward/backward、regular/all、未知calendarRevision。Asia/Shanghai wall时间或明确UTC范围均可；报价仅Eastmoney/Tencent，60秒轮询且时间为HTTP观察时间、新鲜度未知。Eastmoney volume单位lot（100股），Sina/Tencent为share；不补造分钟柱/逐笔/未知成交量。


上游历史例：akshare_query({interface:"stock_zh_a_hist_tx",arguments:{symbol:"sz000001",start_date:"20260101",end_date:"20261015",adjust:""},max_rows:100})。Eastmoney stock_zh_a_hist使用六位symbol与period:"daily"；Sina stock_zh_a_daily和Tencent历史使用市场前缀。统一market_instruments返回的instrumentId仍是六位代码，不需要Agent自行猜市场映射。

逐项宿主query/subscribe形状、限额、结果与恢复入口在INTERFACES.md；官方接口说明在 https://akshare.akfamily.xyz/data/stock/stock.html 。上游网络阻断是具体来源失败，不等于零行情。若任务允许替换来源，记录新来源身份与单位，不能将换源后数据标作旧源。
