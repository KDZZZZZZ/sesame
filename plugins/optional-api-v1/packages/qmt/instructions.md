QMT按能力分层：行情与账户读取提供证据，限价单/撤单执行明确授权的交易意图。分析方法消费已取得的事实，工作流组合判断；读取任务不会自动进入交易或另开报告。复用满足来源、账户、品种与时效要求的已有证据，只补具体缺口。qmt_environment({action:"inspect"})给出已保存configuration、Python候选、sdk_verified:false与missing；verify只验证真实SDK导入，不证明终端或账户可读。prepare使用已知现有Python复用/创建私有SDK，不安装MiniQMT、不启动终端或登录。**执行硬约束前置说明**：QMT 仅支持股票整数股**限价单**，**不支持市价单、做空或随单附加 `stop_loss`/`take_profit`（`supportsAttachedStops:false`）**。若用户目标要求随单硬止损或自主附带止损下单，必须在授权当下立即告知该后端限制，不得研究完成后才暴露。

qmt_configure保存实际python_path、userdata_directory、account_id、market_port与sector，expected_version来自inspect。端口/账号以已有配置或用户提供的券商信息为准；缺值不猜，不强制扫描磁盘。券商登录授权在原生终端完成，本插件不收密码。公开能力逐项形状及示例在INTERFACES.md，交易回执语义在TRADING.md。

标准行情取证与画布显示分别遵循 data-access 与 canvas-control，本包仅补充下方 QMT 专有约束。

sesame/qmt#market只有未复权D1、last、regular/default；普通历史只读本地缓存，qmt_download_history({symbol,start,end})显式下载缺口。1秒目标报价/日柱轮询不等于分钟K线。sesame/qmt#account仅listAccounts/snapshot/queryPositions。qmt_read可读原生当日orders/fills，单位未核实的原生时间和price_type不转译；没有标准订单历史、账户事件流或多日完整账本。

账户任务经portfolio公开能力或qmt_trading_context取得身份/全账户快照。普通Agent不调用host专用positions_close；账户页由宿主收集确认。交易请求使用稳定operation_id；submitted/cancel_requested只是原生受理，unknown读取原命令与原生当日回报，不换ID重报。工作流执行权限由宿主实时调用链提供，不由Agent编造authorization签名或任务身份。

公开资源定位：本包路径以插件根目录为准；[完整接口契约](INTERFACES.md) 可由 plugin_read({pluginId:"sesame/qmt",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。
