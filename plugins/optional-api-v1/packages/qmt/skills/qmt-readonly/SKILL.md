---
name: qmt-readonly
description: Inspect configured Windows MiniQMT prerequisites and read actual stock/account observations; preserve current-day limits and explicit trade receipt states.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/qmt",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

QMT提供Windows x64券商MiniQMT的本地股票行情和账户观察，及明确授权的股票限价单/撤单。qmt_environment({action:"inspect"})给出已保存configuration、Python候选、sdk_verified:false与missing；verify只验证真实SDK导入，不证明终端或账户可读。prepare使用已知现有Python复用/创建私有SDK，不安装MiniQMT、不启动终端或登录。

qmt_configure保存实际python_path、userdata_directory、account_id、market_port与sector，expected_version来自inspect。端口/账号以已有配置或用户提供的券商信息为准；缺值不猜，不强制扫描磁盘。券商登录授权在原生终端完成，本插件不收密码。公开能力逐项形状及示例在INTERFACES.md，交易回执语义在TRADING.md。

行情与画布的公开入口是 data_providers({contract:"sesame.market/1"})、market_instruments、market_read、canvas_binding/canvas_apply。来源采用发现返回的完整 {providerId,revision}，可按 configSchema 附 binding；品种采用搜索结果 ref，连接身份来自 metadata.connection。source.revision 是插件声明摘要，connection.revision 是来源配置身份，两者不可互换。host 专用 bind/query/subscribe 的完整形状在本包 INTERFACES.md，Agent 无需持有 bindingId。

market_read 返回固定数据、rowCount 和覆盖证据。coverage.complete:false 保留已取得的真实行，同时说明范围尚未获完整证明；不能改写为true。历史成功不证明实时订阅成功；canvas_apply 保存配置不证明用户已看到图。canvas_inspect 的当前版本 rendering[].charts[] 提供 status/error/bar_count/feed_status；无当前回执只表示未确认。明确源协议错误（如首帧position缺失）不能通过重复绑定/新建探针图修复；连接或声明版本已变才有刷新身份的依据。宿主管理持续订阅，退出Agent调用不应把已配置图表断开。

sesame/qmt#market只有未复权D1、last、regular/default；普通历史只读本地缓存，qmt_download_history({symbol,start,end})显式下载缺口。1秒目标报价/日柱轮询不等于分钟K线。sesame/qmt#account仅listAccounts/snapshot/queryPositions。qmt_read可读原生当日orders/fills，单位未核实的原生时间和price_type不转译；没有标准订单历史、账户事件流或多日完整账本。

账户任务经portfolio公开能力或qmt_trading_context取得身份/全账户快照。普通Agent不调用host专用positions_close；账户页由宿主收集确认。交易请求使用稳定operation_id；submitted/cancel_requested只是原生受理，unknown读取原命令与原生当日回报，不换ID重报。工作流执行权限由宿主实时调用链提供，不由Agent编造authorization签名或任务身份。


qmt_read例：{action:"search",query:"000001",page:{limit:20}}；{action:"quotes",symbols:["000001.SZ"]}；{action:"positions",page:{limit:200}}。后页使用nextCursor并保持过滤条件，冻结快照60秒过期。SDK返回None/错误不可当空账户。

依赖入口：券商提供的已授权MiniQMT、官方 [快速开始](https://dict.thinktrader.net/nativeApi/start_now.html)、[行情接口](https://dict.thinktrader.net/nativeApi/xtdata.html)、[账户接口](https://dict.thinktrader.net/nativeApi/xttrader.html)。prepare需要已有x64 CPython3.12，仅安装插件私有XtQuant；macOS/Linux不能靠pip获得Windows原生终端。

原生account/position观察不等于可卖许可；T+1、涨跌停、实际数量规则、市场时段仍由券商决定。研究/配置请求不授权交易。TRADING.md与INTERFACES.md解释稳定命令、最终执行保护、撤单恢复和未知结果，运行时拒绝不能靠换传输绕过。
