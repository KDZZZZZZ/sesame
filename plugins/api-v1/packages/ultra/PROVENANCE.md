# 来源与实现边界

本插件由 Sesame contributors 原创实现，采用 MIT 许可证。完整许可见本包 LICENSE；plugin.json 与 package.json 均声明 MIT。

持久检查点、沿原任务恢复和副作用幂等的设计参考 [LangGraph Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)，核对日期为 2026-10-24。这里只借鉴公开的设计原则，没有复制、捆绑或依赖 LangGraph 的源代码、运行时或第三方资产。

具体实现使用 Sesame Plugin API 2 已有的 capability、Run、state、data、plugin 与生命周期接口。主会话、工作流、专业方法、数据来源与交易后端继续承担原有职责。未复制其他插件的运行时、账户代码或私有数据库实现。

tests 中的主机端口和研究/交易能力均为本包原创的确定性测试夹具，不连接真实模型、行情、账户或交易系统。它们验证调度、持久性和控制语义，不构成真实研究或券商执行结果。
