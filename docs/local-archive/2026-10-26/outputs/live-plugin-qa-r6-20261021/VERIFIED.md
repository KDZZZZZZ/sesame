# R6 最终只读核验

状态：**passed_with_limits**；8 项交叉核验通过，0 项失败。

R6 已完成：09:00:46.836Z 冻结记录显示主会话 idle、无活动回复/待处理消息、7 个本轮运行全部 completed。09:01:05.207Z 的 R7 提交前快照进一步记录全局 8 类活动计数全为零。这里描述历史收尾，不代表 R7 开始后的当前运行状态。

| 核验 | 结果 |
| --- | --- |
| R6 已收尾；R7 提交前全局活动为零 | passed |
| 既有运行、主消息及 14 项暂停关联保留 | passed |
| 一次实际子 Agent market_instruments 调用及 10.831 秒工具耗时 | passed |
| 20 项目录交接内容与归档一致，保留原始证据边界 | passed |
| 本轮未触发 CCXT 新错误诊断分支 | passed |
| 15 个工作区文件及摘要与冻结回执一致 | passed |
| 既有 9 项文件与 Atom 独立核验及输入仍有效 | passed |
| 模型服务过载提示与工具耗时分开 | passed |

可证的 CCXT 执行事实：完成的子 Run 保存了唯一一条 market_instruments 工具记录，开始 08:52:21.960Z、返回 08:52:32.791Z，差值 10.831 秒；公开 Run 历史也有同一调用的 started/returned 事件。这是工具端到端耗时，不是纯 HTTP 延迟，也不表示仅发送一次 HTTP 请求。

20 项 OKX 目录内容在完成 Run 的模型交接 JSON、工作区 ccxt/receipt.json 以及归档写入回执之间完全一致；项目引用互不重复，仍有未消费的 nextCursor。冻结材料没有单独保存原生工具结果体或 HTTP 响应字节，因此不能把模型交接称作独立抓取的原始响应。归档声明 CCXT 2.0.4，本次成功路径未触发新错误诊断分支；HTTP 状态、原生错误类型与纯网络耗时均未提供。

文件与 Atom：既有 9 项独立核验的 7 个证据输入重新计算摘要后全部一致。最终 UTF-8 文件 3444 字节；编辑只涉及物理第 33 行；分页 1/17/33/49/65，最后一页是末尾 LF 对应的空段。复制通过实际 host.process.exec/Python 标准库完成，不声称专用 copy API 已测。Atom 原文 10 项，实际 rss-collect 3.0.1 限量返回 2 项；两条 published 均映射自原文 updated，不能解释为原始发布时间。15 个工作区文件及清单摘要与冻结回执一致，20 项目录条目不是文件数量。

保留状态：344 个既有 Run、182 条旧主会话消息及 14 项暂停关联的冻结摘要与 R7 提交前快照一致。没有打开子运行数据库。初始两次模型重试的过载提示沿用专项审计，未混入 CCXT 工具耗时。

仍未覆盖：CCXT 错误传播、后续目录页、纯 HTTP 状态/耗时、文件拒绝编辑/哈希冲突删除/覆盖/删除重建等分支，及 Atom 大结果预算或全部历史。Atom 的 ArtifactRef 仅核对跨回执身份，未重新计算未捕获的源 manifest 摘要；小结果无独立派生 result_ref。原生解析过程的临时目录取证范围警告也继续保留。

本核验仅读取冻结输出和 R6 工作区文件；未重跑 capture/progress，未联网、调用业务 API、执行工作区脚本、读任何数据库、写业务文件、改插件或提交。

证据：[机器核验](./final-verified.json)、[冻结内容核验](./content-verified.json)、[内容核验边界](./CONTENT-VERIFIED.md)、[模型重试审计](./model-retry-audit.md)。

重跑：`node outputs/live-plugin-qa-r6-20261021/verify-final.mjs`。仅更新本目录 final-verified.json 与 VERIFIED.md。
