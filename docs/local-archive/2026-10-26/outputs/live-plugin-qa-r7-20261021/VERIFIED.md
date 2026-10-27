# R7 自然指令准备路径独立核验

结论：**verified_with_limits**。普通指令直接进入manual_trade_prepare，唯一准备Run已完成；业务结果仍为 **rejected / STALE_QUOTE / future_quote**，没有下单尝试。该结果证明路由简化与保护拒绝，不证明交易环境已就绪或交易闭环通过。

用户原话：“我准备手动交易 MT5 的 EURUSD，方向和手数稍后给。现在先把交易环境准备好。”

冻结主会话工具列表只有manual_trade_prepare和host_runs_wait。没有先列账户、单独开权限、查历史或发起研究；prepare输入仅backend=mt5、symbol=EURUSD、operation_id和user_authorized=true，没有补造方向或手数。调用和progress列表的id、时间、顺序逐项相符。

唯一Run为 run_17fcba52-51bc-4f77-81c8-deff99cd3927，attempt=1。accepted只表示宿主接收；wait的完整Run与实际结算Run逐字段相同。结果submission_attempted=false，原始ageMs=-10796864（约超前3小时）保留，未因模型最后文字而改写为ready。

| 事件 | UTC时间 | 距用户消息提交锚点 |
| --- | --- | --- |
| 首个业务工具调用 | 2026-10-21T09:01:29.436Z | 23.695 s |
| 宿主接受prepare的回执 | 2026-10-21T09:01:29.537Z | 23.796 s |
| Agent收到工具accepted返回 | 2026-10-21T09:01:29.549Z | 23.808 s |
| 宿主prepare Run创建 | 2026-10-21T09:01:29.535Z | 23.794 s |
| 宿主prepare Run开始 | 2026-10-21T09:01:29.537Z | 23.796 s |
| 宿主prepare Run完成 | 2026-10-21T09:01:31.723Z | 25.982 s |
| Agent调用wait | 2026-10-21T09:01:49.972Z | 44.231 s |
| wait返回已结算Run | 2026-10-21T09:01:50.363Z | 44.622 s |
| completed消息的持久化updated_at | 2026-10-21T09:02:42.799Z | 97.058 s |
| 最终文本已被冻结快照观察到 | 2026-10-21T09:05:47.675Z | 281.934 s |

提交锚点是宿主用户消息created_at=2026-10-21T09:01:05.741Z，不是鼠标点击。首工具在23.695秒后发出，工具accepted返回只用113毫秒；宿主Run从开始至完成2186毫秒。Run完成后18.249秒才调用wait，18.640秒后取得结果；wait本身391毫秒。之后到completed消息updated_at再过52.436秒，总计97.058秒。

**984毫秒/720毫秒是插件内部total_request_ms/preparation_request_ms，不是模型端到端或用户等待时间。** 最终completed消息updated_at为09:02:42.799，文本摘要与09:05:47.675的冻结progress一致；缺少逐token/页面可见时间，因此不能把updated_at称为首字显示或UI渲染完成时间。上述额外间隔的模型、网络、队列及流式输出占比没有证据可拆分。

R7 baseline于2026-10-21T09:01:05.207Z记录8类全局活动计数均0，距本次用户消息534毫秒，证明R6结束后已全局空闲再提交R7。明确授权的主库只读事务于2026-10-21T09:09:15.860Z锁定后置快照：8类活动计数仍全0、14个暂停Run ID完全相同；805个protected records、351个旧Run、186条旧主会话消息、14个暂停关联对象逐项body SHA-256均一致。只保存摘要与本轮消息元数据，不保存密钥内容。主库连接已关闭，未打开任何child runtime.sqlite。

后置快照已锁定在后续安装之前。verify.mjs只离线复核四份冻结文件和verified.json.mainPost，不重新运行capture/progress，不读当前主库，不受之后插件安装影响。

独立断言 6/6 通过。

- Preparation is rejected for future_quote, not ready. This run does not prove successful quote validation or a completed trade.
- The no-prior-discovery conclusion concerns the captured main-Agent tool sequence. Necessary internal account/permission reads within prepare are not removed or separately timed here.
- No order/execute tool or separate order Run exists in the captured R7 chain, and the result explicitly says submission_attempted:false; no independent broker history query was made.
- 984/720ms are plugin request fields. They exclude the model route, tool result uptake and final response delay.
- The 18.249s completion-to-wait-call gap and 52.436s wait-to-completed-message-update gap are observed intervals; their model/network/queue/streaming causes are not established.
- Final completed message updated_at and the later frozen text observation are available; exact first visible text, first token and UI render timing are absent.
- The main post-snapshot is locked at its stated time before subsequent installations. Offline reruns must reuse it, not compare the baseline with later product state.

证据：[baseline](E:/brief2great/sesame/outputs/live-plugin-qa-r7-20261021/baseline.json)、[submission](E:/brief2great/sesame/outputs/live-plugin-qa-r7-20261021/submission.json)、[progress](E:/brief2great/sesame/outputs/live-plugin-qa-r7-20261021/progress.json)、[receipts](E:/brief2great/sesame/outputs/live-plugin-qa-r7-20261021/receipts.json)、[逐项结果及锁定后置hash](E:/brief2great/sesame/outputs/live-plugin-qa-r7-20261021/verified.json)、[离线验证脚本](E:/brief2great/sesame/outputs/live-plugin-qa-r7-20261021/verify.mjs)。

重跑命令：node outputs/live-plugin-qa-r7-20261021/verify.mjs。仅更新本目录verified.json与VERIFIED.md。
