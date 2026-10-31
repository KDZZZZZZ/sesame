# daily-integrated 有界只读取证

窗口：2026-10-20T14:42:52.742Z → 2026-10-20T15:41:24.137Z。仅主 WAL 与本轮 JSONL，未读取子 SQLite、未发模型或业务请求。

| 分支 | 当前状态 | 实际 Run |
| --- | --- | --- |
| W1 | blocked | run_5720ad84-71c0-419a-91ba-bc3639d41ef6, run_8bb61145-74fb-4a2b-a075-0963ef0ab5c0 |
| W2 | terminal_needs_effect_review | run_430e50f3-b6f7-47e6-9ce9-e70382f08b3b |
| W3 | blocked | run_598001e6-f656-4ef1-bd4f-c4b882bea772 |

| 会话/分支 | 工具调用/返回 | 批次 | 阻碍候选 | 输出字节 | 压缩记录 |
| --- | --- | --- | --- | --- | --- |
| main / conv_main | 159/159 | 57 | 8 | 908498 | 2 |
| W3 / conv_3e7644fd-9a6a-4b7c-b2c9-ff4c5b3d1f90 | 109/109 | 30 | 8 | 537688 | 0 |
| W1 / conv_84154dc1-746a-41fc-b511-f8999507c50f | 8/8 | 1 | 3 | 83320 | 0 |
| W2 / conv_96acb5f0-3eb0-444f-83fd-7eb6a8837cc8 | 44/44 | 15 | 0 | 274901 | 0 |
| unassigned / conv_519e907c-c1bb-4d4a-9d6b-2510fd3c6987 | 24/24 | 9 | 0 | 197948 | 0 |
| W1 / conv_066773c0-bac9-49ec-ae2b-bba1dfd3a1b6 | 95/95 | 46 | 6 | 721401 | 1 |
| unassigned / conv_46cddaab-6e59-46a8-8b05-c985c41e8268 | 27/27 | 13 | 0 | 200920 | 0 |
| unassigned / conv_1f65aa5f-440d-43b6-92f8-08c4f7372acf | 12/12 | 4 | 0 | 140000 | 0 |

待人工归因：12 条；完全相同输入重复组 23；大于 50 KB 的工具输出 2。

- Tool return/outer success and terminal Run do not prove design effects.
- Intervals between recorded entries are unclassified elapsed time, not thinking time.
- Input hashes identify exact repetitions without retaining input values. Legitimate waits/readbacks may repeat.
- No full arguments, result bodies, reasoning, account identifiers, configuration values or credentials are stored.
- State is sampled every 15 seconds in watch mode; short transitions or cleaned traces can be missed.
- Metadata-only evidence needs exact frozen-result and report review before any pass conclusion.

运行：`node daily-effect-audit.mjs` 单次快照；`node daily-effect-audit.mjs --watch --minutes 10` 每 15 秒增量读取、最多 10 分钟，仅状态变化打印。
