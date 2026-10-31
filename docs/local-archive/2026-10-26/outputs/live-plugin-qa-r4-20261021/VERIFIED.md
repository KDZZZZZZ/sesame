# R4：手动交易快捷入口真实回归

真实模型 openai/gpt-6.1-sol，MT5 2.1.6，portfolio-execution 2.0.2，既有 FTMO-Demo 模拟账户。

- 集中准备 ready：工具观察区间 1099ms，最终读取窗口 371ms；插件重载后的 worker 进行了一次初始化，没有重启终端或改权限。
- Python SDK order_check：retcode 0 / Done，last_error Success，原空 kwargs 问题未复现。
- 单次 manual_trade_execute(backend + symbol)：准备 666ms，插件处理 937ms，宿主 Run 2104ms。
- 原始报价超前约三小时；明确 future_quote、submission_attempted:false。没有发送订单，不能据此宣称成交闭环已通过。
- 原14个暂停 Run、历史主消息和暂停关联哈希保持不变；R4结束时主会话空闲。

真实 Run 输出与 Agent 归档回执完全一致。根线程只读主数据库和已有证据；未打开子任务数据库，未另发业务调用。937ms不包括模型往返或成交耗时。完整断言见 verify.mjs 和 verified.json。
