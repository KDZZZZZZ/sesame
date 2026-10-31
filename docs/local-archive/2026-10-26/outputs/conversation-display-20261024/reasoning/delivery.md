# 思考摘要缺失诊断

本轮不修改宿主。证据确认当前桥接已在真实新版投影公开摘要；隔离观测里没有摘要的两次完整请求，是提供方事件中未返回公开摘要，不是会话 guard 把已有摘要丢掉。

## 当前新版的只读事实

- 当前 origin 为 `http://127.0.0.1:28619`，模型 `openai/gpt-6.1-sol`，思考级别 `max`。
- 最近 40 条记录中有 31 条 assistant 消息，其中一条公开 API 消息包含一个 completed reasoning segment，353 字符。
- 同一时段 SDK journal 中提供方 `summary_text` 的公开摘要长度同为 353，界面 DOM 存在一个折叠的“思考摘要”。未保存摘要正文、signature、加密内容或私有 thinking。
- 其前后两轮 journal 的公开 summary 为空。SDK journal 中出现 thinking 块并不代表它包含可公开摘要。
- 详见 `live-summary-metadata.json`。

## 一次隔离 max 观测

使用最新宿主源码、最新构建前端、最新本地九个 core 插件和复制到 E 盘的模型配置，仅提交一次 9 项目预算组合问答。不操作真实 Sesame 的任务，不做研究、报告、工作流、子 agent 或交易。

在隔离脚本中包装 `sessionModels.streamSimple`，保持原方法、请求 options 和原回调调用链，只记录事件 type、公开 summary 长度及 guard 元数据。未保存原始 payload、私有正文、signature 或加密内容。

- 前两次模型请求完整收到 `response.completed`。
- 两次请求均 `sessionIdMatches=true`、`signalMatchesSession=true`、`signalPresent=true`、`signalAborted=false`、`providerCallbackPresent=true`、`requestedReasoning=max`。
- 所有提供方事件中均无 `response.reasoning_summary_*`；`output_item` 和 `response.completed` 的公开 summary 字段也无非空部分。
- 公开 API 的 reasoning 数量为 0，与提供方事件一致。
- 第三次模型请求是工具错误后的自动续接，在隔离测试清理时被停止，不计为完整请求。

原始证据：`real-model-summary-evidence-WYrkRy/result.json`。

## 证据限制

- 没有捕获请求 `onPayload`，因此实际网络请求中的 `reasoning.summary` 未直接观测。只能确认当前 SDK `openai-responses.js` 会默认构建 `summary:auto`，不能把默认代码推断说成实际请求抓包事实。
- 首次 bash 公开 segment 为 `failed`，对应 process Run 为 `interrupted`；其后另一个 process Run 为 `completed`。本次仅保存公开状态，未保留具体工具错误码/输出，故不能可靠细分为脚本语法或环境故障，不作推测。
- 原验收脚本把初始 response 的 `completed` 当成整个问答结束，遇到自动续接时提前收尾。因此原 `result.json` 内 `realModelCompleted:true` 只反映该 response 状态，**不能证明问答完成**；本轮整体问答和摘要 UI 正向验收均不算通过。
- 已修正验收脚本：等待整个隔离会话空闲并稳定 1 秒，汇集续接消息，要求最终正文标记，并保留后续工具错误的公开代码元数据。只做了语法检查，没有再次调用模型。

## 建议与清理

- 保留现有公开 summary 白名单；不投影通用 thinking，不回填旧历史，不用阶段状态生成“思考内容”。
- 前端减少重复的“请求模型”等状态；有非空公开摘要时展示并在完成后折叠，没有摘要时保持真实单行状态。该前端修改由 root 负责。
- 不再重复真实模型试验。
- 隔离浏览器和宿主已关闭，复制认证、SDK journals、临时 profile 和 runtime 已删除。已复核：临时 runtime 目录 0，测试进程 0。
- 本 lane 的宿主 `public-reasoning.js` 与 `runtime.js` 和本轮 before 基线 SHA-256 相同，无产品源码修改。
