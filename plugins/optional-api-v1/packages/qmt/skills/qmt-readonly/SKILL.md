---
name: qmt-readonly
description: Inspect configured Windows MiniQMT prerequisites and read actual stock/account observations; preserve current-day limits and explicit trade receipt states.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/qmt",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

QMT按能力分层：行情与账户读取提供证据，限价单/撤单执行明确授权的交易意图。分析方法消费已取得的事实，工作流组合判断；读取任务不会自动进入交易或另开报告。复用满足来源、账户、品种与时效要求的已有证据，只补具体缺口。qmt_environment({action:"inspect"})给出已保存configuration、Python候选、sdk_verified:false与missing；verify只验证真实SDK导入，不证明终端或账户可读。prepare使用已知现有Python复用/创建私有SDK，不安装MiniQMT、不启动终端或登录。

qmt_configure保存实际python_path、userdata_directory、account_id、market_port与sector，expected_version来自inspect。端口/账号以已有配置或用户提供的券商信息为准；缺值不猜，不强制扫描磁盘。券商登录授权在原生终端完成，本插件不收密码。公开能力逐项形状及示例在INTERFACES.md，交易回执语义在TRADING.md。

取证使用 data_providers({contract:"sesame.market/1"})、market_instruments、market_read；已知有效来源/品种身份可直接复用。SourceRef={providerId,revision,binding?}，binding按configSchema填写，品种用搜索返回的ref，metadata.connection给出连接身份。source.revision与connection.revision含义不同。market_read的固定ref、实际范围、单位、时间口径和coverage一起交给方法层；coverage.complete:false保留真实行及缺口，不当成零行情。host专用bind/query/subscribe形状在INTERFACES.md，无需手填bindingId。

只有显示任务才使用canvas_binding/canvas_apply，显示结果以canvas_inspect当前图表的status/error/bar_count/feed_status为证据。历史读取、保存图表配置和实时显示分别核验；来源协议错误按具体原因处理，重复绑定同一身份无助修复。持续订阅由宿主管理。

sesame/qmt#market只有未复权D1、last、regular/default；普通历史只读本地缓存，qmt_download_history({symbol,start,end})显式下载缺口。1秒目标报价/日柱轮询不等于分钟K线。sesame/qmt#account仅listAccounts/snapshot/queryPositions。qmt_read可读原生当日orders/fills，单位未核实的原生时间和price_type不转译；没有标准订单历史、账户事件流或多日完整账本。

账户任务经portfolio公开能力或qmt_trading_context取得身份/全账户快照。普通Agent不调用host专用positions_close；账户页由宿主收集确认。交易请求使用稳定operation_id；submitted/cancel_requested只是原生受理，unknown读取原命令与原生当日回报，不换ID重报。工作流执行权限由宿主实时调用链提供，不由Agent编造authorization签名或任务身份。


qmt_read例：{action:"search",query:"000001",page:{limit:20}}；{action:"quotes",symbols:["000001.SZ"]}；{action:"positions",page:{limit:200}}。后页使用nextCursor并保持过滤条件，冻结快照60秒过期。SDK返回None/错误不可当空账户。

依赖入口：券商提供的已授权MiniQMT、官方 [快速开始](https://dict.thinktrader.net/nativeApi/start_now.html)、[行情接口](https://dict.thinktrader.net/nativeApi/xtdata.html)、[账户接口](https://dict.thinktrader.net/nativeApi/xttrader.html)。prepare需要已有x64 CPython3.12，仅安装插件私有XtQuant；macOS/Linux不能靠pip获得Windows原生终端。

原生account/position观察不等于可卖许可；T+1、涨跌停、实际数量规则、市场时段仍由券商决定。研究/配置请求不授权交易。TRADING.md与INTERFACES.md解释稳定命令、最终执行保护、撤单恢复和未知结果，运行时拒绝不能靠换传输绕过。
