AKShare属于信息获取层，为方法与工作流提供A股公开行情证据。复用已满足品种、周期、来源和观察时点的固定数据，只补明确缺口；技术解释和综合判断交给对应方法与工作流，不因读取行情另开报告。akshare_discover({python_path?})/akshare_status({})核验本机64位Python>=3.11和AKShare1.19.1；ready:true会保存选择。akshare_prepare可复用已有环境或安装私有依赖。无需券商登录/API Key；环境检查未覆盖的已知Python可显式传入。

akshare_catalog列出全部白名单：stock_info_a_code_name、stock_zh_a_spot_em、stock_zh_a_hist、stock_zh_a_daily、stock_bid_ask_em、stock_zh_a_spot_tx、stock_zh_a_hist_tx。akshare_query使用arguments对象中的原生字符串参数并返回rows/totalRows/truncated；quote为单品种快照。目录可读不代表上游可达，截断预览不冒充全量。某一上游连接失败时，若任务未限定供数商，可显式选用另一个已声明来源完成同类查询，结果保留新来源身份；不要把单个站点失败当成AKShare整体不可用，也不要把不同来源拼成同一原始序列。

来源 sesame/akshare#market 用 binding:{configuration:{source:"eastmoney"|"sina"|"tencent"}}；保留实际 connection.id/revision，不混用来源。默认Eastmoney不是自动故障转移。

标准行情读取与画布显示分别遵循 data-access 与 canvas-control，本包仅补充下方数据源专有约束。

统一接口只有1d日线，last、none/forward/backward、regular/all、未知calendarRevision。Asia/Shanghai wall时间或明确UTC范围均可；报价仅Eastmoney/Tencent，60秒轮询且时间为HTTP观察时间、新鲜度未知。Eastmoney volume单位lot（100股），Sina/Tencent为share；不补造分钟柱/逐笔/未知成交量。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/akshare",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
