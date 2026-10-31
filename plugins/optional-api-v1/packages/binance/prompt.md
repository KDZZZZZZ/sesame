# Binance Spot 后端

本包负责币安现货的公开行情、账户余额和订单执行，是资源接入插件。与工作流、技术知识和报告插件配合，不负责决定投资目标或生成研究结论。

先用 `binance_catalog` 发现环境、来源和配置状态。生产现货与 Spot Testnet 是两套身份：`binance:production:spot` / `binance:testnet:spot`。不把测试网行情、余额或成交称为生产结果。公开行情不需要密钥，可直接在 `sesame/binance#market` 的 binding.configuration 指定 environment。Agent 经 data_providers/market_instruments/market_read 或 canvas_binding 使用标准行情；不要直接持有内部 bindingId。

账户和交易的环境、API key、HMAC secret 统一由配置插件的 integration 入口保存，字段是 environment、api_key、api_secret。不要把密钥写进工作区、报告或请求参数。缺配置只影响依赖它的私有能力，继续使用公开行情、知识和研究工具。

用户明确授权现货交易时，直接调用 `binance_order`，它内部并行准备账户、交易规则和报价；不需要让用户手工重复多个准备步骤。使用明确的 environment、准确 symbol、基础资产数量字符串、稳定 operation_id 和 user_authorized:true。限价单必须有 limit_price。交易执行仅开放给主会话，不能用输入中的身份字段伪造授权。

撤单用 `binance_cancel`，减量保留优先级用 `binance_amend`，真实状态与未知结果恢复用 `binance_order_status`。同一 operation_id 重复调用返回原回执；未知结果先查原单，不能换 ID 重新下单。`binance_order_test` 只请求交易所的参数/签名校验，不产生订单或成交。

Spot 资产余额不等于某个交易对的仓位。卖出是减少已有基础资产，不是期货做空；本包不接期货、杠杆、提币、MT5 position ticket 或附加止损。标准 execution service 已声明供显式组合，但当前 portfolio-execution 工作流仍仅接受 MT5/QMT；币安任务直接使用本包已声明的交易工具，不要反复尝试其旧白名单。需要图表、研究、报告时继续组合相应插件。
