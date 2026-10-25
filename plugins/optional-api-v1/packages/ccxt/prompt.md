CCXT属于信息获取层：提供Kraken、Coinbase、OKX公开现货目录与K线，不提供bid/ask报价订阅、账户或交易；无需API Key。复用已满足交易所、品种、周期和观察时点的固定数据，只补明确缺口。交付行情证据，技术解释和综合判断交给对应方法与工作流，不因取数另开报告。

ccxt_environment({action:"inspect"})核验固定CCXT 4.5.85/本机64位Python>=3.11；ready:true已保存私有选择，ready:false说明依赖待准备，不是行情不存在。prepare仅在无兼容依赖时安装私有环境。环境ready、目录和已保存路由均不证明交易所网络连通。

沿用已配置交易所但缺少连接身份时，一次 ccxt_catalog({}) 返回 connections:[{exchange,connection:{id,revision}}]。选择任务指定交易所及路由的完整 connection，放入当前 SourceRef 的 binding.connection，直接调用 market_instruments；已知有效完整身份时无需重读目录。不为找连接查询通用设置、扫描历史文件或检查画布。目录只读、不运行Python或联网、不返回代理地址；空数组表示没有保存的路由，不是网络失败。同一交易所的多条路由全部保留，不存在默认选择；已有信息不能区分时明确缺少路由身份，不能取第一项或擅自改成直连。

来源 sesame/ccxt#market 的首次路由用 binding:{configuration:{exchange:"kraken"}}，交易所取用户选择；publicProxy仅接受明确的无凭据HTTP(S)代理。此插件不继承系统HTTPS_PROXY：网络依赖已有代理时，将已配置且获授权的地址显式放入configuration.publicProxy，不要因直连失败重装依赖或更换API Key。绑定后保留实际connection，后续同连接会恢复已保存路由；不可静默切换交易所或代理。

取证使用 data_providers({contract:"sesame.market/1"})、market_instruments、market_read；已知有效来源/品种身份可直接复用。SourceRef={providerId,revision,binding?}，binding按configSchema填写，品种用搜索返回的ref，metadata.connection给出连接身份。source.revision与connection.revision含义不同。market_read的固定ref、实际范围、单位、时间口径和coverage一起交给方法层；coverage.complete:false保留真实行及缺口，不当成零行情。host专用bind/query/subscribe形状在INTERFACES.md，无需手填bindingId。

只有显示任务才使用canvas_binding/canvas_apply，显示结果以canvas_inspect当前图表的status/error/bar_count/feed_status为证据。历史读取、保存图表配置和实时显示分别核验；来源协议错误按具体原因处理，重复绑定同一身份无助修复。持续订阅由宿主管理。

仅支持UTC、last、none、1m/5m/15m/1h/1d；单原生窗口Kraken≤500、Coinbase/OKX≤300。订阅是请求后约1秒轮询，不是逐笔行情；需要bid/ask时本包无法提供。更晚源K线才证明前柱收盘，接收时钟不是收盘证据。原生浮点转换不恢复已丢失精度。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/ccxt",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
