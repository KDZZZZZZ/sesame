# CCXT 限流恢复修复（隔离验证，尚未部署）

已证实产品存在一个会延长限流的请求调度缺口：一个 CCXT 请求返回 `RATE_LIMITED` 后，共享 worker 立即派发同路由队列里的下一个请求。订阅通道虽然有退避，排队的历史读取或另一张图表仍能继续请求同一来源。修复前本地 Python fixture 记录到第 3 个请求已经执行，本应仍停在第 2 个；见 `regression-red.log`。这证明存在放大路径，不能据此断定这次真实 Kraken 限流完全由本机造成。

前端没有发现本次怀疑的重复订阅问题：`modules/frontend/src/hooks/live-feed-pool.ts:21` 对 `stream.gap` 仅保留错误并等待服务端恢复，相同查询共享连接。新增测试连续发送 6 次限流、等待并添加等价监听者，始终只有一个 SSE。宿主 `modules/plugins/http.js:63` 已对通道使用 2/4/8/16/30 秒退避，成功 snapshot 不清零，正常数据事件才清零。此次不修改前端或宿主产品代码。

Kraken 官方说明公共 OHLC 按 IP 与品种限流，每秒一次或更慢通常在限额内，已经限流时继续请求可能延长限制。因此不能仅以当前 `POLL_INTERVAL=1000` 判错。共享公网 IP、其他客户端及远端实际窗口仍可能影响真实结果。[Kraken 公共 API 限流说明](https://support.kraken.com/gb/articles/206548367-what-are-the-api-rate-limits-)

修改仅在 `sesame/plugins/optional-api-v1/packages/ccxt/worker.js`：

- 明确收到 `RATE_LIMITED` 后，对该既有 worker 路由的全部排队请求执行 2/4/8/16/30 秒冷却。保留原诊断、串行 Python 进程、CCXT 自有限流器和原轮询频率；不重试已经失败的调用，不改变业务接口。
- 成功 `bars`/`ticker` 请求才清除限流计数。`bridge.py:90–101` 的 `markets` 可能完全来自 300 秒目录缓存，所以目录成功不能证明上游恢复；新增回归先失败后通过，见 `cached-directory-red.log`。此处不新增结果字段或修改 bridge 协议。
- 取消等待请求会移除该请求，但保留同路由的冷却截止时间；下一个请求仍需等满。卸载清除等待计时器并拒绝待处理请求；不同既有路由继续独立工作。

验证合计 46 项通过：worker 10/10（包括连续限流、30 秒上限、真实读取后重置、缓存目录不重置、队列取消、卸载、路由隔离）；provider 30/30；前端及宿主 SSE 5/5；已打包合同声明 1/1。日志分别为 `worker-green.log`、`provider-green.log`、`stream-green.log`、`staged-contract-green.log`。修改文件通过 oxlint、Node 语法及 `git diff --check`。这些都是隔离 fixture，未向真实市场追加请求，未操作现场图表、账户、运行配置或 SQLite。

补丁目录：`staging/ccxt-2.0.3`。`package-receipt.json` 记录完整文件索引、规范摘要与逐文件基线差异；`stage-patch.mjs` 使用宿主正式的 `packageFiles`/`packageDigest`。现行 2.0.2 staging 摘要与最近已落盘插件快照一致。对比 2.0.2，仅 `worker.js` 改行为，`plugin.json`/`package.json` 仅版本变为 2.0.3，没有增删文件。源码版本仍保持 2.0.1，按现有维护流程只在 staging 提升版本。

| 项目 | SHA-256 |
| --- | --- |
| sourceDigest | `0e9252e70b302cef013b6ca285231c7193c6a2fb38c2ae6b030253e0fe7282f9` |
| 2.0.3 package digest | `8c4295ff0dd71d5a79e2f0e20e6cda4b27ca9bd50c62dae3c79b8d6291b8f7f0` |
| 2.0.2 baseline digest | `cc8ad04b57095592653ef039a5b1b5368c638e18af0383ccca0c53a294912d5d` |

由 root 在完全空闲维护时重新检查现行摘要后更新，不需要本问题专属的前端构建。随后沿用现有图表观察真实恢复：限流期间保留旧 K 线与错误，成功新快照/增量后恢复正常状态；记录实际请求节奏是否遵守冷却。外部限制未解除时仍可能继续显示 `RATE_LIMITED`，不能把缓存图或隔离测试算成真实恢复通过。现场复验仍待 root 执行。
