# QMT manual trading interface

Requires existing authorized native Windows MiniQMT and a STOCK account. Reuse qmt_environment inspect's configuration/revision. Installation, readiness and read access are not trading instructions.

| Tool | Actual parameters and scope |
| --- | --- |
| qmt_order | operation_id, user_authorized:true, exact account_id/connection_revision, mainland symbol (NNNNNN.SH/SZ/BJ), side buy/sell, positive integer shares and positive decimal price. Native order_stock with FIX_PRICE; limit stock orders only. |
| qmt_cancel | New operation_id, authorization/account/revision, original_operation_id and positive order_id. Original must be an accepted Sesame order or an unknown order with a retained original intent. The native process rechecks ownership before cancel_order_stock. |
| qmt_command | Existing operation_id; private durable receipt, no native submission/retry. Main conversation only. |
| qmt_read asset/positions | Actual configured account cash/assets and STOCK positions/available shares. |
| qmt_read orders/fills | Current-day raw native records/IDs/remarks/status; page limit ≤200, cursor in retained 60-second snapshot. Not complete multi-day history. |
| qmt_read describe/quotes | Exact symbols list; native stock conditions and get_full_tick. Source timestamp determines quote age. |

No amend, attached SL/TP, market order, derivative/credit/short-sale request or dedicated close action exists. Reduce a position with an explicit sell limit order within available shares; native T+1, lots, limits and sessions govern acceptance. Do not promise liquidation. Cancel cannot reverse a fill; amendment requires a new authorized intent after confirmation, never automatic cancel/reissue.

operation_id is `[A-Za-z0-9_-]{1,100}`. Identical input returns saved state; changed input/account revision raises conflict. The receipt is persisted as outcome_unknown before submission; timeout/crash never permits automatic resend. submitted means a positive order ID, cancel_requested means cancel acceptance, neither proves a fill/cancel. qmt_command exposes the exact remark for current-day reconciliation. An empty/truncated query, especially across a day boundary, does not prove no order.

New order records retain the account ID, symbol, side, shares and price privately. To cancel an outcome_unknown order, query current-day orders on the same account/connection and find its exact remark and positive order ID. Pass that ID with the original operation ID and current connection revision. In the same connected native process, cancellation requires one matching account/remark record, exact symbol/side/original quantity, matching ID, remaining quantity and active status (48/49/50/55). Duplicate remarks, another account, filled/cancelled/cancel-pending orders and altered intent are refused before sending. Legacy unknown records without retained intent cannot use this recovery path; inspect/manage them in the terminal. The original order is never replayed or relabeled as a confirmed fill.

A configuration revision change permits recovery on the same account and connection ID. The helper captures the current revision, requires every read to match it, checks row account/symbol and verifies configuration again after the evidence reads. Changes during recovery are rejected. A cross-revision cancellation also requires the original private account ID to match; legacy records without that ID can cancel only on their original revision. Keep the original receipt and identity unchanged.

## Optional execution_guard (1.2.0)

qmt_order accepts `execution_guard:{observed_at,expires_at,max_quote_age_ms,max_quote_to_send_ms,price_limit}`. Times are UTC milliseconds: lifetime ≤60 seconds, quote age ≤5 seconds, quote-to-send ≤1 second. In the same connected Python process after startup and before order_stock, it checks account cash/available shares, native price tick/bounds, source epoch tick and side-specific bid/ask. Stale/unknown time, expired decision and price-boundary crossing reject before submission. Cash checks exclude final fees; broker rules remain authoritative. Unsupported volume-step data is not invented.

Rejection before submission is stored as rejected; other unconfirmed failures remain unknown. The receipt reports native quote/read/send/response times without promising a fill or latency. Old unguarded calls remain compatible. The independent manual-trading plugin measures model age and uses M5+; no Windows broker acceptance test ran on this Mac development host.

The manual-trading helper requires Sesame 0.2.1+ and this package 1.2.0+ on the existing authorized Windows session. Its QMT mapping supports limit buy/sell, status and cancellation only. Its query results must retain the exact connection/account/symbol, and cancellation refuses a truncated order page because it cannot prove uniqueness. No attached SL/TP, market order, dedicated close or automatic strategy hosting is added by the helper; native D1 history is not minute history.

Primary reference: [XtQuant trading API](https://dict.thinktrader.net/nativeApi/xttrader.html).
# 周期计划任务入口

原有 `qmt_order` / `qmt_cancel` / `qmt_command` 的主会话限制保持不变。新 `qmt_trading_context({action:"identity"|"snapshot",history_days?})` 为主会话或正在运行的 `sesame/manual-trading` 计划任务提供账户读取。受信任务输入为 `{tradingPlan:{id,backend:"qmt",account,ownerConversationId},runId,role,executionPublicKey}`；`account` 固定 `{accountId,connectionId,revision}`，与当前配置严格核对。

snapshot 返回全账户持仓，不按来源筛选；分页会完整读取本次保留快照。原生委托及成交仍仅覆盖当前交易日，`historyCoverage` 明确说明此限制，`history_days` 不会制造历史。QMT 不提供本插件管理的 EA 挂载，`deployments` 为 `[]`。

`qmt_trading_order` 和 `qmt_trading_cancel` 参数分别与原下单、撤单相同，并可带 `authorization:{expiresAt,signature}`。主会话可省略证明；计划 `role:"executor"` 必须提供运行时的 Ed25519 签名。消息精确为 `canonical({version:1,taskId,runId,action:工具名,args:去除authorization的原参数,expiresAt})`，UTF-8 签署后以标准 base64 编码，有效期在当前时间之后且不超过 60 秒。公钥取自受信任务输入，私钥不交给模型。证明在配置队列前后核验，然后剥离以保持原始幂等语义与原生接口。

周期订单必须提供 `execution_guard`，继续复用真实账户检查、T+1/可用资金及价格保护、幂等意图持久化和不明结果不重放规则。`qmt_trading_command({operation_id})` 读取同拥有者、同账户和 connectionId 的真实保留回执，允许当前配置版本变化后的恢复；执行仍要求精确版本。订单受理及撤单请求不等于成交、平仓或已撤销。

计划订单还必须提供 `execution_guard.expected_positions`，项为 `{account_id,stock_code,volume,can_use_volume}`，数量为非负整数字符串；空仓必须传 `[]`。买卖均在最新报价前与最终发送前核对本品种全持仓。原生委托只有状态 53/54/56/57 可确认为终态；包括撤单中 51/52、未知 255 和缺失状态的其他情况均阻断，不把撤单请求当作无挂单。旧主会话保护可省略此字段。
