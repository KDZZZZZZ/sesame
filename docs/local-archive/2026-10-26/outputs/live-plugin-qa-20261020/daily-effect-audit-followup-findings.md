# 15:11–15:13 分支状态核对

主 WAL 只读快照截至 15:15:19 UTC；未打开子 SQLite，未调用模型、业务或修复脚本。未改写根助手正在维护的动态 audit JSON/MD。精确实体与时间见同名 JSON。

- **W3 是主动等主会话协助。** `run_598001e6-f656-4ef1-bd4f-c4b882bea772` 在 15:11:29.922 由 `requestedBy=subagent` 请求暂停，15:11:30.141 变为 interrupted，error code 为 null。原文开头是“需要MAIN ONLY控制协助；独立文件/网页/环境工作已保存，不调用禁止入口”。它要求主会话完成 `qa/notes-20261020` 真实生命周期后再恢复，handoff 引用为 `artifact_f60d4d7a-5f3c-4734-850b-485cae3c84a5`。根助手已看到测试索引 v1，本切片未重验报告内容；准备源码、发布 handoff 仍不等于插件配置/启停/升级查询的实际效果通过。
- **W1 是新的 Agent 脚本错误。** `run_8bb61145-74fb-4a2b-a075-0963ef0ab5c0` 的 process `run_e3c709e9-4f7d-4e7c-a2e9-fdafe879c1ba` 在 15:12:21.428 退出 1。短错误为 `AssertionError: ('qaLastAbove=false;', [10, 27, 61])`。当前任务 `stage2.py:23` 的 `rng()` 用子串找行并要求只命中一次；第 25 行生成 source_map 时，该赋值文本命中三行。错误发生在源码映射/manifest 构造阶段，不是 MT5 编译/Tester 失败，也不是之前 backtrader 缺依赖复发。
- **W2 标为 root_interference。** `run_430e50f3-b6f7-47e6-9ce9-e70382f08b3b` 的 `cancelRequestedAt=15:12:44.906`，`cancelReason` 精确为 `Host is closing`；15:12:44.920 进入 cancelling。根助手已明确说明误点主应用关闭按钮。15:14:22 主库中，investment-research workflow 和部分成员仍保留 running，一个成员 completed；这是中途关闭后的状态证据，不能据此宣告产品取消链缺陷或团队复核完成。本切片遵照纠正停止调查取消产品链。

W3 的暂停早于宿主关闭请求约 75 秒，W1 约 23 秒，二者不是误关窗口造成的新失败。W2 的取消与宿主关闭吻合。

**未建立“三次同因失败”。** W1 的缺少可执行文件、缺少 backtrader 模块、源码映射断言属于不同原因；同一 process 错误传播到父 Run 不能重复计次。W3 的旧 BOM 断言与现在的主动暂停不是同一种失败。W2 的五次相同 `host_runs_wait`、主会话三次相同 `host_runs_read` 均未记录为阻碍返回，也不能算失败重试。当前不给新的业务重试建议；后续若同因三次独立失败，停止该分支即可。
