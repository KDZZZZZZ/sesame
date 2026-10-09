QMT 是可选 Windows x64 MiniQMT 适配，默认仅可发现，不随应用启动下载或启动终端。先读 qmt-readonly skill（含显式交易分支），inspect/verify 复用已有券商授权、Python、账户和端口配置，确实缺依赖才明确 prepare。macOS/Linux 报实际平台前提，不以假账户或样本冒充验证。

market 支持本地目录、品种描述、1秒目标报价轮询、未复权D1历史和形成中日柱轮询。原生日期/时区必须保留；不是分钟K线、交易所逐笔推送或已核实成交量单位。历史不足时先告知，再显式 qmt_download_history；普通读取不下载。account 支持快照/股票持仓/标准当日委托成交，历史范围、事件账本和账户事件流不支持。原生 None 是错误，不等于空账户；回报时间单位与price_type不能猜。

只有主 Agent 在明确用户交易请求后才能调用 qmt_order/qmt_cancel。使用 exact account_id/connection_revision，限价、整数股数、明确buy/sell；券商最终校验可卖/T+1/涨跌停/数量规则/时段/权限。submitted 或 cancel_requested 都不是成交/撤成保证。相同意图复用operation_id，unknown 不自动重报；先读原生当日orders/fills与原remark核对。撤单只能引用该连接已接受的Sesame原请求。没有资金划拨、任意脚本、原生策略运行器或自动SVL等价目标。
