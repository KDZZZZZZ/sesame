QMT 是可选的 Windows x64 MiniQMT 只读适配。先读 qmt-readonly skill，qmt_environment inspect，复用当前终端/券商授权/SDK/账户配置；仅真实缺失时明确 prepare。prepare 使用插件私有目录，不升级已有环境、不安装或启动券商终端。macOS/Linux 调用会说明前提，不能以样本或假账户代替实测。

产品 provider 为 sesame/qmt:market 与 sesame/qmt:account。market 只声明目录、品种描述、每秒目标轮询的报价订阅；account 只声明单个配置账户的快照与股票持仓。没有 K 线、完整历史账本、实盘执行或 SVL 目标。qmt_read orders/fills 是原生当日查询，保留未解释时间/price_type 和所有整数单号；None 不能说明没有持仓或委托。报价缺少可核实的深度数量单位时返回 unknown。使用来源时间判断报价陈旧，轮询时间不是价格更新时间。
