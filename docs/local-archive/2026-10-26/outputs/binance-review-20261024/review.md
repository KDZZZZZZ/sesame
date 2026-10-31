# Binance Spot 有界独立审阅

结论：本轮确认的两个 P2 已由实现者修复，并用原复现输入独立复验通过；当前审阅范围内没有剩余已确认阻塞。审阅到此冻结。

记录时间：2026-10-24T15:28:03.696Z。源码目录：`E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/binance`。审阅者未修改源码、锁、运行中 Sesame 或用户数据；仅在此证据目录写入本地测试及记录。

## 缺陷与复验

| 问题 | 修复前证据 | 修复与复验 |
|---|---|---|
| P2：报价订阅在初始化取消时遗留原生连接；多品种初始化中首连接断开也有同类泄漏 | 已取消请求仍创建 1 个 socket，未关闭 1 个，连接集合为 1、消费者集合为 0 | `streams.js:97–114` 在异步边界检查 signal/消费者状态，已经关闭时立即释放新连接。原独立取消与首路断线输入均通过，连接和消费者均归零 |
| P2：持久行情缓存跨服务重启突破 16 个序列上限 | 两次真实 SQLite 生命周期，每次加载 16 个不同序列，第二次累计 32 条持久记录 | `market.js:13,74,116` 在构造与写入后按全部 SQLite 记录清理；`records.js:17` 提供按观察时间裁剪。相同两生命周期输入现始终不超过 16 条 |

父侧此前指出的 `/order/test` 结果未知阻塞后续交易问题也复验关闭：测试超时回执为 `validation_unknown`、`createsOrder:false`，之后的本地 fixture 真实订单意图能正常提交；真正未知订单仍保留持久化幂等和查询恢复约束。此项不是本轮新发现。Binance 官方将测试订单定义为验证而不送入撮合引擎，当前区分与其一致。[Binance Spot REST](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#test-new-order-trade)

## 已执行验证

- 审阅者独立本地生命周期测试：**3/3** 通过。脚本 [lifecycle-probes.mjs](./lifecycle-probes.mjs)，涵盖两个订阅释放场景和实际 SQLite 重开缓存。
- 独立执行作者编写的聚焦执行测试：**6/6** 通过。涵盖并发幂等、未知提交跨重开恢复、每次调用者身份、环境/凭据变更、测试订单及测试超时。
- 原始命令、输出及关键源码 SHA-256 见 [review.json](./review.json) 和 [verification.log](./verification.log)。

## 合同检查结论

公开行情路径不依赖私有凭据，符合官方公开数据端点约定。[Market Data Only](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md) 私有能力依赖统一配置，`index.js:8` 每次用当前 caller 建立 Execution，传输与锁可以共享。持久 ledger 在发单前记录，未知真实订单通过原客户订单号查询恢复，不盲重发；环境与凭据身份绑定保持。标准 market/account/execution 的条目、分页、行情事件 payload、源 UTC 时间与数值处理在本次检查范围内未再发现已确认错误。

父侧的覆盖区间裁剪、并发 load 等既知项按当前修复代码检查，不重复列为新问题。未新增与设计无关的权限或功能建议。

## 其他证据及边界

父侧已报告真实宿主安装、统一配置脱敏与重开、无密钥公开行情、缺密钥私有能力拦截，以及 28 个能力检查通过；作者已报告专项 **40/40**、10 个源码语法检查和 oxlint 通过，并提供 Testnet 公开品种/K 线/WebSocket 实网证据。这些明确归属原执行者。

本审阅没有调用认证 API、提交真实订单或操作用户账户；没有接入 portfolio 工作流，也不把本地 fixture 成功等同实盘认证链路已测。

