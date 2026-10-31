---
name: ccxt-public-markets
description: Use explicit public CCXT spot candle sources with exact route identity and bounded coverage; no quotes, account, or trading API.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/ccxt",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

CCXT提供公开现货目录与K线，支持Kraken、Coinbase、OKX，不提供bid/ask报价订阅、账户或交易；无需API Key。

ccxt_environment({action:"inspect"})核验固定CCXT 4.5.85/本机64位Python>=3.11；ready:true已保存私有选择，可立即查询。prepare仅在无兼容依赖时安装私有环境。ccxt_catalog({})返回交易所、周期和边界，静态目录不证明网络连通。

来源 sesame/ccxt#market 的首次路由用 binding:{configuration:{exchange:"kraken"}}，交易所取用户选择；publicProxy仅接受明确的无凭据HTTP(S)代理。绑定后保留实际connection，后续同连接会恢复已保存路由；不可静默切换交易所或代理。

行情与画布的公开入口是 data_providers({contract:"sesame.market/1"})、market_instruments、market_read、canvas_binding/canvas_apply。来源采用发现返回的完整 {providerId,revision}，可按 configSchema 附 binding；品种采用搜索结果 ref，连接身份来自 metadata.connection。source.revision 是插件声明摘要，connection.revision 是来源配置身份，两者不可互换。host 专用 bind/query/subscribe 的完整形状在本包 INTERFACES.md，Agent 无需持有 bindingId。

market_read 返回固定数据、rowCount 和覆盖证据。coverage.complete:false 保留已取得的真实行，同时说明范围尚未获完整证明；不能改写为true。历史成功不证明实时订阅成功；canvas_apply 保存配置不证明用户已看到图。canvas_inspect 的当前版本 rendering[].charts[] 提供 status/error/bar_count/feed_status；无当前回执只表示未确认。明确源协议错误（如首帧position缺失）不能通过重复绑定/新建探针图修复；连接或声明版本已变才有刷新身份的依据。宿主管理持续订阅，退出Agent调用不应把已配置图表断开。

仅支持UTC、last、none、1m/5m/15m/1h/1d；单原生窗口Kraken≤500、Coinbase/OKX≤300。订阅是请求后约1秒轮询，不是逐笔行情；需要bid/ask时本包无法提供。更晚源K线才证明前柱收盘，接收时钟不是收盘证据。原生浮点转换不恢复已丢失精度。


有效spec例：{timeframe:"1h",priceBasis:"last",adjustment:"none",session:"all",calendarRevision:{status:"unknown"}}。instrument.ref如{sourceId:"ccxt:kraken:spot",instrumentId:"BTC/USD"}必须来自当前搜索。range为{from:{basis:"utc",unixMs},to:{basis:"utc",unixMs}}，不凭稀疏柱推断完整日历。

publicProxy示例 http://127.0.0.1:7897 仅展示形状，不是默认值；没有已知代理就不猜。配置只接受exchange/publicProxy，准确错误用于修正参数，不换同义字段试错。CONNECTION_CHANGED说明保存路由或revision不符；网络失败则保留原路由和源错误。INTERFACES.md逐项列出所有Agent与宿主能力。
