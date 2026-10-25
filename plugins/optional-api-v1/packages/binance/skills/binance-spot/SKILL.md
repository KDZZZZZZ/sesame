---
name: binance-spot
description: 使用币安现货与 Spot Testnet 的公开行情、账户余额和订单工具。
---

1. 读 `binance_catalog`，区分 production 与 testnet。公开行情不需要密钥，按准确来源 ref 使用 data-access 和 canvas。
2. 私有能力缺配置时，通过统一 integration 入口配置 environment、api_key、api_secret；存在配置后直接用 `binance_account` 验证实际连接，不扫描无关密钥。
3. 用户授权交易后用 `binance_order` 一次完成准备及发送，保持 operation_id。数量是基础资产；限价为精确字符串。卖出仅消耗已有资产。
4. 用 `binance_order_status` 观察执行事实；未知结果保持原单身份。改单当前支持减量保留优先级，撤单以真实订单状态为准。
5. 研究时把行情冻结交给方法/工作流；产出通过报告插件统一展示。不要把本后端当作交易策略或研究结论。

本版直接交易工具可用；portfolio-execution 的 MT5/QMT 业务流程尚未支持币安 Spot。详细输入输出见包内 `INTERFACES.md`。
